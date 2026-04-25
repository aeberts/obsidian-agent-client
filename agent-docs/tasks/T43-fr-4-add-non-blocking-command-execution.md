---
sid: T-43
entity: todo
title: "T-43 FR-4 Add non-blocking command execution"
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
tags: [requirements, fr-4, implementation, oac, hermes]
projects:
  - "[[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]"
---
## Details:
Implement requirement **FR-4** from [[Requirements - Adapted OAC Plugin]].

### Scope
- Implement queued/background execution model for long operations.
- Allow issuing additional commands while jobs are running.
- Expose per-job lifecycle states: queued, running, succeeded, failed, cancelled.

## Progress:
Not started.

## What Was Done:
Created from FR-4 requirement decomposition request for P-4 staged execution.
