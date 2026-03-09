# Web UI Development Workflow

## Quick Start (Development with Hot Reload)

### Start Development Environment

**Option 1: Start Both Servers (Recommended for Full Development)**
```powershell
# From project root - starts both API server and web dev server in parallel
pnpm run dev:web
```
This starts both the API server and web dev server together. Web UI runs on **http://localhost:5173** (or next available port like 3001).

**Option 2: Web Dev Server Only (API Already Running)**
```powershell
# If API server is already running elsewhere
pnpm --filter @ai-team/web dev
```

**Option 3: Manual Start (Two Terminals)**

Terminal 1 - API Server:
```powershell
# Build API server first if not already built
pnpm --filter @ai-team/api-server build

# Start server
$env:AI_TEAM_WORKSPACE='C:\Projects\ai-team'
node packages/api-server/dist/index.js
```

Terminal 2 - Web Dev Server:
```powershell
pnpm --filter @ai-team/web dev
```

The web dev server uses Vite with hot module replacement enabled. Any changes to files in `packages/web/src/` will automatically reload in the browser **without manual rebuilds**.

## Development Commands

### Hot Reload Development (Use This!)
```powershell
pnpm --filter @ai-team/web dev
```
- Starts Vite dev server with HMR (Hot Module Replacement)
- Changes to TypeScript/React files reload instantly
- No need to rebuild after each change
- Dev server runs on http://localhost:5173

### Production Build (Only for Testing/Deployment)
```powershell
pnpm --filter @ai-team/web build
```
- Compiles TypeScript and bundles with Vite
- Outputs to `packages/web/dist/`
- Use only when testing production build or deploying

## State Architecture Direction

The target frontend state split for `packages/web` is:

- **TanStack Query** for server state and ordinary API-backed data fetching
- **Zustand** for shared live runtime client state such as mediated chat streaming
- **local state or small reducers** for tiny view-local interactions
- **dumb presentational views** for Storybook-friendly rendering

See `docs/implementation/web-state-architecture.md` for the detailed guidance.

### What belongs where

- sessions, tasks, artifacts, team graph, dashboard stats, and other persisted API resources → TanStack Query
- in-flight token streaming, pending workflow questions, tool activity, handoff state, and other shared runtime chat behavior → Zustand
- small local interaction details such as input drafts or hover state → local component or controller state

### Storybook and state boundaries

When refactoring important UI:

- prefer controller/view or hook/view boundaries
- keep views prop-driven when practical
- keep raw fetch logic, router orchestration, and WebSocket protocol handling out of presentational views

### Testing requirement

All meaningful extracted state logic should be unit tested.

That includes:

- store actions
- selectors
- reducers
- event-application helpers
- controller logic

Storybook helps validate rendering and interaction states, but it is not a substitute for direct unit coverage of state transitions.

### Type Checking Without Building
```powershell
cd packages/web
pnpm exec tsc --noEmit
```
- Validates TypeScript types without bundling
- Faster than full build for checking errors

## File Structure

```
packages/web/
├── src/
│   ├── components/      # React components
│   │   ├── TeamGraph.tsx     # Organization chart
│   │   ├── ChatPanel.tsx     # Agent chat interface
│   │   └── ...               # Other UI components
│   ├── context/         # React context providers
│   │   └── TeamContext.tsx   # Team data & API client
│   ├── utils/           # Utility functions
│   ├── types.ts         # TypeScript type definitions (browser-safe)
│   ├── App.tsx          # Root component
│   └── main.tsx         # Entry point
├── dist/                # Build output (gitignored)
├── index.html           # HTML template
├── vite.config.ts       # Vite configuration
└── package.json
```

## Key Development Notes

### API Integration
- Web UI connects to API server at **http://localhost:3002** (when running locally)
- API client configured in `src/context/TeamContext.tsx`
- Uses `@ai-team/api-client-http` for HTTP + WebSocket communication

### Type Safety
- **IMPORTANT**: `packages/web/src/types.ts` contains browser-safe types
- Never import `@ai-team/core` directly in web code (it has Node.js dependencies)
- Copy needed types from core to web/types.ts as browser-safe versions

### Team Graph Resolution
- Web UI calls `client.getTeamGraph('hierarchy')` (not `listEmployees()`)
- API server resolves role references (e.g., `reportsTo: "cto"` → actual agent ID)
- Ensures org chart displays correct hierarchy matching `ait org` output

### Hot Reload Behavior
- **React components**: Instant reload preserving state
- **Context/state changes**: Page refresh may occur
- **Type changes**: May require browser refresh
- **CSS changes**: Instant reload

## Common Workflows

### Making UI Changes
1. Ensure API server is running (see API Server section below)
2. Start web dev server: `pnpm --filter @ai-team/web dev`
3. Open http://localhost:5173 in browser
4. Edit files in `packages/web/src/`
5. Changes appear automatically in browser

### Testing Production Build Locally
1. Build web: `pnpm --filter @ai-team/web build`
2. Serve dist folder: `pnpm --filter @ai-team/web preview`
3. Open http://localhost:4173 (Vite preview server)

### Fixing TypeScript Errors
```powershell
# Check types only (fast)
cd packages/web
pnpm exec tsc --noEmit

# Full build (slower)
pnpm --filter @ai-team/web build
```

## API Server Setup

The web UI requires the API server to be running. The server provides REST endpoints and WebSocket support for real-time chat.

### Start API Server
```powershell
# Ensure packages are built first
pnpm --filter @ai-team/api-server build

# Start server
$env:AI_TEAM_WORKSPACE='C:\Projects\ai-team'
node packages/api-server/dist/index.js
```

Server runs on **http://localhost:3002**

### API Testing with Swagger UI

The API server includes interactive Swagger UI documentation:
- **Swagger UI**: http://localhost:3002/api-docs
- **OpenAPI Spec**: http://localhost:3002/api-docs.json

Use Swagger UI to:
- Explore all available API endpoints and schemas
- Test endpoints interactively without writing code
- View request/response examples
- Debug API integration issues

**Example: Testing the Agents Endpoint**
1. Open http://localhost:3002/api-docs
2. Expand "Agents" → "GET /api/agents"
3. Click "Try it out" → "Execute"
4. View the response with actual agent data

### API Server Endpoints Used by Web UI
- `GET /api/team/graph?mode=hierarchy` - Team hierarchy with resolved roles
- `GET /api/agents` - List all agents (legacy, prefer team/graph)
- `GET /api/agents/:id` - Get specific agent
- `POST /api/chat/:agentId` - Send chat message
- `WS /ws` - WebSocket for real-time chat

## Troubleshooting

### Port Already in Use
```powershell
# Kill process on port 5173 (web dev server)
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | 
  Select-Object -ExpandProperty OwningProcess | 
  ForEach-Object { Stop-Process -Id $_ -Force }

# Kill process on port 3002 (API server)
Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue | 
  Select-Object -ExpandProperty OwningProcess | 
  ForEach-Object { Stop-Process -Id $_ -Force }
```

### API Connection Errors
1. Verify API server is running on port 3002
2. Check `AI_TEAM_WORKSPACE` environment variable is set
3. Ensure `.ai-team/` directory exists in workspace root
4. Check browser console for CORS or network errors

### Hot Reload Not Working
1. Check terminal for Vite errors
2. Try hard refresh (Ctrl+Shift+R in browser)
3. Restart dev server: `pnpm --filter @ai-team/web dev`
4. Clear browser cache if needed

### Build Errors
```powershell
# Clean and rebuild
pnpm --filter @ai-team/web clean
pnpm --filter @ai-team/web build
```

## Best Practices

1. **Always use dev server during development** - Don't build repeatedly
2. **Keep browser console open** - Catch errors early
3. **Use TypeScript strict mode** - Already enabled in tsconfig.json
4. **Test API integration** - Ensure API server is running
5. **Check CLI output** - Use `ait org`, `ait graph` to verify data matches UI
6. **Browser DevTools** - React DevTools extension helpful for debugging

## Related Documentation

- [API Server README](../packages/api-server/README.md)
- [Core Package README](../packages/core/README.md)
- [Architecture Overview](./architecture/overview.md)
- [API Contracts](./api/contracts.md)
