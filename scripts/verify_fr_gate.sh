#!/usr/bin/env bash
set -euo pipefail

FR_ID=""
ATTEMPT="1"
GATE_CMDS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fr-id)
      FR_ID="${2:-}"
      shift 2
      ;;
    --attempt)
      ATTEMPT="${2:-1}"
      shift 2
      ;;
    --gate-cmd)
      GATE_CMDS+=("${2:-}")
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$FR_ID" ]]; then
  echo "Missing --fr-id" >&2
  exit 2
fi

if [[ ${#GATE_CMDS[@]} -eq 0 ]]; then
  echo "Missing at least one --gate-cmd" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/artifacts/fr-gates/${FR_ID}/attempt-${ATTEMPT}-${STAMP}"
mkdir -p "$OUT_DIR"

run_step() {
  local name="$1"
  local cmd="$2"
  local log_file="$OUT_DIR/${name}.log"
  local exit_file="$OUT_DIR/${name}.exit"

  echo "[gate] ${name}: ${cmd}"
  set +e
  bash -lc "$cmd" >"$log_file" 2>&1
  local ec=$?
  set -e
  echo "$ec" > "$exit_file"
  return $ec
}

BUILD_OK=true
SMOKE_OK=true
ALL_GATES_OK=true

if ! run_step "build" "cd '$ROOT_DIR' && npm run build"; then
  BUILD_OK=false
fi

idx=1
for gate_cmd in "${GATE_CMDS[@]}"; do
  step="gate_${idx}"
  if ! run_step "$step" "cd '$ROOT_DIR' && ${gate_cmd}"; then
    ALL_GATES_OK=false
  fi
  idx=$((idx + 1))
done

if ! run_step "wsl_windows_smoke" "cd '$ROOT_DIR' && python scripts/wsl_windows_oac_smoke.py"; then
  SMOKE_OK=false
fi

SUMMARY_JSON="$OUT_DIR/summary.json"
python - <<PY
import json
from pathlib import Path

out = Path(${OUT_DIR@Q})
fr_id = ${FR_ID@Q}
attempt = ${ATTEMPT@Q}

def read_exit(name: str) -> int:
    p = out / f"{name}.exit"
    return int(p.read_text().strip()) if p.exists() else 999

steps = []
for exit_file in sorted(out.glob("*.exit")):
    name = exit_file.stem
    ec = int(exit_file.read_text().strip())
    steps.append({
        "name": name,
        "ok": ec == 0,
        "exit_code": ec,
        "log": f"{name}.log",
    })

ok = all(s["ok"] for s in steps)
summary = {
    "fr_id": fr_id,
    "attempt": attempt,
    "ok": ok,
    "steps": steps,
}
(out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps(summary, indent=2))
PY

if [[ "$BUILD_OK" != true || "$ALL_GATES_OK" != true || "$SMOKE_OK" != true ]]; then
  exit 1
fi

exit 0
