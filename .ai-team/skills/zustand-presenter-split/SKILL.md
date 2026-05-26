---
name: zustand-presenter-split
description: 'Use when introducing Zustand, moving logic out of React components, splitting containers from dumb presentational views, or preparing Storybook-friendly components in `packages/web`.'
---

# Zustand Presenter Split

Use this skill when the work is about shaping React features so stateful orchestration lives outside the view and presentational components stay easy to exercise in Storybook.

This includes:

- introducing or refining Zustand stores for shared client UI state
- moving routing, effects, and orchestration out of React view components
- splitting features into controller/container logic and presentational views
- making components render from props so Storybook stories do not need business logic
- keeping server-state concerns out of Zustand when query-style data fetching is a better fit

## Read These Sources First

1. `ARCHITECTURE.md`
2. `COPILOT-CONTEXT.md`
3. `.github/copilot-instructions.md`
4. `packages/web/README.md`
5. `packages/web/package.json`
6. `packages/web/src/**/*`
7. `docs/web-ui-development.md`
8. `.ai-team/skills/frontend-web-delivery/SKILL.md`
9. `.ai-team/skills/frontend-quality-storybook/SKILL.md`

## Workflow

### 1. Classify the state before moving it

Separate the problem into:

- server state fetched from the API
- shared client UI state that multiple components genuinely need
- purely local interaction state that should stay close to one feature

Do not reach for Zustand when `useState`, `useReducer`, or a query layer is the better fit.

### 2. Put logic in controllers, not views

Keep orchestration in:

- container components
- controller hooks
- Zustand stores
- feature helpers

Keep presentational components focused on:

- props in
- callbacks out
- rendering and accessibility
- small display-only derived values

### 3. Design Zustand stores narrowly

When Zustand is the right fit:

- keep stores small and feature-scoped
- expose selectors or narrow subscriptions when practical
- keep actions explicit and easy to test
- avoid turning one store into a dump for unrelated frontend concerns

### 4. Optimize for Storybook entry points

Prefer Storybook stories that render the presentational component directly.

A strong presentational component should usually work with:

- plain props
- no router dependency
- no fetch dependency
- no direct store dependency
- no hidden side effects during render

If a story needs providers, keep them close to the container story rather than making every view story boot the app.

### 5. Validate the split

After changes:

- confirm the presentational view can be exercised with fixture props
- confirm the container or controller owns the logic that used to live in the component
- confirm Zustand is holding only the shared client state it actually needs to own
- run `pnpm --filter @ai-team/web build`
- when Storybook coverage exists, verify the component stories still represent the real states

## Working Rules

- do not put fetch calls, router reads, or store writes directly inside presentational components unless there is a very strong reason
- do not use Zustand as a substitute for server caching
- prefer controller/view or container/view boundaries over fat components
- keep Storybook stories cheap to render and easy to understand
- coordinate with Clara Bishop when browser-driven Storybook checks or interaction verification are part of the job

## Successful Outcome

- React views in `packages/web` stay dumb enough to test in Storybook with simple props
- Zustand stores are small, intentional, and limited to shared client state
- state, effects, and rendering responsibilities are easier to reason about
- frontend architecture supports both implementation speed and component-level testing
