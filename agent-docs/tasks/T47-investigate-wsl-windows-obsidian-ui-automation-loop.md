---
sid: T-47
entity: todo
title: "T-47 Investigate WSL↔Windows Obsidian UI automation loop"
status: done
priority: 2-medium
urgency: med-urgent
todo_type: deep_work
flavor: should_do
energy_required: medium
impact: 4
owner: cos
estimated_time_to_complete: 120
dateCreated: 2026-04-20T16:39:33-07:00
dateModified: 2026-04-21T17:44:08-07:00
completedDate: "2026-04-21"
tags: [automation, e2e, obsidian, electron, wsl, windows, hermes]
projects:
  - "[[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]"
---
## Details:
Investigate and design a reliable end-to-end automation path for driving Obsidian UI tests when Hermes development tooling runs in WSL and Obsidian runs on Windows.

### Scope
- Validate viable control strategies for Windows-side Obsidian from WSL context (Playwright Electron, Windows host runner, bridge/wrapper options).
- Define the minimal executable loop:
  1. build plugin,
  2. copy plugin artifacts to OACTest vault,
  3. restart required services,
  4. restart agent in OAC (mandatory step; prefer programmatic code-path over UI click when possible),
  5. drive UI interaction,
  6. collect artifacts/log feedback,
  7. repeat.
- Prefer gateway `agent.log` as primary verification signal; use Obsidian console only when UI-side signals are required.
- Document known cross-boundary risks and mitigations (path mapping, process launch boundaries, display/session constraints).

### Decisions (2026-04-21)
- **Pass criterion:** one successful UI prompt roundtrip with `agent.log` evidence is sufficient for first milestone.
- **Execution mode:** whichever works first (headed vs background) is acceptable.
- **Quality bar:** not production hardening; optimize for fast bug-finding and iterative dev loop.
- **Control-plane split:** WSL orchestrates build/deploy/log assertions; Windows runs UI automation (Playwright/Electron) and returns machine-readable results.
- **Restart-agent requirement:** include explicit OAC restart-agent action in every smoke run.
- **Debug signal policy:** treat `agent.log` as source-of-truth; confirm availability of network + Obsidian/UI + modified OAC transport logs.
- **ACP transport hardening:** never emit human-formatted terminal prompts on ACP stdio. JSON stream must remain clean line-delimited JSON only.
- **Upgrade safety gate:** after every `hermes update`, run an OAC transport smoke (ACP + Hermes gateway transport if enabled) before trusting normal workflows, because output/schema drift can break client parsers.

### Environment prerequisites
- WSL: Node/npm/python available (confirmed).
- WSL→Windows bridge required for automation handoff (present). Current safe path is `~/bin/winps`, which launches Windows PowerShell and bootstraps Machine+User Windows PATH before running commands.
- `/etc/wsl.conf` typo identified and corrected by user (`appendWindowsPath=[true]` → `appendWindowsPath=true`); will take effect after WSL restart.
- Windows: Node/npm available in interactive Windows shell (`node v24.15.0`, `npm 11.12.1`), but not reliably discoverable from WSL-launched shells until PATH propagation is fixed/reloaded.
- Windows: Playwright + Electron automation deps required in the runner workspace (install during implementation phase after Node is present).

### Next implementation slice
1. Use `~/bin/winps` as the immediate WSL→Windows execution shim for automation commands (until post-restart PATH behavior is validated).
2. Add automation-friendly OAC restart-agent trigger path.
3. Create first smoke script + result artifact contract.
4. Validate logs contain required debug classes.

### Session restart pickup checklist (first 10 minutes)
1. Confirm WSL→Windows command invocation works:
   - `winps "$PSVersionTable.PSVersion.ToString()"` (preferred shim), or
   - `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"` (absolute-path fallback).
2. Verify/install Windows Node toolchain:
   - In Windows PowerShell: `node -v` and `npm -v`.
   - From WSL shim: `winps "node -v; npm -v"`.
   - If still missing in interactive shell, reinstall Node LTS MSI and reopen PowerShell, then re-run checks.
3. Confirm OAC workspace state in WSL:
   - repo path: `/home/zand/dev/obsidian-agent-client`
   - branch: `feature/fr1-transport-development`
   - debug logs still present in `src/transport/hermes-api-transport.ts`.
4. Start implementation at **Next implementation slice #2** (restart-agent trigger path), then continue with #3 and #4.

### Definition of Done
- One recommended architecture selected and documented.
- A reproducible smoke workflow is runnable by command/script and verifies one UI prompt roundtrip.
- Follow-on implementation tasks are explicitly listed for productionizing the loop.

## Progress:
Completed. WSL↔Windows automation loop is now reproducible and FR-gated: autopilot completed FR-1 and FR-2 with passing build, gateway smoke, UI smoke, and WSL Windows smoke checks. Target-window fail-closed dispatch and mandatory restart-agent step are validated in the passing pipeline.

## What Was Done:
- Captured user request to explore full autonomous development cycle with special focus on WSL↔Windows UI-driving constraints.
- Added explicit restart-agent requirement in loop.
- Recorded architecture decisions (WSL orchestrator + Windows UI runner), logging policy, and first-milestone pass criteria.
- Diagnosed PATH propagation mismatch between interactive Windows shell and WSL-launched Windows processes.
- Added `~/bin/winps` shim to bootstrap Windows Machine+User PATH for WSL→Windows command execution.
- Confirmed user fixed `/etc/wsl.conf` interop typo; pending restart to validate native PATH propagation behavior.
- Investigated OAC "auto-mention not working" report and traced primary failure to ACP JSON stream corruption (sudo prompt box text emitted to stdout).
- Patched local Hermes runtime (`tools/terminal_tool.py`) to gate sudo prompting behind TTY checks (`stdin.isatty && stdout.isatty`) so ACP stdio remains JSON-safe.
- Added and passed regression test for non-TTY interactive ACP sessions (`tests/tools/test_terminal_tool.py`).
- Added automation-friendly restart command path in OAC (`restart-agent` command → `agent-client:restart-agent-requested` workspace event) so restart can be triggered without menu clicking.
- Added WSL orchestrator smoke script `scripts/wsl_windows_oac_smoke.py` and npm entry `test:ui-smoke:wsl-win`.
- Smoke script now performs bridge check, plugin build, artifact deploy to OACTest, and mandatory restart-agent dispatch through Windows command palette automation (SendKeys).
- Added machine-readable smoke result contract output at `artifacts/oac-smoke/latest.json`.
- Executed smoke end-to-end and observed successful contract completion including `RESTART_DISPATCHED` signal.
- During extended prompt-dispatch automation, SendKeys targeted the wrong active Obsidian window once (ACP main chat) and injected command text.
- Hardened smoke targeting to fail closed unless an explicit target window title is activated (`OAC_WINDOW_TITLE`, default `OACTest`).
- Verified fail-closed behavior: when test window title is not found, smoke aborts with `Target window not found: OACTest` and no key injection into arbitrary windows.
- Final validation run used explicit window title (`Hermes Test Note - OACTest - Obsidian 1.12.7`), and full FR autopilot pipeline passed with green gate summaries for FR-1 and FR-2.
