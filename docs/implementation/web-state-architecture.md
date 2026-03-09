# Web State Architecture

This document defines the target frontend state architecture for `packages/web`.

It exists to keep the web package maintainable as the UI grows, the chat surface becomes more runtime-driven, and Storybook becomes a more important quality surface.

## Goal

Use the right tool for each kind of state and keep presentational views easy to review, test, and reuse.

The target split is:

- **TanStack Query** for server state
- **Zustand** for shared live runtime client state
- **local state or small reducers** for tiny view-local interactions
- **dumb presentational views** for Storybook and component-level review

## Why this split exists

The web package now mixes several very different state problems:

1. API-backed persisted data
2. live WebSocket-driven chat runtime state
3. tiny local interaction state
4. rendering concerns that should stay easy to preview in Storybook

Treating all of these as one undifferentiated "frontend state" problem makes components grow heavy and hard to test.

## State categories

### Server state → TanStack Query

Use TanStack Query for data that is owned by the backend or API and benefits from caching, invalidation, and standard async lifecycle handling.

Examples in this repo include:

- team graph
- developer profile
- sessions
- session snapshots
- artifacts
- tasks
- dashboard stats
- skills and tool permission catalog data

Use Query for:

- fetching
- caching
- deduping
- invalidation
- refetching after mutations
- loading/error/success state for persisted backend data

Do **not** move this data into Zustand by default.

### Live runtime client state → Zustand

Use Zustand for synchronous browser-side runtime state that multiple parts of a feature need immediately and that does not behave like ordinary server cache.

The clearest example in this repo is chat runtime behavior driven by mediator events.

Good fits include:

- active stream lifecycle
- in-flight assistant message assembly
- pending workflow question state
- tool activity timeline
- handoff transition state
- other shared client runtime state that is driven by immediate events instead of backend cache lifecycles

Zustand is especially useful here because the runtime can be modeled with:

- narrow selectors
- explicit actions
- subscriptions when needed
- event-driven state transitions

### Local ephemeral UI state → `useState` / `useReducer`

Keep small view-local state close to the component or controller when nothing else needs it.

Examples:

- input drafts
- hover state
- textarea sizing
- local edit mode
- temporary expansion toggles

Do not centralize tiny local state just because a store is available.

## Chat runtime guidance

Chat in this repo is not a simple request/response feature.

The web UI consumes a mediated event stream over WebSocket with events such as:

- `status`
- `token`
- `tool`
- `question`
- `handoff`
- `done`
- `error`

This means chat should be treated as a runtime event pipeline.

### Recommended chat split

- **Query** for persisted session snapshots and related API-backed records
- **Zustand** for live runtime state during an active stream
- **pure helpers** for event application
- **controller hooks** for transport lifecycle and orchestration
- **presentational chat views** for rendering

### Keep out of the presentational chat view

Do not let presentational chat views own:

- raw WebSocket lifecycle
- mediator event parsing
- token accumulation
- question answer wiring
- handoff transition logic
- cancel/abort protocol behavior

Those belong in controller hooks, stores, and pure state helpers.

## Component boundary guidance

### Controller/view split

Prefer a split such as:

- query hook for backend data
- controller hook for orchestration
- Zustand store for shared runtime state when needed
- view component for rendering

A good view component should usually accept:

- plain props
- enum-like state values
- callbacks
- fixture data that Storybook can provide easily

### Storybook target

For important reusable views, prefer stories that render the view directly.

Strong Storybook-friendly views usually avoid needing:

- router reads
- fetch calls
- raw store setup
- websocket connections
- browser-only side effects during render

If a provider or container story is needed, keep it focused and do not make every story boot the app shell.

## Testing requirement

All meaningful state logic should be directly unit tested.

This especially includes:

- Zustand actions
- selectors
- reducers
- event-application helpers
- controller logic that maps runtime events into view state
- Query/Zustand boundary logic when a feature uses both

### Storybook is not enough

Storybook helps with:

- visual states
- interaction review
- accessibility review
- responsive review

It does **not** replace direct unit tests for state transitions.

### Good test seams

Prefer testing:

- pure event appliers
- selectors
- store actions
- extracted controllers or hooks

Avoid relying only on large rendered component tests when a smaller state seam exists.

## Target direction for `packages/web`

Over time, the web package should move toward feature boundaries that make state easier to classify and test.

A good shape could include:

```text
packages/web/src/
  features/
    chat/
      controllers/
      hooks/
      stores/
      views/
      test/
    dashboard/
      hooks/
      views/
      test/
```

This is a directional guide, not a mandatory folder law.

## Expected outcome

When this architecture is followed well:

- Query owns server state cleanly
- Zustand is limited to shared runtime client state that actually benefits from it
- views stay dumb enough for Storybook
- state transitions become unit testable
- `packages/web` becomes easier to evolve instead of slowly turning into one giant smart component museum
