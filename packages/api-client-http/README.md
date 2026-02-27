# @ai-team/api-client-http

Browser-safe HTTP client for AI Team API server.

## Features

- ✅ Works in browsers (no Node.js dependencies)
- ✅ Typed API calls matching service contracts
- ✅ WebSocket support for real-time chat streaming
- ✅ Automatic reconnection and error handling

## Installation

```bash
pnpm add @ai-team/api-client-http
```

## Usage

```typescript
import { createHttpAiTeamClient } from '@ai-team/api-client-http';

// Create client instance
const client = createHttpAiTeamClient({
  baseUrl: 'http://localhost:3002',
  // wsUrl is optional, defaults to baseUrl with ws:// protocol
});

// List agents
const agents = await client.listEmployees({});

// Get team graph
const graph = await client.getTeamGraph('hierarchy');

// Chat with agent (simple)
await client.chat('agent-id', { message: 'Hello!' });

// Stream chat (real-time tokens)
const stream = client.stream({
  command: 'chat',
  payload: {
    employeeId: 'agent-id',
    options: { message: 'Hello!' },
  },
});

for await (const event of stream) {
  if (event.kind === 'token') {
    console.log(event.text);
  }
}
```

## Event Types

Chat streaming emits various event types:

- `started` - Command started
- `status` - Status update (e.g., "thinking")
- `token` - Text token from LLM response
- `tool` - Tool usage event
- `question` - Interactive question from agent
- `result` - Final result
- `done` - Stream completed
- `error` - Error occurred

## Configuration

```typescript
interface HttpClientConfig {
  baseUrl: string;    // HTTP API base URL (e.g., http://localhost:3002)
  wsUrl?: string;     // WebSocket URL (defaults to baseUrl with ws://)
}
```

## Supported Operations

### Read Operations (Fully Supported)
- ✅ `listEmployees()` - List all agents
- ✅ `resolveEmployees()` - Get specific agent
- ✅ `getTeamGraph()` - Get team hierarchy
- ✅ `chat()` - Send chat message
- ✅ `stream()` - Stream chat with real-time tokens

### Write Operations (Not Supported)
These operations require file system access and should be done via CLI:
- ❌ `create()`, `hire()`, `fire()` - Use `ait` CLI
- ❌ `init()` - Use `ait init`
- ❌ Provider operations - Use `ait provider` commands

## Architecture

```
Browser → HttpAiTeamClient → HTTP/WS → api-server → service → core
```

The HTTP client makes REST API calls and WebSocket connections to the API server, which then delegates to the service layer.
