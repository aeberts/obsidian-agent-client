---
entity: spec
title: "FR-1 Transport Abstraction Development Spec"
project: "[[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]"
status: draft
version: v0.1
owner: cos
dateCreated: "2026-04-20T12:30:35-07:00"
dateModified: "2026-04-20T12:30:35-07:00"
tags: [fr-1, transport, architecture, implementation]
---
# FR-1 Transport Abstraction Development Spec
> **For Hermes:** execute this spec in small commits; keep ACP behavior stable while introducing a transport seam for Hermes API.

## Goal
Implement a transport abstraction that allows OAC to run via ACP (existing path) or Hermes Gateway API (`/v1/responses`) without rewriting chat UI orchestration.

## Architecture (target)
- Keep `useAgent` / `useAgentSession` / `useAgentMessages` as primary orchestration hooks.
- Introduce a transport client interface and adapter implementations.
- Route all updates through a unified update/event model so UI logic remains transport-agnostic for core message flow.

## Current codebase anchors (verified)
- Plugin-level client factory: `src/plugin.ts` (`getOrCreateAcpClient`, `removeAcpClient`)
- Context dependency: `src/ui/ChatContext.ts` (`acpClient` today)
- Hook entrypoint: `src/hooks/useAgent.ts` (depends on `AcpClient` + `SessionUpdate`)
- Session management: `src/hooks/useAgentSession.ts`
- Prompt send path: `src/services/message-sender.ts`
- ACP implementation: `src/acp/acp-client.ts`, `src/acp/acp-handler.ts`, `src/acp/type-converter.ts`
- Session update union: `src/types/session.ts`
- Settings + UI: `src/plugin.ts`, `src/ui/SettingsTab.ts`, `src/services/settings-normalizer.ts`

---
## Task 1 — Define transport contracts
**Create**
- `src/types/transport.ts`

**Specify**
- `TransportMode = "acp" | "hermes-api"`
- `TransportEvent` (transport-agnostic envelope):
  - `transport`, `sessionId`, `requestId`, `timestamp`, `eventType`, `payload`, `isTerminal`
- `IAgentTransport` methods:
  - `initialize(config)`
  - `newSession(workingDirectory)`
  - `sendPrompt(sessionId, content)`
  - `cancel(sessionId)`
  - `disconnect()`
  - `onSessionUpdate(cb)`
  - Optional extension points for future: `onTransportEvent(cb)`, `dispose()`

**Acceptance**
- Types compile.
- No runtime changes yet.

---
## Task 2 — Introduce transport wrapper interface used by hooks
**Modify**
- `src/hooks/useAgent.ts`
- `src/hooks/useAgentSession.ts`
- `src/services/message-sender.ts`
- `src/ui/ChatContext.ts`

**Action**
- Replace hard dependency on `AcpClient` type with `IAgentTransport` (or narrow `AgentTransportClient` interface alias).
- Preserve function names currently expected by hooks/services (`initialize`, `newSession`, `sendPrompt`, `cancel`, `disconnect`, `onSessionUpdate`, config methods used today).

**Acceptance**
- Code compiles with ACP path unchanged.
- No behavior regressions in ACP mode.

---
## Task 3 — Make ACP implementation conform to transport contract
**Modify**
- `src/acp/acp-client.ts`

**Action**
- Declare ACP client as implementing the transport contract.
- Keep existing method semantics and update flow unchanged.
- Normalize ACP-originated transport errors into a consistent shape used by hooks.

**Acceptance**
- Existing ACP flow works (session create, send prompt, cancel, reconnect).
- `npm run build` and `npm run lint` pass.

---
## Task 4 — Add Hermes API transport (initial implementation)
**Create**
- `src/transport/hermes-api-transport.ts`

**Action**
- Implement contract using Hermes API server:
  - endpoint base URL (default `http://127.0.0.1:8642`)
  - auth key
  - `/v1/responses` request with conversation/session continuity
- Map Hermes responses into existing `SessionUpdate`/event expectations used by hooks.
- Implement cancellation behavior (best-effort terminal update).

**Acceptance**
- Can initialize and send at least one prompt in Hermes mode.
- Emits terminal update paths (`completed`/`failed`/`cancelled`) deterministically.

---
## Task 5 — Add transport selection to plugin settings
**Modify**
- `src/plugin.ts`
- `src/services/settings-normalizer.ts`
- `src/ui/SettingsTab.ts`

**Action**
- Add settings fields (minimal):
  - `transportMode: "acp" | "hermes-api"`
  - `hermesApiBaseUrl`
  - `hermesApiKey` (or key reference pattern compatible with existing settings model)
  - optional `hermesModel`
- Add UI controls in Settings tab under a new transport section.
- Validate required fields for Hermes mode and show actionable errors.

**Acceptance**
- Settings persist and reload correctly.
- Invalid Hermes config blocks request startup with clear guidance.

---
## Task 6 — Switch client factory from ACP-only to transport-aware
**Modify**
- `src/plugin.ts`
- `src/ui/ChatView.tsx`
- `src/ui/FloatingChatView.tsx` (if it directly references ACP client type)
- `src/ui/ChatContext.ts`

**Action**
- Replace `_acpClients` map with transport-agnostic client map.
- Update `getOrCreateAcpClient`/`removeAcpClient` naming to transport-safe APIs while preserving compatibility where needed.
- Ensure each view still has isolated client instance and lifecycle cleanup.

**Acceptance**
- Multiple views keep independent sessions.
- Closing a view disconnects/kills the corresponding transport client cleanly.

---
## Task 7 — Event normalization and core parity checks
**Modify**
- `src/types/session.ts` (only if required to represent Hermes event mapping)
- `src/services/message-state.ts`
- `src/hooks/useAgentMessages.ts`

**Action**
- Ensure both transports can drive the same message update pipeline for:
  - streaming chunks
  - tool updates
  - completion/error updates
- Avoid transport-specific branches in rendering logic for core chat flow.

**Acceptance**
- ACP and Hermes both render messages incrementally and terminate cleanly.
- No duplicate or missing terminal updates.

---
## Task 8 — Docs + validation checklist
**Modify/Create**
- `ARCHITECTURE.md`
- `README.md`
- `docs/usage/index.md` and/or new `docs/usage/transport-modes.md`

**Document**
- Transport architecture overview
- Settings required for Hermes mode
- Known caveats and fallback behavior

**Validation commands**
```bash
cd /home/zand/dev/obsidian-agent-client
npm run build
npm run lint
```

**Manual smoke matrix**
1. ACP mode: initialize → send prompt → stream → complete
2. ACP mode: cancel inflight prompt
3. Hermes mode: initialize → send prompt → stream/complete
4. Hermes mode: invalid auth key shows actionable error
5. Hermes mode: endpoint unavailable shows retry guidance

---
## Definition of Done (FR-1)
1. Transport contract exists and is used in hooks/services instead of ACP concrete type.
2. `AcpClient` conforms to contract with no baseline regressions.
3. `HermesApiTransport` works for basic prompt lifecycle with conversation continuity.
4. Transport mode is selectable/configurable via settings.
5. Build + lint pass.
6. Docs updated for architecture and setup.

## Risks / watchouts
- Session update model is ACP-shaped today; Hermes mapping may need additive update types.
- Cancellation semantics may differ between transports; enforce single terminal state at hook/store layer.
- Keep fork delta small: prefer additive abstraction over sweeping refactors.

## References
- [[Requirements - Adapted OAC Plugin]]
- [[T40-fr-1-transport-abstraction-development-spec]]
- `/home/zand/dev/obsidian-agent-client/ARCHITECTURE.md`
