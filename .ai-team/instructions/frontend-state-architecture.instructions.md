---
applyTo: "packages/web/src/**/*.ts,packages/web/src/**/*.tsx"
---

# web state architecture

Use this instruction when working on frontend state or data flow in `packages/web/src`.

## Purpose

Keep the web app maintainable by separating server state, live runtime state, and presentational rendering so Storybook remains useful and state logic stays testable.

## Rules

- Use **TanStack Query** for server state:
  - HTTP-fetched data
  - cached API resources
  - mutations and invalidation
  - loading/error/success state for persisted backend data
- Use **Zustand** for shared client runtime state when it is truly live, local to the browser, or driven by event streams:
  - WebSocket chat runtime
  - token streaming
  - tool activity timelines
  - pending workflow questions
  - handoff transitions
  - other shared synchronous client state that is not server cache
- Do **not** use Zustand as the default home for normal API fetching or cache data.
- Keep presentational views dumb when practical:
  - props in
  - callbacks out
  - no direct fetch calls
  - no direct router orchestration
  - no direct WebSocket protocol handling
- Prefer controller/view or hook/view boundaries for important features.
- When state logic grows beyond trivial `useState`, extract it into:
  - query hooks
  - controller hooks
  - pure reducers or event appliers
  - narrow Zustand stores
  - selectors/helpers

## Testing requirement

- All meaningful state logic must be unit tested.
- This especially includes:
  - Zustand actions
  - selectors
  - reducers
  - event-application helpers
  - controller logic that maps runtime events into view state
- Do not leave important transition logic trapped inside TSX views without direct unit coverage.
- Presentational components should be easy to cover in Storybook with fixture props.

## Storybook requirement

- Prefer stories for presentational views over stories that boot the whole app.
- If a container or provider story is needed, keep it as a focused wrapper and keep the primary view story props-driven.
- Model important visual states explicitly:
  - loading
  - error
  - empty
  - success
  - streaming/in-progress
  - question or handoff states when relevant

## Good triggers

This rule especially applies to:

- `ChatPanel.tsx` and related chat runtime extractions
- dashboard and context-panel data fetching
- feature refactors that move logic out of components
- Zustand store creation
- Query hook creation
- Storybook-friendly UI splits

## Successful outcome

- server state lives in TanStack Query
- live runtime client state lives in focused Zustand stores or small controller state machines
- views stay dumb enough to preview in Storybook
- state logic is testable without rendering the entire app
