# @ai-team/api-server

HTTP and WebSocket transport adapter for the AI Team web UI. This package exposes `@ai-team/service` over REST and streaming sockets using `@ai-team/api-contracts` for shared request/response types.

## Responsibilities

- REST endpoints for workspace, agents, and metadata
- WebSocket chat streaming transport
- Swagger UI / OpenAPI JSON surfacing
- CORS and runtime configuration
- Transport-safe pass-through of shared runtime events, including workflow
  lifecycle events (`workflow_*`) defined in `@ai-team/api-contracts`

## Key technologies

- `@ai-team/api-contracts` for shared service contracts
- `@ts-http/express` + Express for REST transport
- `ws` for WebSocket streaming
- `swagger-ui-express` for API docs
- `cors` for development runtime configuration

## Environment variables

- `PORT` — server port (default: 3002)
- `AI_TEAM_WORKSPACE` — path to the workspace containing `.ai-team/` (default: current working directory)
- `NODE_ENV` — `development` or `production`

## Development

```bash
pnpm --filter @ai-team/api-server dev
```

## Production

```bash
pnpm --filter @ai-team/api-server build
pnpm --filter @ai-team/api-server start
```

If you serve the web UI from the API server, build the web package separately:

```bash
pnpm --filter @ai-team/web build
```

## API documentation

Swagger UI and OpenAPI JSON are available at:

- `http://localhost:3002/api-docs`
- `http://localhost:3002/api-docs.json`

## Architecture

```
Web UI (Browser) → HTTP/WebSocket → API Server → api-contracts → service → core
```
