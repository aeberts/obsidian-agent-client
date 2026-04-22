## FR-6 — DONE — 2026-04-22

**What was built:** Gateway command discovery seam. `HermesApiTransport` calls `GET /v1/commands` at session start (`newSession`/`loadSession`/`resumeSession`) and emits `available_commands_update` if the gateway returns a list. Degrades silently on 404. Command classification contract codified in `fetchAndEmitGatewayCommands` JSDoc.

**Tests:** unit ✓ (build + tsc -noEmit) | e2e ✓ (gateway smoke 4/4, WSL-Win smoke PASS)

**Gate:** build ✓, gateway smoke ✓, wsl-win smoke ✓

**Commit:** b1b5666

**Notes:**
- Gateway doesn't implement `/v1/commands` yet — transport degrades silently, no regression.
- When the gateway adds the endpoint, client picks it up automatically with no further changes needed.
- `LOCAL_COMMANDS` in `ChatPanel.tsx` remains correct for client-side deterministic commands.

---

## FR-5 — DONE — 2026-04-22

**What was built:** Batch inbox processing command with process-all and process-selected policies. `process inbox` marks all unchecked tasks in Inbox.md as done and moves them to Archive.md; `process inbox 1,3,5` processes by 1-based index. Progress placeholder updates mid-batch via `onProgress` → `replaceMessage`.

**Tests:** unit ✓ (build + tsc -noEmit) | e2e ✓ (gateway smoke 4/4, WSL-Win smoke 6/6)

**Gate:** build ✓, gateway smoke ✓, wsl-win smoke ✓

**Commit:** eac4714

**Notes:**
- `BatchInboxCommand` added to `ParsedCommand` union; parsed by `BATCH_INBOX_RE`.
- `executeLocalCommand` now accepts optional `onProgress: (msg: string) => void` — only used by batch-inbox, transparent to other commands.
- Archive destination hardcoded to `Archive.md` — can be made configurable in FR-6 UX contract pass.

---

## FR-4 — DONE — 2026-04-22

**What was built:** Non-blocking execution for local commands — vault ops post a "⟳ Running…" placeholder immediately then replace it with the result (or error) asynchronously, so the user can keep interacting. Cancellation wired into `handleStopGeneration` via a job ref.

**Tests:** unit ✓ (build + tsc -noEmit) | e2e n/a (WSL/Windows smoke env-blocked, pre-existing); gateway smoke 4/4

**Gate:** build ✓, gateway smoke ✓, wsl-win smoke environment-blocked (pre-existing)

**Commit:** f251b21

**Notes:**
- `replaceMessage(id, msg)` added to `useAgentMessages` and exposed through `useAgent`.
- Local path in `useChatActions.handleSendMessage` uses `void (async () => {...})()` to fire without blocking the hook.
- `localJobRef` tracks the active job; `handleStopGeneration` marks it cancelled before calling `agent.cancelOperation`.

---

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
