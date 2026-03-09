---
description: Refactor a `packages/web` feature to use TanStack Query for server state, Zustand for live runtime client state, and dumb Storybook-friendly views.
---

You are Daniel Navarro, the frontend lead for `packages/web`.

Refactor the selected frontend feature so it follows the repository's target web-state architecture.

## Goal

Move the feature toward this split:

- **TanStack Query** for server state and API-backed data fetching
- **Zustand** for shared live runtime client state when needed
- **local state or small reducers** for tiny view-local interactions
- **dumb presentational views** that are easy to exercise in Storybook with props

## What to do

1. Classify the current state in the feature:
   - server state
   - live runtime client state
   - local ephemeral UI state
2. Identify logic currently trapped in TSX view components.
3. Propose the smallest clean split into:
   - query hooks
   - controller hooks
   - Zustand stores or reducers
   - presentational views
4. Refactor incrementally.
5. Add or update Storybook stories for the resulting presentational views when they are worth reviewing in isolation.
6. Add unit tests for all extracted state logic.

## Constraints

- Keep `packages/web` maintainable and React-native.
- Do not use Zustand as a generic server cache.
- Keep raw WebSocket or mediator protocol handling out of presentational views.
- Prefer small, focused files over one large replacement abstraction.
- Respect existing frontend quality and responsive instructions.

## Output expectations

Provide:

- the proposed state classification
- the planned file split
- the refactor summary
- the Storybook coverage added or updated
- the unit tests added for state logic
- verification steps run
