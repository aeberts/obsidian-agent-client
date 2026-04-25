---
sid: T-42
entity: todo
title: "T-42 FR-3 Build deterministic local command router"
status: ready
priority: 2-medium
urgency: med-urgent
todo_type: deep_work
flavor: should_do
energy_required: medium
impact: 4
owner: cos
estimated_time_to_complete: 120
dateCreated: 2026-04-20T13:53:07-07:00
dateModified: 2026-04-20T13:53:07-07:00
tags: [requirements, fr-3, implementation, oac, hermes]
projects:
  - "[[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]"
---
## Details:
Implement requirement **FR-3** from [[Requirements - Adapted OAC Plugin]].

### Scope
- Implement local fast-path operations for capture/create todo, move todo between projects, and update status/metadata.
- Define escalation rules to Hermes transport for ambiguous or complex operations.
- Add clear execution-path visibility so user can tell local vs Hermes execution.

## Progress:
Not started.

## What Was Done:
Created from FR-3 requirement decomposition request for P-4 staged execution.
