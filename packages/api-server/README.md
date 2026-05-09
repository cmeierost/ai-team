# @ai-team/api-server

HTTP REST API server for AI Team web UI.

## Features

- REST API endpoints for agents, team graph, and chat
- WebSocket support for real-time chat streaming
- **Swagger UI** for interactive API documentation
- Static file serving for production deployment
- CORS support for development
- Environment-based configuration

## Environment Variables

- `PORT` - Server port (default: 3002)
- `AI_TEAM_WORKSPACE` - Path to workspace containing `.ai-team` directory (default: current working directory)
- `NODE_ENV` - Environment mode: `development` or `production`

## Development

```bash
# Start in development mode with auto-reload
pnpm dev

# Or with custom workspace
AI_TEAM_WORKSPACE=/path/to/workspace pnpm dev
```

## Production

```bash
# Build the server
pnpm build

# Build the web UI
pnpm --filter @ai-team/web build

# Start production server
NODE_ENV=production pnpm start

# Server will be available at:
# - Web UI: http://localhost:3002
# - API: http://localhost:3002/api
# - API Docs: http://localhost:3002/api-docs
```

## API Endpoints

### API Documentation

Access the interactive Swagger UI documentation at:
- **Swagger UI**: `http://localhost:3002/api-docs`
- **OpenAPI JSON**: `http://localhost:3002/api-docs.json`

The Swagger UI provides a comprehensive, interactive interface to explore and test all API endpoints with request/response examples.

### REST API

- `GET /api/health` - Health check
- `GET /api/agents` - List all agents
- `GET /api/agents/:id` - Get specific agent
- `GET /api/team/graph` - Get team hierarchy graph
- `GET /api/chat/:agentId` - Load chat history
- `POST /api/chat/:agentId` - Send message (fallback, use WebSocket for streaming)

### WebSocket

- `ws://localhost:3002/ws/chat/:agentId` - Real-time chat streaming

#### WebSocket Protocol

**Client → Server:**
```json
{
  "type": "message",
  "content": "Hello!",
  "options": {}
}
```

**Server → Client:**
```json
{
  "type": "token|status|tool|question|error|done",
  "data": { ... }
}
```

## Architecture

```
Web UI (Browser) → HTTP/WebSocket → API Server → api-contracts → service → core
```

The API server acts as a transport layer, exposing the service layer to browser clients via HTTP REST and WebSocket protocols.
