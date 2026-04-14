---
id: roll-out-stricter-dependency-injection-a
type: feature
title: Roll out stricter dependency injection across service composition seams
createdBy: human
createdByType: human
parentPlanId: transition-service-boundaries-away-from-
status: not_started
priority: high
requiresApproval: false
estimatedHours: 16
tags:
  - architecture
  - dependency-injection
  - container
metadata:
  followUp: true
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z
deadline: null
assignedTo: alex-morgan

------

## Goal

Move from ad-hoc concrete dependency wiring toward explicit constructor/function injection and cleaner startup composition.

## Desired rules

- [ ] prefer direct function injection when it stays simple
- [ ] inject a deps object when argument count becomes large
- [ ] use classes only when stateful collaboration really needs them
- [ ] keep implementation selection at startup/bootstrap time

## Scope note

This is intentionally a follow-up task after the mediator/notifier clarification and chat stabilization work.
