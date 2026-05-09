# @ai-team/web

Web dashboard for AI Team management and visualization.

## Features

- **Team Graph**: Interactive visualization of agent hierarchy using react-flow
- **Agent List**: Card-based view of all team members with skills and context
- **Chat Interface**: Real-time chat with individual agents
- **Responsive Design**: Works on desktop and mobile

## Usage

### Development

```bash
pnpm --filter @ai-team/web dev
```

Open `http://localhost:3000`

### Build

```bash
pnpm --filter @ai-team/web build
```

### Preview Production Build

```bash
pnpm --filter @ai-team/web preview
```

### Storybook

```bash
pnpm --filter @ai-team/web storybook
```

Open `http://localhost:6006`

To generate a static Storybook build:

```bash
pnpm --filter @ai-team/web storybook:build
```

## Architecture

The web dashboard uses:

- **React 19** for UI components
- **Vite** for fast development and building
- **@xyflow/react** (react-flow) for interactive graph visualization
- **@ai-team/core** for all business logic
- **@ts-http** for HTTP and WebSocket access to the service layer

The target state architecture is:

- **TanStack Query** for server state and normal API-backed fetching/caching
- **Zustand** for shared live runtime client state, especially chat streaming/runtime behavior
- **local state / reducers** for tiny view-local interactions
- **dumb presentational views** for Storybook-friendly rendering

See `docs/implementation/web-state-architecture.md` for the full guidance.

## Components

- `App.tsx` - Main application shell with navigation
- `TeamGraph.tsx` - Interactive team hierarchy visualization
- `AgentList.tsx` - Grid view of all agents
- `ChatPanel.tsx` - Chat interface for agent interaction
- `TeamContext.tsx` - Global state management

As the web package evolves, prefer moving smart state and orchestration into feature hooks, stores, and controllers so presentational views can be exercised in Storybook with props.

## Configuration

The dashboard looks for the `.ai-team/` directory in the current working directory. You can override this by passing `workspaceRoot` to the `TeamProvider`:

```tsx
<TeamProvider workspaceRoot="/path/to/workspace">
  <App />
</TeamProvider>
```

## Storybook coverage

Storybook lives alongside the web package and is intended as a frontend quality asset, not just a demo gallery.

- config: `packages/web/.storybook/*`
- starter stories: `packages/web/src/components/*.stories.tsx`
- shared story fixtures: `packages/web/src/storybook/storyData.ts`

The initial setup focuses on isolated, low-dependency components so the Storybook stays fast and reliable while broader dashboard and graph states are added incrementally.

## Testing direction

Meaningful frontend state logic should be directly unit tested.

Run the web package tests with `pnpm --filter @ai-team/web test`.

This especially includes:

- Query/Zustand boundary logic
- Zustand actions and selectors
- reducers and event-application helpers
- chat runtime logic for streaming, handoffs, and pending questions

Storybook remains important for visual and interaction review, but it does not replace direct unit tests for state transitions.
