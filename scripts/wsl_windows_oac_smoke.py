#!/usr/bin/env python3
"""WSL orchestrator smoke for OAC Windows UI loop.

This script implements the first executable contract for T47:
1) Build plugin in WSL
2) Deploy artifacts into OACTest vault plugin directory
3) Dispatch mandatory "Restart agent" action in Obsidian (Windows)
4) Emit machine-readable result JSON

Usage:
  python scripts/wsl_windows_oac_smoke.py

Optional env:
  OAC_PLUGIN_DEST   (default: /mnt/c/Users/alexe/Dropbox/Hermes/OACTest/.obsidian/plugins/agent-client)
  OAC_SMOKE_OUTPUT  (default: artifacts/oac-smoke/latest.json)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEST = Path(
    os.getenv(
        "OAC_PLUGIN_DEST",
        "/mnt/c/Users/alexe/Dropbox/Hermes/OACTest/.obsidian/plugins/agent-client",
    )
)
OUT = Path(os.getenv("OAC_SMOKE_OUTPUT", str(ROOT / "artifacts/oac-smoke/latest.json")))
AGENT_LOG = Path(os.getenv("HERMES_AGENT_LOG", "/home/zand/.hermes/logs/agent.log"))
WINDOW_TITLE = os.getenv("OAC_WINDOW_TITLE", "OACTest")


@dataclass
class StepResult:
    name: str
    ok: bool
    command: str | None = None
    exit_code: int | None = None
    output: str | None = None
    detail: dict[str, Any] | None = None



def _run(command: list[str], *, cwd: Path | None = None) -> StepResult:
    proc = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
    )
    output = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
    return StepResult(
        name=" ".join(command[:2]),
        ok=proc.returncode == 0,
        command=" ".join(command),
        exit_code=proc.returncode,
        output=output.strip()[:5000],
    )



def _write_report(report: dict[str, Any]) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


def _get_log_size() -> int:
    if not AGENT_LOG.exists():
        return 0
    return AGENT_LOG.stat().st_size


def _read_log_from_offset(offset: int) -> str:
    if not AGENT_LOG.exists():
        return ""
    with AGENT_LOG.open("rb") as f:
        f.seek(offset)
        chunk = f.read()
    return chunk.decode("utf-8", errors="ignore")


def _read_log_tail(max_bytes: int = 2_000_000) -> str:
    if not AGENT_LOG.exists():
        return ""
    with AGENT_LOG.open("rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - max_bytes), os.SEEK_SET)
        chunk = f.read()
    return chunk.decode("utf-8", errors="ignore")


def _verify_roundtrip_signal(prefix: str, baseline_offset: int) -> StepResult:
    """Wait for a new successful POST response to appear in the gateway log after baseline_offset.

    The gateway's aiohttp access log records POST /v1/responses entries but does not log
    request body content, so T47_SMOKE_ will not appear verbatim. Instead we verify that a
    new 200-class gateway response was emitted after the dispatch point.
    """
    deadline = time.time() + 60
    new_content = ""
    while time.time() < deadline:
        new_content = _read_log_from_offset(baseline_offset)
        if (
            "POST /v1/chat/completions HTTP/1.1\" 200" in new_content
            or "POST /v1/responses HTTP/1.1\" 200" in new_content
        ):
            return StepResult(
                name="roundtrip-log-assert",
                ok=True,
                detail={
                    "prefix": prefix,
                    "evidence": "new POST 200 gateway response observed after smoke dispatch",
                },
            )
        time.sleep(2)

    return StepResult(
        name="roundtrip-log-assert",
        ok=False,
        detail={
            "prefix": prefix,
            "reason": "Did not observe new POST /v1/responses 200 in gateway log within timeout after dispatch",
            "new_log_excerpt": new_content[-1200:],
        },
    )




def main() -> int:
    steps: list[StepResult] = []

    # Step 1: verify winps bridge
    steps.append(
        _run(
            [
                "winps",
                '$PSVersionTable.PSVersion.ToString(); node -v; npm -v',
            ]
        )
    )
    steps[-1].name = "bridge-check"
    if not steps[-1].ok:
        report = {
            "ok": False,
            "timestamp": datetime.now().isoformat(),
            "phase": "bridge-check",
            "steps": [asdict(s) for s in steps],
        }
        _write_report(report)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 1

    # Step 2: build plugin
    build = _run(["npm", "run", "build"], cwd=ROOT)
    build.name = "build"
    steps.append(build)
    if not build.ok:
        report = {
            "ok": False,
            "timestamp": datetime.now().isoformat(),
            "phase": "build",
            "steps": [asdict(s) for s in steps],
        }
        _write_report(report)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 1

    # Step 3: deploy artifacts to OACTest
    copied: list[str] = []
    DEST.mkdir(parents=True, exist_ok=True)
    for artifact in ["main.js", "manifest.json", "styles.css"]:
        src = ROOT / artifact
        dst = DEST / artifact
        if not src.exists():
            steps.append(
                StepResult(
                    name="deploy",
                    ok=False,
                    detail={"missing_artifact": str(src)},
                )
            )
            report = {
                "ok": False,
                "timestamp": datetime.now().isoformat(),
                "phase": "deploy",
                "steps": [asdict(s) for s in steps],
            }
            _write_report(report)
            print(json.dumps(report, indent=2, ensure_ascii=False))
            return 1
        shutil.copy2(src, dst)
        copied.append(str(dst))

    steps.append(StepResult(name="deploy", ok=True, detail={"copied": copied}))

    # Step 4: mandatory restart-agent action in Obsidian via command palette
    restart_ps = (
        "$ErrorActionPreference='Stop'; "
        "Add-Type -AssemblyName System.Windows.Forms | Out-Null; "
        "$ws = New-Object -ComObject WScript.Shell; "
        f"if (-not $ws.AppActivate('{WINDOW_TITLE}')) {{ throw 'Target window not found: {WINDOW_TITLE}'; }}; "
        "Start-Sleep -Milliseconds 400; "
        "[System.Windows.Forms.SendKeys]::SendWait('^p'); "
        "Start-Sleep -Milliseconds 320; "
        "[System.Windows.Forms.SendKeys]::SendWait('Agent Client: Restart agent'); "
        "Start-Sleep -Milliseconds 180; "
        "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); "
        "Write-Output 'RESTART_DISPATCHED'"
    )
    restart = _run(["winps", restart_ps])
    restart.name = "restart-agent-dispatch"
    restart.detail = {"target_window": WINDOW_TITLE}
    steps.append(restart)

    if restart.ok:
        smoke_prefix = "T47_SMOKE_"
        # Capture log position before dispatch so roundtrip check only looks at new entries.
        log_baseline = _get_log_size()
        send_ps = (
            "$ErrorActionPreference='Stop'; "
            "Add-Type -AssemblyName System.Windows.Forms | Out-Null; "
            "$ws = New-Object -ComObject WScript.Shell; "
            f"if (-not $ws.AppActivate('{WINDOW_TITLE}')) {{ throw 'Target window not found: {WINDOW_TITLE}'; }}; "
            "Start-Sleep -Milliseconds 350; "
            "[System.Windows.Forms.SendKeys]::SendWait('^p'); "
            "Start-Sleep -Milliseconds 260; "
            "[System.Windows.Forms.SendKeys]::SendWait('Agent Client: Send smoke message'); "
            "Start-Sleep -Milliseconds 170; "
            "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); "
            "Write-Output 'PROMPT_DISPATCHED'"
        )
        prompt_dispatch = _run(["winps", send_ps])
        prompt_dispatch.name = "prompt-dispatch"
        prompt_dispatch.detail = {"prefix": smoke_prefix, "target_window": WINDOW_TITLE}
        steps.append(prompt_dispatch)

        if prompt_dispatch.ok:
            steps.append(_verify_roundtrip_signal(smoke_prefix, log_baseline))

    ok = all(s.ok for s in steps)
    report = {
        "ok": ok,
        "timestamp": datetime.now().isoformat(),
        "phase": "complete" if ok else "restart-agent-dispatch",
        "contract": {
            "required": [
                "bridge-check",
                "build",
                "deploy",
                "restart-agent-dispatch",
                "prompt-dispatch",
                "roundtrip-log-assert",
            ],
            "note": "Restart and prompt steps are dispatch-level UI automation with gateway-log verification.",
        },
        "steps": [asdict(s) for s in steps],
    }

    _write_report(report)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
