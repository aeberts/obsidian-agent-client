## Build & Deploy Notes

**Always use `npm run deploy` — not `npm run build`.**

`npm run build` compiles to `main.js` in the project root (WSL filesystem).
Obsidian (Windows) loads from the vault plugin directory, which is a separate copy:
`/mnt/c/Users/alexe/Dropbox/Hermes/OACTest/.obsidian/plugins/agent-client/main.js`

`npm run deploy` = build + copy to vault in one step.

To verify the right version is loaded, check for `[OAC] vX.Y.Z loaded` in the Obsidian
developer console (`Ctrl+Shift+I`) immediately after reloading the plugin.

Reload the plugin after each deploy: disable/re-enable in Obsidian settings, or
`Ctrl+P` → "Reload app without saving".

---

## FR-10 — DONE — 2026-04-23

**What was built:** TTFT timing instrumentation in `trySendViaResponsesStream`. Logs `connection`, `first-token`, `stream`, and `total` milliseconds after every send.

**Diagnosis result:** `connection=5ms  first-token=8731ms  stream=968ms  total=9704ms`
- HTTP connection to local gateway: instant (5ms) — not a bottleneck
- First-token latency: **8.7 seconds** — entirely server-side LLM prefill time
- Streaming throughput once started: fast (968ms)

**Root cause:** LLM prefill latency inside Hermes/model runtime. Not addressable from the OAC plugin. Session pre-warming was implemented and then reverted — it cannot help because the bottleneck is model compute, not session object creation or TCP overhead.

**Actionable follow-up (Hermes-side):** Reduce system prompt length, ensure model stays loaded in VRAM between requests, or investigate GPU utilization. OAC-side improvement: a visible "thinking…" placeholder could improve perceived responsiveness while waiting for the first token.

**Tests:** unit ✓ (build + tsc -noEmit) | gateway smoke ✓ (4/4)

**Gate:** build ✓, gateway smoke ✓

---

## FR-9 — DONE — 2026-04-23

**What was built:** SSE streaming via `POST /v1/responses` with `stream: true`. Tokens arrive progressively via `fetch()` ReadableStream. `consumeSseStream` parses SSE events and emits `agent_message_chunk` per `response.output_text.delta`. Terminates on `response.completed` (also emits `usage_update`). Fallback to blocking `requestUrl` path if streaming unavailable.

**Root causes fixed during development:**
- Runs API approach had a race condition (run completed before SSE connect) → switched to direct POST streaming
- `response.output_text.done` carries full accumulated text in `text` field → generic fallback in `extractSseText` was re-emitting entire response as duplicate → fixed by short-circuiting all `response.*` events except `response.output_text.delta`
- Server keeps SSE connection open after final event → `consumeSseStream` now returns on `response.completed` instead of waiting for EOF

**Tests:** unit ✓ (build + tsc -noEmit) | gateway smoke ✓ (4/4) | user test ✓ (2026-04-23)

**Gate:** build ✓, gateway smoke ✓, user test ✓

---

## NEXT SESSION — 2026-04-22

### Status
- FR-1 through FR-6: all DONE
- FR-7: pending (parity and safety baseline)

### Key architectural discovery: command routing gap

**Problem:** Discord `/status` returns structured session data; OAC `/status` returns an LLM-generated response. Root cause: Discord messages route through `handle_message()` → command registry → deterministic handler. `POST /v1/responses` bypasses the registry entirely and goes straight to the LLM.

**Upstream issue:** [#4386](https://github.com/NousResearch/hermes-agent/issues/4386) — "Add http_callback deliver mode to webhook adapter for outbound push to custom chatbots" — open, no comments, no linked PR. Covers the *outbound* push gap (Hermes → OAC for background task results). Does not cover the *inbound* routing gap (routing incoming OAC messages through the command registry).

**Decision:** Stay on `/v1/responses` LLM path for now (option 4). Do NOT build a webhook-based routing layer yet.

### Hybrid approach to investigate next session

Use the **Hermes REST API directly** for specific commands where structured data is already available, bypassing LLM entirely. Same pattern as the existing local command router but for Hermes-side state.

**Available endpoints (from https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server):**

```
GET  /api/jobs              — list all scheduled/background jobs  ← /queue, /background status
GET  /api/jobs/{job_id}     — single job details
POST /api/jobs/{job_id}/run — trigger immediate execution
GET  /v1/runs/{run_id}/events — SSE stream of run progress/tokens  ← richer than /v1/responses
GET  /health/detailed       — extended health metrics
GET  /v1/models             — list available models
GET  /v1/responses/{id}     — retrieve stored response by ID
```

**Proposed command routing table (hybrid):**

| Command       | Route             | Notes                                      |
|---------------|-------------------|--------------------------------------------|
| `/capture`    | local router      | already works                              |
| `/move`       | local router      | already works                              |
| `/done`       | local router      | already works                              |
| `/task-status`| local router      | already works                              |
| `/process-inbox` | local router  | already works                              |
| `/queue`      | `GET /api/jobs`   | structured list, no LLM needed             |
| `/status`     | session state     | need to confirm if endpoint exists         |
| `/model`      | `GET /v1/models`  | list + current, no LLM needed              |
| everything else | `/v1/responses` | LLM path, current behavior                 |

**Open question before implementing:** Does a session-status endpoint exist? Docs don't show `GET /v1/sessions/{id}` or similar. May need to check gateway source or ask the Hermes team. The `/status` command output (Session ID, Title, Created, Tokens, Connected Platforms) needs to come from somewhere.

**Also from messaging docs:** The API/Webhook platform is listed as an official adapter in the 17+ platform list. The webhook adapter *inbound* path (POSTing to Hermes webhook endpoint → routes through `handle_message()`) would give deterministic command dispatch — but the response delivery still requires #4386 or a polling mechanism. Not worth building now.

### FR-7 scope reminder
- ACP baseline scenarios continue to function
- Hermes mode shows actionable recovery guidance on failure classes (network/auth/timeout)
- No silent failure paths for core chat workflows
- Gate: `npm run test:gateway-smoke` + `npm run test:ui-smoke:wsl-win`

### UX note
- Shift+Enter submits instead of inserting newline in chat input — user reported, not yet investigated. Low priority.

### FR-4 cancellation fix — 2026-04-22
**Bug:** Cancel button logged "Cancelling current operation" but spinner stayed active and full response returned. Two root causes:
1. `HermesApiTransport.cancel()` was a no-op — `requestUrl` has no AbortController support so the in-flight request couldn't be interrupted.
2. `isSending` was only cleared by the `sendMessage` async flow completing, not by cancel.

**Fix:** Added `clearSending()` to `useAgentMessages` (forces `isSending=false` immediately). Overrode `cancelOperation` in `useAgent` to call `clearSending()` right after `transport.cancel()`. Added `cancelledSessions` Set to `HermesApiTransport` — response is silently dropped when `requestUrl` eventually returns.

**Also discovered:** `npm run build` compiles to WSL `main.js` but Obsidian loads from the Windows vault copy. All prior testing was on stale code. Added `npm run deploy` script. Always use `npm run deploy` going forward.

**User test result:** ✓ PASSED — cancel now unlocks UI immediately and suppresses the response.

---

## FR-7 — DONE — 2026-04-22

**What was built:** Actionable error UX for Hermes transport failures. `HermesError` class classifies network/auth/timeout/server errors at throw time. `useAgentMessages` detects `HermesError` and surfaces `suggestion` in the `ErrorBanner`. No-API-key path fixed from plain object throw to structured error. All error paths now reach the UI.

**Error classification:**
- No network connection → "Ensure the gateway is running: `hermes gateway start`"
- 401 → "Check your Hermes API key in Settings → Agent Client"
- 403 → "Your API key may not have permission for this operation"
- 408/timeout → "Try again or restart: `hermes gateway restart`"
- 500+ → "Check the Hermes gateway logs for details"

**Tests:** unit ✓ (build + tsc -noEmit) | e2e ✓ (gateway smoke 4/4) | user test ✓ (2026-04-23)

**Gate:** build ✓, gateway smoke ✓, WSL-Win smoke ✓, user test ✓

**Commit:** a8e187b (+ liveApiKey fix in follow-up, deployed as v0.6.1)

**Notes:**
- WSL-Win UI smoke 6/6 passed.
- Post-commit bug fix: `this.apiKey` was cached at init time — removing the key from settings mid-session had no effect. Fixed with `liveApiKey` getter that reads `plugin.settings.hermesApi.apiKey` at send time. Deployed as v0.6.1.
- `HermesError` is exported from `hermes-api-transport.ts` — importable by other hooks if needed.

---

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
