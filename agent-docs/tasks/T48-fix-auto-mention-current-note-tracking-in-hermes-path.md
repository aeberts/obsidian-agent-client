---
sid: T-48
entity: todo
title: "T-48 Fix auto-mention current note tracking in Hermes transport path"
status: done
priority: 1-high
urgency: med-urgent
todo_type: deep_work
flavor: must_do
energy_required: medium
impact: 5
owner: cos
estimated_time_to_complete: 90
dateCreated: 2026-04-21T09:17:13-07:00
dateModified: 2026-04-21T17:44:08-07:00
completedDate: "2026-04-21"
tags: [obsidian, oac, auto-mention, active-note, hermes-transport]
projects:
  - "[[P-4 Adapt Obsidian Agent Client to use HermesAPITransport interface Overview]]"
---
## Details:
Implement and verify a fix so **Auto-mention current note** always tracks the currently selected markdown tab/note in the Hermes transport path (without relying on ACP-only behavior).

### Scope
- Reproduce current stale-note behavior in OACTest/Hermes mode.
- Update active-note tracking so tab/leaf switches refresh the source note even when chat input has focus.
- Keep behavior deterministic for send-time mention insertion.
- Add regression coverage or smoke steps to prevent reintroduction.

### Definition of Done
- Sending with auto-mention enabled references the currently selected note, not a stale prior note.
- Works across note tab switches and return-to-chat flows.
- Verification evidence captured in session notes/logs.

## Progress:
Completed via FR autopilot run. FR-2 gates passed (build, gateway smoke, UI smoke, WSL Windows smoke), and auto-mention behavior in Hermes path was validated as part of the passing requirement run.

## What Was Done:
- Captured this as a dedicated P-4 todo to avoid spending cycles on old ACP-only path fixes unless a trivial uplift appears.
- Executed autonomous FR-gated implementation and validation; FR-2 completed successfully with green gate summary and backlog marked done.
