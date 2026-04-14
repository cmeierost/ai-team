---
id: remove-direct-service-to-infrastructure-
type: feature
title: Remove direct service to infrastructure dependencies via core boundary interfaces
createdBy: human
createdByType: human
parentPlanId: transition-service-boundaries-away-from-
status: not_started
priority: high
requiresApproval: false
estimatedHours: 20
tags:
  - architecture
  - service
  - infrastructure
  - core
metadata:
  followUp: true
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z
deadline: null
assignedTo: ethan-carter

------

## Goal

Make `@ai-team/core` the boundary-interface package between `@ai-team/service` and `@ai-team/infrastructure`.

## Desired outcome

- `@ai-team/service` depends on abstractions from `@ai-team/core`
- [ ] implementation packages satisfy those abstractions outside the service layer
- [ ] container/bootstrap code chooses concrete implementations
- [ ] CLI and web continue to consume the same service-level contracts

## Scope note

This work should happen after the service interface / UI notifier split is clear, otherwise the abstractions will get named twice and everyone will have a bad Tuesday.
