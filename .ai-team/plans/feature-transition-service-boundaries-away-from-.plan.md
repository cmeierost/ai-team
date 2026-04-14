---
id: transition-service-boundaries-away-from-
type: feature
title: Transition service boundaries away from transport-coupled mediator naming
createdBy: human
createdByType: human
status: in_progress
priority: urgent
requiresApproval: false
subPlanIds:
  - document-the-architecture-transition-and
  - clarify-service-interfaces-internal-medi
  - roll-out-stricter-dependency-injection-a
  - remove-direct-service-to-infrastructure-
  - plan-explicit-user-triggered-tool-mcp-an
estimatedHours: 40
tags:
  - architecture
  - backlog
  - local-only
  - transition
metadata:
  scope: service-boundary-transition
  pushBlocker: true
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z
deadline: null
assignedTo: leah-brooks

------

## Goal

Move AI Team toward transport-independent service interfaces without breaking current CLI, web, or API behavior.

## Current state

- [ ] Several paths still use mediator-oriented naming for both business calls and UI-facing streaming.
- `@ai-team/service` still depends directly on `@ai-team/infrastructure` in some areas.
- [ ] The web chat path is part of the active cleanup and still gates a clean push.

## Target state

- [ ] UI surfaces call shared service interfaces.
- [ ] The service-layer mediator stays internal to `@ai-team/service`.
- [ ] UI-facing streaming is delivered through a `UI notifier` concept.
- [ ] DI becomes strict across the logic ↔ infrastructure boundary.
- `@ai-team/service` depends on boundary interfaces in `@ai-team/core` rather than concrete infrastructure implementations.

## Priority order

- [ ] Keep docs and local backlog aligned.
- [ ] Clarify the mediator / notifier / surface-handler split.
- [ ] Restore and validate web chat behavior.
- [ ] Roll out stricter DI.
- [ ] Remove direct service → infrastructure dependencies.
- [ ] Plan the future explicit user-triggered tool / MCP / CLI execution surface.
