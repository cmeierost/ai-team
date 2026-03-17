---
name: service-orchestration-runtime
description: 'Use when working on command dispatch, mediator flow, runtime events, workflow state, dependency wiring, or orchestration behavior in packages/service.'
triggers:
  - "\\bmediator\\b"
  - "\\bcommand.?dispatch\\b"
  - "\\bworkflow.?state\\b"
  - "\\bdependency.?wir\\b"
  - "packages/service.*orchestrat"
---

# Service orchestration runtime

Use this skill when the work touches how the service layer dispatches commands, streams runtime events, manages workflows, or wires together backend runtime components.

Typical triggers:

- command dispatch is incorrect or brittle
- runtime events are missing, duplicated, or out of order
- workflow continuation or question flow breaks
- service bootstrap or dependency wiring needs changes
- orchestration paths are too coupled or hard to follow

## Focus areas

- `packages/service/src/index.ts`
- `packages/service/src/contracts.ts`
- `packages/service/src/commands/**/*`
- `packages/service/src/orchestrator/**/*`
- `packages/service/src/container/**/*`
- `packages/service/src/workflow-state.ts`

## Workflow

1. Identify the orchestration boundary involved: command entry, workflow state, runtime event flow, or dependency wiring.
2. Keep `packages/service` as the orchestration layer over lower shared logic.
3. Prefer small, traceable control-flow changes over large rewrites.
4. Validate the concrete command or workflow path that changed.

## Guardrails

- do not move orchestration concerns down into unrelated core modules
- do not mix transport concerns with domain logic without a clear reason
- keep event emission and workflow state transitions explicit
- preserve user-visible runtime behavior unless the change intentionally improves it

## Successful outcome

- service orchestration becomes easier to reason about
- runtime event flow stays consistent
- command and workflow paths remain testable and well-bounded
