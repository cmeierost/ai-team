---
name: frontend-web-delivery
description: 'Work on the React web package when the task touches `packages/web`, component boundaries, state and logic separation, or frontend team ownership while keeping styling, testing, and architecture responsibilities cleanly separated.'
---

# Frontend Web Delivery

Use this skill when the work is specifically about the React web package as a frontend engineering surface.

This includes:

- React component structure in `packages/web`
- separating state, effects, and presentation cleanly
- refactoring oversized contexts or components into clearer boundaries
- shaping the web package as a maintainable frontend surface
- coordinating implementation work with styling and frontend quality ownership

## Read These Sources First

1. `ARCHITECTURE.md`
2. `COPILOT-CONTEXT.md`
3. `.github/copilot-instructions.md`
4. `packages/web/README.md`
5. `packages/web/package.json`
6. `packages/web/src/**/*`
7. `docs/web-ui-development.md`

## Workflow

### 1. Classify the frontend change

Identify whether the task is primarily about:

- state and data flow
- component boundaries
- view composition
- hooks and side effects
- frontend architecture or package ownership

### 2. Trace logic vs presentation

Before editing, decide what should live in:

- components for presentation
- hooks or helpers for reusable logic
- context only when truly shared state needs it

Avoid letting one context or one component become the default home for unrelated concerns.

### 3. Keep role boundaries clean

- frontend engineering owns architecture, state, and implementation flow
- Samuel owns styling and visual appearance
- Clara owns quality infrastructure and browser-driven testing

Do not collapse all three into one fuzzy frontend blob.

### 4. Validate the web surface

- confirm the affected components still compose cleanly
- check that data flow and UI flow are easier to understand after the change
- run `pnpm --filter @ai-team/web build`

## Working Rules

- prefer clean React boundaries over clever entanglement
- keep state and logic separate from presentation when practical
- do not treat styling ownership as frontend architecture ownership
- keep the web package maintainable as the surface grows

## Successful Outcome

- `packages/web` stays easier to reason about
- state, logic, and presentation are more clearly separated
- frontend engineering decisions complement styling and testing instead of colliding with them