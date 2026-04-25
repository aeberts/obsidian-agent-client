# AGENTS.md — Canonical Agent Execution Guide

This is the **single source of truth** for autonomous coding instructions in this repo.
If any other instruction file conflicts, follow **AGENTS.md**.

## Scope

Project: `obsidian-agent-client`

Primary objective: execute FR backlog incrementally for Hermes transport while preserving upgrade-safe seams and ACP reliability.

## Run modes (naming)

- **Live Claude**: interactive Claude session kicked off from terminal using `agent-docs/PROMPT.md`.
- **Auto Claude**: non-interactive run via `python scripts/run_fr_autopilot.py ...`.
- Both modes use **`agent-docs/fr-backlog.yaml`** as the single FR queue source of truth.

## Read order (every run)

1. `AGENTS.md` (this file)
2. `agent-docs/fr-backlog.yaml`
3. `agent-docs/specs/Requirements - Adapted OAC Plugin.md`
4. Relevant artifacts from previous attempts:
   - `artifacts/fr-autopilot/<FR>/...`
   - `artifacts/fr-gates/<FR>/...`

## Restart / recovery context

Assume prior runs may have left partial code and artifacts.
Treat existing work as candidate input, not ground truth.

Before coding:
1. `git status --short`
2. `git diff --stat`
3. Review latest FR artifacts (autopilot + gate)
4. Write a brief reconciliation decision in `PROGRESS.md` (keep/fix/revert for current FR)

## FR execution loop (required)

Process FRs in `agent-docs/fr-backlog.yaml` order.

For each FR:
1. Read requirement + acceptance criteria.
2. Write a short 3–5 step plan.
3. Implement minimal scoped change for this FR only.
4. Run required gates/tests.
5. Update `PROGRESS.md` and `progress.jsonl`.
6. Commit focused changes.
7. Continue to next FR.

## Queue policy

- `done` → skip.
- `pending` → execute normally.
- `blocked` → attempt one focused unblock pass first, then continue per policy.

## Required gates

- `npm run build`
- `npm run test:gateway-smoke`
- `npm run test:ui-smoke:wsl-win`
- Plus any FR-specific gate commands in `agent-docs/fr-backlog.yaml`

A feature is **not DONE** unless required gates are green.

## Telemetry + progress contract

### PROGRESS.md
One section per FR with:
- DONE or BLOCKED
- what was built
- tests/gates status
- commit hash
- notes for next session

### progress.jsonl
Append machine-readable events (one JSON per line), at minimum:
- `feature_started`
- `plan_written`
- `implementation_pass_completed`
- `unit_tests_passed|failed`
- `e2e_tests_passed|failed|na`
- `gate_passed|failed`
- `feature_done|feature_blocked`
- `commit_created`

On failure include:
- `error_summary`
- `repro_command`
- `artifacts` (array of file paths)

## Guardrails

- No unrelated refactors.
- Preserve ACP parity unless the FR explicitly changes behavior.
- Keep transport-specific logic behind seams/boundaries.
- Keep changes minimal and upgrade-safe.
- Never mark FR done without gate evidence.

## Failure policy

- If a gate fails, fix only what is required for current FR and retry.
- If FR remains blocked after allowed attempts, mark `blocked`, log full evidence, and move on/stop per run policy.

## Usage/context management (interactive Claude)

- Run `/usage` at FR start/end.
- Run `/compact` every ~3 features or when context gets heavy.
- If near usage/context limit:
  - finish current FR cleanly,
  - commit,
  - append `NEXT SESSION` block to `PROGRESS.md`,
  - stop.

## Commands

- Build: `npm run build`
- Gateway smoke: `npm run test:gateway-smoke`
- Windows UI smoke: `npm run test:ui-smoke:wsl-win`
- Autopilot runner: `python scripts/run_fr_autopilot.py --backlog agent-docs/fr-backlog.yaml`
- Gate script: `scripts/verify_fr_gate.sh`

## Related files

- `agent-docs/PROMPT.md` = Live Claude kickoff prompt (interactive terminal mode).
- `agent-docs/README.md` = context-pack index (spec/task/session/autopilot files), not canonical behavior rules.
- `CLAUDE.md` may be a symlink/alias to this file for Claude compatibility.
