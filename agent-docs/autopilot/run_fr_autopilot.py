#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml


def run_shell(cmd: str, cwd: Path) -> tuple[int, str]:
    proc = subprocess.run(
        ["bash", "-lc", cmd],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
    return proc.returncode, out


def save_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def load_backlog(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Backlog must be a YAML mapping")
    if "requirements" not in data or not isinstance(data["requirements"], list):
        raise ValueError("Backlog must contain a requirements list")
    return data


def write_backlog(path: Path, data: dict[str, Any]) -> None:
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def render_prompt(fr: dict[str, Any], attempt: int) -> str:
    criteria = "\n".join([f"- {x}" for x in fr.get("acceptance_criteria", [])])
    return (
        f"Functional requirement: {fr['id']} — {fr.get('title', '')}\n\n"
        f"Requirement:\n{fr.get('requirement', '').strip()}\n\n"
        f"Acceptance criteria:\n{criteria}\n\n"
        f"Execution constraints:\n"
        f"- Implement only this FR.\n"
        f"- Stop after implementation and before unrelated refactors.\n"
        f"- Keep commits small and focused.\n"
        f"- If tests fail, fix only what is necessary for this FR.\n\n"
        f"Additional instructions:\n{fr.get('implementation_prompt', '').strip()}\n\n"
        f"Attempt: {attempt}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backlog", default="agent-docs/fr-backlog.yaml")
    parser.add_argument("--start-at", default=None)
    parser.add_argument("--max-retries", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    backlog_path = (root / args.backlog).resolve() if not Path(args.backlog).is_absolute() else Path(args.backlog)
    data = load_backlog(backlog_path)

    defaults = data.get("defaults", {})
    max_attempts = args.max_retries or int(defaults.get("max_attempts_per_fr", 3))
    gate_script = str(defaults.get("gate_script", "scripts/verify_fr_gate.sh"))

    env_cmd = os.getenv("CLAUDE_IMPLEMENT_CMD", "").strip()
    template_cmd = str(defaults.get("implement_command_template", "")).strip()
    implement_template = env_cmd or template_cmd

    if not implement_template:
        print("ERROR: No implement command configured.")
        print("Set CLAUDE_IMPLEMENT_CMD or defaults.implement_command_template in agent-docs/fr-backlog.yaml")
        return 2

    started = args.start_at is None

    for fr in data["requirements"]:
        fr_id = fr.get("id")
        if not fr_id:
            continue

        if not started:
            if fr_id == args.start_at:
                started = True
            else:
                continue

        status = str(fr.get("status", "pending"))
        if status == "done":
            continue

        print(f"\n=== {fr_id}: {fr.get('title', '')} ===")

        fr_ok = False
        for attempt in range(1, max_attempts + 1):
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            out_dir = root / "artifacts" / "fr-autopilot" / fr_id / f"attempt-{attempt}-{stamp}"
            out_dir.mkdir(parents=True, exist_ok=True)

            prompt = render_prompt(fr, attempt)
            prompt_file = out_dir / "prompt.txt"
            save_text(prompt_file, prompt)

            impl_cmd = implement_template.format(
                fr_id=fr_id,
                prompt_file=str(prompt_file),
                attempt=attempt,
            )

            print(f"[autopilot] attempt {attempt}/{max_attempts}")
            print(f"[autopilot] implement cmd: {impl_cmd}")

            impl_ec = 0
            impl_output = "dry-run"
            if not args.dry_run:
                impl_ec, impl_output = run_shell(impl_cmd, root)
            save_text(out_dir / "implement.log", impl_output)

            gate_args = [
                "bash",
                gate_script,
                "--fr-id",
                fr_id,
                "--attempt",
                str(attempt),
            ]
            for gc in fr.get("gate_commands", []):
                gate_args.extend(["--gate-cmd", str(gc)])

            print("[autopilot] gate cmd:", " ".join(shlex.quote(x) for x in gate_args))

            if args.dry_run:
                gate_ec = 0
                gate_output = "dry-run"
            else:
                proc = subprocess.run(
                    gate_args,
                    cwd=str(root),
                    capture_output=True,
                    text=True,
                )
                gate_ec = proc.returncode
                gate_output = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
            save_text(out_dir / "gate.log", gate_output)

            attempt_result = {
                "fr_id": fr_id,
                "attempt": attempt,
                "implement_exit_code": impl_ec,
                "gate_exit_code": gate_ec,
                "ok": impl_ec == 0 and gate_ec == 0,
            }
            save_text(out_dir / "attempt-result.json", json.dumps(attempt_result, indent=2))

            if attempt_result["ok"]:
                fr_ok = True
                if not args.dry_run:
                    fr["status"] = "done"
                    fr["completed_at"] = datetime.now().isoformat()
                    write_backlog(backlog_path, data)
                print(f"[autopilot] {fr_id} PASSED")
                break

            print(f"[autopilot] {fr_id} attempt {attempt} failed")

        if not fr_ok:
            fr["status"] = "blocked"
            fr["blocked_at"] = datetime.now().isoformat()
            write_backlog(backlog_path, data)
            print(f"[autopilot] stopping: {fr_id} did not pass within {max_attempts} attempts")
            return 1

    print("\n[autopilot] all eligible FRs complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
