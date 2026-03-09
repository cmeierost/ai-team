---
name: tanstack-query-zustand-boundary
description: 'Use when deciding between TanStack Query and Zustand in `packages/web`, moving fetch logic out of components, or splitting server state from runtime client state while keeping views dumb for Storybook.'
---

# TanStack Query Zustand Boundary

Use this skill when frontend work needs a clean boundary between server state, live runtime client state, and prop-driven views.

This includes:

- deciding whether state belongs in TanStack Query, Zustand, `useReducer`, or local component state
- moving fetch logic out of React view components
- shaping query hooks and controller hooks together
- preventing Zustand from turning into an accidental server cache
- preparing feature views so Storybook can exercise them with plain props

## Read These Sources First

1. `ARCHITECTURE.md`
2. `COPILOT-CONTEXT.md`
3. `.github/copilot-instructions.md`
4. `packages/web/README.md`
5. `docs/web-ui-development.md`
6. `.ai-team/instructions/frontend-state-architecture.instructions.md`
7. `.ai-team/skills/frontend-web-delivery/SKILL.md`
8. `.ai-team/skills/zustand-presenter-split/SKILL.md`

## Workflow

### 1. Classify the state

Before moving anything, classify it as one of:

- server state persisted behind an API
- live runtime state driven by browser-side events or workflow orchestration
- local ephemeral UI state that belongs near one view

### 2. Put server state in Query

Use TanStack Query for:

- HTTP fetching
- caching
- invalidation
- mutation follow-up refreshes
- loading/error/success state for backend-owned data

Examples in this repo include sessions, artifacts, tasks, dashboard stats, team graph, developer profile, and other REST-backed resources.

### 3. Put live runtime state in Zustand only when shared

Use Zustand for shared client state that is synchronous, event-driven, or runtime-oriented.

Good fits include:

- active chat stream state
- pending workflow question state
- current handoff state
- shared panel or feature runtime state that multiple components need immediately

Avoid putting ordinary server cache data into Zustand.

### 4. Keep views dumb

Prefer a split such as:

- query hook for server data
- controller hook for orchestration
- Zustand store for shared runtime state when needed
- presentational view for rendering

The presentational view should ideally accept:

- data props
- booleans and enum-like state props
- callbacks
- fixture-friendly objects for Storybook

### 5. Validate the split

After refactoring:

- confirm API fetching is no longer trapped inside view components
- confirm Zustand stores are narrow and intentional
- confirm Storybook stories can render the view without booting the whole feature
- run `pnpm --filter @ai-team/web build`
- ensure new state logic has direct unit tests

## Working Rules

- do not use Query and Zustand interchangeably just because both can hold async results
- do not let one mega-store swallow unrelated feature concerns
- prefer small query hooks and explicit runtime actions
- prefer selectors over broad store reads in React components
- optimize for code that can be tested without mounting the full app shell

## Successful Outcome

- Query owns server state cleanly
- Zustand is limited to the runtime client state it actually improves
- views stay prop-driven and Storybook-friendly
- data flow becomes easier to reason about and easier to test
