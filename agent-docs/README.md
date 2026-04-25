# Agent Docs — Context Pack Index

This folder contains portable context artifacts for agent runs.

## Canonical instructions
- Use **`../AGENTS.md`** as the single source of truth for behavior, loop, gates, telemetry, and guardrails.

## Launch prompt
- Use **`PROMPT.md`** for **Live Claude** (interactive terminal run) kickoff text.

## Contents

### FR queue (canonical for Live Claude + Auto Claude)
- `fr-backlog.yaml`

### Specs (`specs/`)
- `Requirements - Adapted OAC Plugin.md`
- `FR-1 Transport Abstraction Development Spec.md`
- `P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview.md`

### Task notes (`tasks/`)
- `T40-fr-1-transport-abstraction-development-spec.md`
- `T41-fr-2-implement-hermes-api-session-model.md`
- `T42-fr-3-build-deterministic-local-command-router.md`
- `T43-fr-4-add-non-blocking-command-execution.md`
- `T44-fr-5-implement-batch-inbox-processing-workflow.md`
- `T45-fr-6-define-command-surface-and-ux-contract.md`
- `T46-fr-7-implement-parity-and-safety-baseline.md`
- `T47-investigate-wsl-windows-obsidian-ui-automation-loop.md`
- `T48-fix-auto-mention-current-note-tracking-in-hermes-path.md`

### Session continuity (`sessions/`)
- `2026-04-21-session-notes.md`

### Autopilot/smoke runners (`autopilot/`)
- `wsl_windows_oac_smoke.py`
- `hermes_gateway_smoke.py`
- `run_fr_autopilot.py`
- `verify_fr_gate.sh`

## Notes
- This folder was moved from `docs/hermes-context` to `agent-docs`.
- Keep this as context/index material; keep policy/instructions centralized in `AGENTS.md`.
