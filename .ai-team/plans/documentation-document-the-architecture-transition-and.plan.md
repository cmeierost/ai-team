---
id: document-the-architecture-transition-and
type: documentation
title: Document the architecture transition and local backlog
createdBy: human
createdByType: human
parentPlanId: transition-service-boundaries-away-from-
status: completed
priority: urgent
requiresApproval: false
estimatedHours: 3
completedAt: 2026-04-12T12:00:00.000Z
tags:
  - architecture
  - docs
  - backlog
metadata:
  deliverable: architecture-doc-refresh
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z
deadline: null
assignedTo: taylor-reed

------

## Done

Refresh the architecture docs so they clearly distinguish:

- [ ] what is true in the code today
- [ ] what is target architecture only
- [ ] what is actively being migrated
- [ ] where the durable local backlog lives

## Acceptance notes

- `ARCHITECTURE.md` links to `.ai-team/plans/`.
- `COPILOT-CONTEXT.md` points coding agents to the local backlog.
- [ ] Architecture overview and diagrams mention both current state and target direction.
- `.ai-team/README.md` documents the `tasks/` directory.
