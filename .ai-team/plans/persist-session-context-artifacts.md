---
id: persist-session-context-artifacts
type: feature
title: Persist session-loaded skills and instructions in storage
status: todo
priority: medium
assignedTo: alex-morgan
createdBy: human
createdByType: human
requiresApproval: false
subtaskIds: []
estimatedHours: 10
deadline: null
tags:
  - service
  - storage
  - context
  - session
createdAt: 2026-04-14T21:27:00.000Z
updatedAt: 2026-04-14T21:27:00.000Z
---

## Goal

Persist runtime-loaded context artifacts so the system can reliably track what was actually loaded into a session over time. This should include at least session-loaded skills and relevant workspace instructions, and should support future context diagnostics and UI transparency.

## Action Items

- [ ] Define storage contract changes for tracking loaded session skills and loaded session instructions separately from static agent config.
- [ ] Decide ownership boundaries for persistence logic across `packages/service` and any shared contracts in `packages/core`/`packages/api-client`.
- [ ] Add migration(s) for new persistence fields/tables in SQLite storage.
- [ ] Record loaded skills when they are activated in-session and ensure retrieval APIs expose them.
- [ ] Record relevant instructions when they are included in context for a turn/session and ensure retrieval APIs expose them.
- [ ] Add/update unit tests for persistence, serialization, and retrieval paths.
- [ ] Add/update API/client contract tests if response shapes change.
- [ ] Update docs impacted by persistence and context reporting behavior (`docs/api/contracts.md`, relevant architecture/implementation docs).
