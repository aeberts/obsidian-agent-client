---
sid: T-40
entity: todo
title: "T-40 FR-1: Transport Abstraction Development Spec"
status: done
priority: 1-high
urgency: med-urgent
todo_type: deep_work
flavor: must_do
energy_required: high
impact: 5
owner: cos
estimated_time_to_complete: 90
actual_time_to_complete: 12
dateCreated: 2026-04-20T12:18:41-07:00
dateModified: 2026-04-20T12:30:35-07:00
completedDate: "2026-04-20"
tags: [architecture, transport, specification, oac]
projects:
  - "[[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]"
---
## Details:
Create and validate the implementation-ready development spec for **FR-1 Transport Abstraction** from [[Requirements - Adapted OAC Plugin]].

### Scope
Design and specify a transport seam that supports both ACP and Hermes API without rewriting OAC UI behavior.

### Development Spec
#### 1) Interface contract (`IAgentTransport`)
Define a TypeScript interface with explicit lifecycle and event semantics:
- `initialize(sessionConfig)`
  - Inputs: transport mode, endpoint config, credentials handle, conversation/session id, timeout policy.
  - Output: initialized session context or typed initialization error.
- `send(request)`
  - Inputs: prompt/command payload + metadata (request id, mode, model override optional).
  - Behavior: starts request and emits streamed events through callback/observer.
- `cancel(requestId)`
  - Behavior: best-effort cancellation with deterministic terminal event (`cancelled`).
- `dispose()`
  - Behavior: release resources, listeners, and inflight handles.
- `onEvent(handler)`
  - Event stream contract for message chunks, tool events, status transitions, completion, and errors.

#### 2) Unified event model
Specify a transport-agnostic event envelope used by UI and stores:
- Core fields: `transport`, `sessionId`, `requestId`, `timestamp`, `eventType`, `payload`, `isTerminal`.
- Required event types:
  - `request.started`
  - `message.delta`
  - `message.completed`
  - `tool.started`
  - `tool.completed`
  - `request.completed`
  - `request.failed`
  - `request.cancelled`
- Mapping requirements:
  - ACP and Hermes implementations must map native events into this envelope.
  - UI should not branch on transport-specific payloads for core chat rendering.

#### 3) `AcpTransport` parity adapter
Specify ACP wrapper behavior:
- Preserve current user-visible behavior (chat flow, streaming cadence, error surfaces).
- Convert ACP native updates into unified event model.
- Normalize ACP-specific errors into common error shape:
  - `code`, `message`, `retryable`, `source`.

#### 4) `HermesApiTransport` adapter (initial)
Specify Hermes API implementation behavior:
- Use Hermes Gateway API (`/v1/responses`) with named conversation IDs.
- Support streaming response handling and map events to unified envelope.
- Handle auth/config errors explicitly at initialize time where possible.
- Provide deterministic completion semantics and error typing for network/timeouts.

#### 5) Transport selection and settings boundary
Specify where mode selection lives and how it is validated:
- Config key: transport mode (`acp` | `hermes-api`).
- Required settings for Hermes mode: endpoint, auth key reference, default model (optional override).
- Validation behavior:
  - block invalid config with actionable error message.
  - preserve ACP as safe fallback mode.

#### 6) State management contract
Define boundaries between transport and UI stores:
- Transport emits only normalized events; does not mutate UI state directly.
- Store layer is responsible for:
  - request lifecycle bookkeeping
  - message assembly from deltas
  - terminal state resolution

#### 7) Error and cancellation semantics
Specify deterministic behavior for all terminal paths:
- Exactly one terminal event per request (`completed` | `failed` | `cancelled`).
- Cancellation is idempotent and safe if request already terminal.
- Error envelope must include recovery guidance (`retry`, `check auth`, `check endpoint`, etc.).

#### 8) Test specification (FR-1 gate)
Minimum tests required before FR-1 can be marked done:
- Interface contract tests (compile-time + runtime behavior checks).
- Event normalization tests (ACP and Hermes produce required event set).
- Cancellation tests (inflight and already-terminal cases).
- Error normalization tests (auth/network/timeout/parsing).
- Backward-compat tests proving ACP parity for baseline scenarios.

#### 9) Definition of Done (FR-1)
FR-1 is complete only when:
1. `IAgentTransport` is implemented and used by chat execution path.
2. `AcpTransport` and `HermesApiTransport` both compile and run behind selector.
3. Unified event model powers rendering without transport-specific UI branching for core flow.
4. Contract and mapping docs are written in repo docs.
5. Test suite for FR-1 passes in CI/local.

### Deliverables
- Architecture note: transport interface + event schema + state boundaries.
- Implementation plan: ordered task breakdown for coding FR-1.
- Test plan: required test files and scenarios.
- Risk list: parity regressions, streaming edge cases, cancellation race conditions.

## Progress:
Completed FR-1 first-pass implementation spec with exact OAC file paths, task sequencing, validation commands, and Definition of Done.

## What Was Done:
Created and linked to [[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]].
Seeded with implementation-ready FR-1 development specs derived from [[Requirements - Adapted OAC Plugin]].
Authored detailed implementation document: [[FR-1 Transport Abstraction Development Spec]].
