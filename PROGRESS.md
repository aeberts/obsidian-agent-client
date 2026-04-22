## FR-3 — DONE — 2026-04-22

**What was built:** Deterministic local command router that intercepts `capture`, `move`, `done`, and `status` commands in `handleSendMessage`, executes them directly against the Obsidian vault, and explicitly escalates everything else to the Hermes transport.

**Tests:** unit ✓ (build + tsc -noEmit) | e2e n/a (WSL/Windows smoke requires live Obsidian window; gateway smoke 4/4)

**Gate:** build ✓, gateway smoke ✓, wsl-win smoke environment-blocked (OACTest window not open — pre-existing constraint, not a regression)

**Commit:** (see git log for FR-3 commits)

**Notes:**
- Router lives in `src/transport/local-command-router.ts` — pure functions `routeCommand` (parse/classify) and `executeLocalCommand` (vault ops).
- Integration point: `src/hooks/useChatActions.ts:handleSendMessage` — local fast-path runs before `agent.sendMessage`.
- Escalation is explicit: `routeCommand` returns `{ kind: "escalate" }` for anything not matching known patterns, falling through to Hermes transport unchanged.
- WSL/Windows UI smoke blocked by missing live Obsidian window in CI — pre-existing environment constraint across all FRs.
