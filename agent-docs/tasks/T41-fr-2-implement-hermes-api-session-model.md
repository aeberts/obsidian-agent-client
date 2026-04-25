---
sid: T-41
entity: todo
title: "T-41 FR-2 Implement Hermes API session model"
status: done
priority: 2-medium
urgency: med-urgent
todo_type: deep_work
flavor: should_do
energy_required: medium
impact: 4
owner: cos
estimated_time_to_complete: 120
dateCreated: 2026-04-20T13:53:07-07:00
dateModified: 2026-04-21T17:44:08-07:00
completedDate: "2026-04-21"
tags: [requirements, fr-2, implementation, oac, hermes]
projects:
  - "[[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]"
---
## Details:
Implement requirement **FR-2** from [[Requirements - Adapted OAC Plugin]].

### Scope
- Implement stable conversation ID strategy for continuity across turns.
- Map Hermes `/v1/responses` output/stream events into OAC message model (chunks, tool events, final text, errors).
- Add configurable endpoint/model/API key settings wiring for Hermes transport mode.

## Progress:
- FR-2 completed and validated by autopilot pipeline.
- Passing evidence recorded in artifacts: implementation exit 0, gate exit 0, and all gate steps green (`build`, `gateway smoke`, `ui smoke`, `wsl_windows_smoke`).
- Backlog state updated to `done` for FR-2.

## What Was Done:
Created from FR-2 requirement decomposition request for P-4 staged execution.
Advanced from initial HermesApiTransport baseline to a passing FR-gated implementation run.
