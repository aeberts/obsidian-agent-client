# FR Auto Claude Files

Canonical locations:
- Backlog (single source of truth): `agent-docs/fr-backlog.yaml`
- Runner: `scripts/run_fr_autopilot.py`
- Gate: `scripts/verify_fr_gate.sh`

This folder mirrors runner/smoke files so autonomous agents can discover tooling from a single context bundle.

## Run modes
- **Live Claude**: interactive terminal run using `agent-docs/PROMPT.md`
- **Auto Claude**: scripted run via `python scripts/run_fr_autopilot.py ...`

Both modes use `agent-docs/fr-backlog.yaml`.

## Quick start

1. Set Claude command template:

```bash
export CLAUDE_IMPLEMENT_CMD='claude -p "$(cat {prompt_file})"'
```

2. Run Auto Claude:

```bash
python scripts/run_fr_autopilot.py --backlog agent-docs/fr-backlog.yaml
```

3. Artifacts:
- `artifacts/fr-autopilot/<FR>/attempt-*/`
- `artifacts/fr-gates/<FR>/attempt-*/`

## Gate behavior
`verify_fr_gate.sh` runs, in order:
1. `npm run build`
2. each FR `gate_commands` entry
3. `python scripts/wsl_windows_oac_smoke.py`

If any step fails, the attempt fails and FR advancement stops.
