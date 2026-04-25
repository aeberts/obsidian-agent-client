---
entity: project
title: "P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface"
sid: P-4
status: active
project_type: finite
todo_type: personal
tags: [system, architecture, obsidian, hermes]
owner: cos
start_date: "2026-04-19"
target_date:
review_cadence: weekly
dateCreated: "2026-04-19T12:37:36-07:00"
dateModified: "2026-04-21T17:44:08-07:00"
---
# Adapt Obsidian Agent Client to use HermesAPITransport interface
Build and maintain a fork of Obsidian Agent Client that adds a Hermes API transport (`HermesApiTransport`) while preserving upstream pullability and keeping Hermes communication concerns isolated.
## Inbox
TBD
## Active Todos
[[T38-build-testing-matrix-and-regression-harness]]
[[T31-implement-hermes-api-auth-and-settings-model]]
[[T34-map-hermes-events-to-oac-ui-primitives]]
[[T36-complete-config-wiring-and-validation-hardening]]
[[T29-define-command-surface-and-ux-contract]]
[[T35-create-acp-vs-hermes-parity-audit-and-baseline]]
[[T42-fr-3-build-deterministic-local-command-router]]
[[T43-fr-4-add-non-blocking-command-execution]]
[[T44-fr-5-implement-batch-inbox-processing-workflow]]
[[T45-fr-6-define-command-surface-and-ux-contract]]
[[T46-fr-7-implement-parity-and-safety-baseline]]
[[T32-build-deterministic-local-task-ops-router]]
[[T33-add-non-blocking-job-workflow-and-progress-events]]
[[T37-harden-operational-resilience-retries-cancellation-and-recovery]]
[[T39-write-developer-docs-runbook-and-upstream-sync-playbook]]
## Completed
[[T48-fix-auto-mention-current-note-tracking-in-hermes-path]]
[[T47-investigate-wsl-windows-obsidian-ui-automation-loop]]
[[T41-fr-2-implement-hermes-api-session-model]]
[[T26-consider-custom-obsidian-platform-adapter]]
[[T28-create-requirements-document-for-adapted-oac-plugin]]
[[T40-fr-1-transport-abstraction-development-spec]]
[[T30-design-transport-boundary-and-session-model]]
[[T27-spike-hermes-api-transport-in-oac-fork]]
## Notes
- Goal: keep frontend UX from OAC, replace ACP-only backend constraints with pluggable transport (`AcpTransport` + `HermesApiTransport`).
- Strategy: keep fork delta small and modular so upstream updates are easy to merge.
- Milestone reached (2026-04-20): Hermes API transport works end-to-end in OACTest vault, including `@[[note]]` mention flow and in-note edit request.
- Autopilot milestone reached (2026-04-21): FR-1 and FR-2 both passed FR-gated automation (implement + build + gateway smoke + UI smoke + WSL Windows smoke).
- Session snapshot: [[Sessions/2026-04-20-session-notes|Session Notes — 2026-04-20]] (context recovery + current debug pickup point).
## References:
- Requirements draft: [[Requirements - Adapted OAC Plugin]]
- FR-1 implementation spec: [[FR-1 Transport Abstraction Development Spec]]
- Origin task: [[T26-consider-custom-obsidian-platform-adapter]]
- Parent initiative: [[P-3 Hermes Improvements Overview]]
