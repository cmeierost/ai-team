# @ai-team/web

Web dashboard for AI Team management and visualization.

## Features

- **Team graph** visualization with `@xyflow/react`
- **Agent list** and detail views
- **Chat interface** with streaming responses
- **Responsive layout** for desktop and tablet

## Development

```bash
pnpm --filter @ai-team/web dev
```

Open `http://localhost:3000`.

## Build & preview

```bash
pnpm --filter @ai-team/web build
pnpm --filter @ai-team/web preview
```

## Storybook

```bash
pnpm --filter @ai-team/web storybook
```

Open `http://localhost:6006`. To generate a static build:

```bash
pnpm --filter @ai-team/web storybook:build
```

## Architecture notes

- **React 19** + **Vite**
- **TanStack Query** for API-backed server state
- **Zustand** for live runtime client state (chat streaming, pending events)
- Prefer **presentational components** that are Storybook-friendly
- Chat and workflow lifecycle events are service-owned contracts; web components
  render them but do not choose workflow transitions.

See `docs/implementation/web-state-architecture.md` for full guidance.

## Testing direction

Unit test state logic directly (`pnpm --filter @ai-team/web test`). Storybook remains a visual review tool, not a replacement for state tests.
