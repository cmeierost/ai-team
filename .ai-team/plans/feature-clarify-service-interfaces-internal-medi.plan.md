---
id: clarify-service-interfaces-internal-medi
type: feature
title: Clarify service interfaces, internal mediator, and UI notifier split
createdBy: human
createdByType: human
parentPlanId: transition-service-boundaries-away-from-
status: not_started
priority: urgent
requiresApproval: false
estimatedHours: 12
tags:
  - architecture
  - service
  - streaming
  - ui-notifier
metadata:
  immediateAfterDocs: true
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z
deadline: null
assignedTo: leah-brooks

------

## Problem

The current mediator terminology mixes:

- [ ] business-facing service calls
- [ ] internal orchestration dispatch
- [ ] UI-facing streaming delivery
- [ ] surface-specific WebSocket / CLI handling

## Desired outcome

Introduce a vocabulary and code shape where:

- [ ] service interfaces are the public boundary used by CLI and web callers
- [ ] an internal service-layer mediator stays inside `@ai-team/service`
- [ ] a UI notifier owns outward event delivery
- [ ] API server and CLI code become thin surface handlers rather than peers of the service runtime

## Notes

This task should reduce confusion without forcing the full DI and infrastructure-decoupling work in the same change.
