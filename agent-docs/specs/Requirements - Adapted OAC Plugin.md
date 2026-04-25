---
entity: spec
title: "Requirements - Adapted OAC Plugin"
project: "[[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]"
status: draft
version: v0.1
owner: cos
dateCreated: "2026-04-19T13:58:24-07:00"
dateModified: "2026-04-19T13:58:24-07:00"
tags: [requirements, obsidian, hermes, oac, architecture]
---
# Requirements - Adapted OAC Plugin
## Purpose
Define first-pass requirements for adapting Obsidian Agent Client (OAC) to use Hermes Gateway API transport (`HermesApiTransport`) while preserving OAC UX and enabling speed-of-thought Polaris workflows.
## Problem Statement
Current OAC + LLM-turn workflow is too slow and blocking for basic task operations. From [[Polaris Usage Feedback]]:
- Capture is not fast enough for rapid thought streams.
- LLM turns block subsequent commands.
- Simple deterministic operations (capture/move/status) are too expensive in time/tokens.
- Needing to decide task destination at capture-time adds cognitive overhead.
## Product Goals
1. **Speed-of-thought capture:** near-instant task capture without waiting for LLM turns.
2. **Non-blocking interactions:** user can issue multiple actions without serialized chat blocking.
3. **Deterministic cheap ops:** basic task edits should run locally/directly where possible.
4. **Upgrade-safe architecture:** keep fork delta modular and upstream-pullable.
5. **Hermes-native power path:** preserve advanced reasoning/tool workflows via Hermes API.
## Non-Goals (Phase 1)
- Full replacement of Obsidian editor ergonomics (e.g., Roam-like block drag/drop).
- Solving all Obsidian rendering/view consistency issues.
- Rebuilding OAC UI from scratch.
## Users and Primary Workflows
- **Primary user:** Zand (high capture velocity, low tolerance for blocking interactions).
- **Core workflows:**
  1. Rapid inbox capture (single and burst mode)
  2. Quick deterministic updates (move task, set status, assign project)
  3. Batch inbox processing in background
  4. Start long-running Hermes task and continue working immediately
## Functional Requirements
### FR-1 Transport Abstraction
- Introduce `IAgentTransport` with at least:
  - session initialize
  - send prompt/command
  - stream/event callback
  - cancel operation
- Provide implementations:
  - `AcpTransport` (existing behavior parity)
  - `HermesApiTransport` (OpenAI-compatible Hermes API `/v1/responses`)
### FR-2 Hermes API Session Model
- Support stable conversation IDs for continuity.
- Map response events to OAC message model (stream chunks, tool events, final text, errors).
- Allow configurable endpoint/model/API key in plugin settings.
### FR-3 Deterministic Local Command Router
- Add local fast-path for operations that do not require reasoning:
  - create/capture todo
  - move todo between projects
  - update status/metadata
- Router must explicitly escalate to Hermes transport when operation is ambiguous or complex.
### FR-4 Non-Blocking Command Execution
- Support queued/background execution for long operations.
- User can continue issuing commands while jobs run.
- Show per-job states: queued, running, succeeded, failed, cancelled.
### FR-5 Batch Inbox Processing
- Provide command/workflow to process inbox items in batch.
- Batch must be async-capable and status-visible.
- Support policy toggle: process all vs process selected tasks only.
### FR-6 Command Surface and UX Contract
- Define which commands are:
  - local deterministic
  - Hermes roundtrip
  - background-only
- Keep command behavior deterministic and discoverable.
### FR-7 Parity and Safety
- Maintain parity baseline with ACP mode for core chat reliability.
- Define failure UX for network/auth/timeouts with actionable recovery guidance.
## Non-Functional Requirements
### NFR-1 Latency Targets (first-pass)
- Deterministic local ops: target p95 <= 1.5s.
- Capture append flow: target p95 <= 1.0s.
- Background kickoff acknowledgment: <= 1.0s.
### NFR-2 Reliability
- Retries/backoff for transient transport errors.
- Safe cancellation semantics for in-flight requests/jobs.
- No silent failures; all failures produce visible status.
### NFR-3 Upgrade-Safe Maintainability
- Hermes-specific logic behind a transport/command boundary.
- Minimal invasive edits to OAC core.
- Documented upstream sync/rebase process.
### NFR-4 Token/Cost Efficiency
- Prefer deterministic execution for simple operations.
- Avoid unnecessary LLM invocations for known transformations.
## Constraints and Assumptions
- Hermes API server available at `http://127.0.0.1:8642`.
- Auth key is available and already validated by smoke test.
- OAC fork repo exists and builds locally.
## Acceptance Criteria (Phase 1 Exit)
1. User can capture 5+ rapid tasks without waiting for prior LLM turn completion.
2. Move/status changes can execute through deterministic fast-path with visible confirmation.
3. Batch inbox processing runs in background with progress and completion state.
4. Hermes chat flow works through `HermesApiTransport` with streaming and conversation continuity.
5. ACP mode still functions (parity check for baseline scenarios).
6. Setup + operational docs exist for day-to-day use and upstream maintenance.
## Open Questions
1. Which exact command grammar should be first-class in adapted OAC (`pt:`, `process:`, custom slash set)?
2. What minimum event schema is needed to represent Hermes background jobs cleanly in OAC UI?
3. Should deterministic local ops write directly to vault files or call a local helper endpoint/script?
4. What should be the default policy for inbox processing (manual trigger vs auto background)?
## Traceability to Existing Tasks
- Requirements authoring: [[T28-create-requirements-document-for-adapted-oac-plugin]]
- Transport spike: [[T27-spike-hermes-api-transport-in-oac-fork]]
- Command/UX and implementation tracks: [[T29-define-command-surface-and-ux-contract]] to [[T39-write-developer-docs-runbook-and-upstream-sync-playbook]]
## References
- [[Polaris Usage Feedback]]
- [[T26-consider-custom-obsidian-platform-adapter]]
- [[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]
