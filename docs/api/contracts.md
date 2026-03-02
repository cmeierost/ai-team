# API Contracts

This document defines stable contracts between frontend and backend services.

## Interactive API Documentation

The API server includes **Swagger UI** for interactive API testing and exploration:

- **Swagger UI**: http://localhost:3002/api-docs
- **OpenAPI JSON Spec**: http://localhost:3002/api-docs.json

Swagger UI provides:
- Complete API endpoint documentation with request/response schemas
- Interactive testing interface - try endpoints directly from the browser
- Request/response examples for all operations
- Schema exploration for data models

**Quick Test Workflow:**
1. Start the API server (see below)
2. Open http://localhost:3002/api-docs in your browser
3. Expand any endpoint to see details
4. Click "Try it out" to test with sample data
5. Execute requests and view real responses

## Base URL

- **Development**: `http://localhost:3002`
- **Production**: Same origin as web UI

## Common Response Patterns

### Success Response
```typescript
{
  // Response data varies by endpoint
}
```

### Error Response
```typescript
{
  error: string;        // Error type/category
  message: string;      // Human-readable error message
}
```

## Agents API

### List Agents
- **Endpoint**: `GET /api/agents`
- **Purpose**: Retrieve all agents in the team
- **Response**: `Agent[]`

### Get Agent
- **Endpoint**: `GET /api/agents/:agentId`
- **Purpose**: Get detailed information about a specific agent
- **Response**: `Agent`

## Team API

### Get Organization Graph
- **Endpoint**: `GET /api/team/graph`
- **Query**: `viewMode?: 'hierarchy' | 'features' | 'expertise' | 'matrix'`
- **Purpose**: Get team structure visualization data
- **Response**: `GraphData`

## Chat API

### Send Message
- **Endpoint**: `POST /api/chat/:agentId`
- **Purpose**: Send a message to an agent
- **Request Body**:
```typescript
{
  content: string;
  developerId: string;
}
```
- **Response**: `{ success: boolean }`

### WebSocket Chat
- **Endpoint**: `ws://localhost:3002/ws`
- **Purpose**: Real-time bidirectional chat communication
- **Events**:
  - Client → Server: `chat_message`
  - Server → Client: `agent_response`, `agent_thinking`, `tool_use`, `handoff`

## Sessions API

### Get Latest Session
- **Endpoint**: `GET /api/sessions/:agentId/latest`
- **Purpose**: Get or create the most recent session for an agent
- **Response**: `ChatSession`

### List Sessions
- **Endpoint**: `GET /api/sessions`
- **Query**: `agentId: string, limit?: number`
- **Purpose**: Get recent sessions for an agent
- **Response**: `ChatSession[]`

### Get Session
- **Endpoint**: `GET /api/sessions/:sessionId`
- **Purpose**: Get session metadata
- **Response**: `ChatSession`

### Get Session Messages
- **Endpoint**: `GET /api/sessions/:sessionId/messages`
- **Purpose**: Get all messages in a session
- **Response**: `ChatMessage[]`

### Create Session
- **Endpoint**: `POST /api/sessions`
- **Purpose**: Create a new chat session
- **Request Body**:
```typescript
{
  agentId: string;
  developerId: string;
}
```
- **Response**: `ChatSession`

### Split Session
- **Endpoint**: `POST /api/sessions/:sessionId/split`
- **Purpose**: Split session history at a message index
- **Request Body**:
```typescript
{
  splitAtIndex: number;
  developerId: string;
}
```
- **Response**: `{ oldSession: ChatSession, newSession: ChatSession }`

### Summarize Messages
- **Endpoint**: `POST /api/sessions/:sessionId/summarize`
- **Purpose**: Create a brief/artifact from message range
- **Request Body**:
```typescript
{
  fromIndex: number;
  toIndex: number;
  developerId: string;
}
```
- **Response**: `Artifact`

### Update Session
- **Endpoint**: `PATCH /api/sessions/:sessionId`
- **Purpose**: Update session metadata (e.g., artifacts in context)
- **Request Body**: `Partial<ChatSession>`
- **Response**: `ChatSession`

## Artifacts API

### List Artifacts
- **Endpoint**: `GET /api/artifacts`
- **Purpose**: Get all briefs and summaries
- **Response**: `Artifact[]`

### Get Artifact
- **Endpoint**: `GET /api/artifacts/:artifactId`
- **Purpose**: Get specific artifact content
- **Response**: `Artifact`

## Tasks API

### List Tasks
- **Endpoint**: `GET /api/tasks`
- **Purpose**: Get tasks with optional filtering
- **Query Parameters**:
  - `status?: TaskStatus | TaskStatus[]`
  - `priority?: TaskPriority | TaskPriority[]`
  - `assignedTo?: string`
  - `createdBy?: string`
  - `type?: TaskType | TaskType[]`
  - `tags?: string[]`
  - `parentTaskId?: string | "null"`
- **Response**: `Task[]`

### Get Task
- **Endpoint**: `GET /api/tasks/:taskId`
- **Purpose**: Get detailed task information
- **Response**: `Task`

### Get Task Hierarchy
- **Endpoint**: `GET /api/tasks/:taskId/hierarchy`
- **Purpose**: Get task with all subtasks recursively
- **Response**: `Task[]`

### Create Task
- **Endpoint**: `POST /api/tasks`
- **Purpose**: Create a new task
- **Request Body**:
```typescript
{
  type: TaskType;                // Required
  title: string;                 // Required
  description?: string;
  createdBy: string;             // Required
  createdByType: "human" | "agent";  // Required
  assignedTo?: string;
  priority: TaskPriority;
  requiresApproval: boolean;
  estimatedHours?: number;
  dueDate?: string;  // ISO date
  tags?: string[];
  workflowSteps?: Omit<WorkflowStep, "id" | "status" | "completedAt">[];
  metadata?: Record<string, any>;
}
```
- **Response**: `Task`

### Update Task
- **Endpoint**: `PATCH /api/tasks/:taskId`
- **Purpose**: Update task fields
- **Request Body**: `Partial<Task>`
- **Response**: `Task`

### Split Task
- **Endpoint**: `POST /api/tasks/:taskId/split`
- **Purpose**: Create subtasks for a parent task
- **Request Body**:
```typescript
{
  subtasks: Array<{
    type: TaskType;
    title: string;
    createdBy: string;
    createdByType: "human" | "agent";
    // ... other Task fields except id, parentTaskId, status, createdAt, updatedAt
  }>
}
```
- **Response**: `Task[]` (created subtasks)

### Delegate Task
- **Endpoint**: `POST /api/tasks/:taskId/delegate`
- **Purpose**: Delegate task to another agent
- **Request Body**:
```typescript
{
  fromAgentId: string;   // Required
  toAgentId: string;     // Required
  reason?: string;
}
```
- **Response**: `Task`

### Log Time
- **Endpoint**: `POST /api/tasks/:taskId/time`
- **Purpose**: Log work time on a task
- **Request Body**:
```typescript
{
  agentId: string;           // Required
  durationMinutes: number;   // Required
  description?: string;
}
```
- **Response**: `Task`

### Get Dashboard Statistics
- **Endpoint**: `GET /api/tasks/dashboard`
- **Purpose**: Get aggregated task statistics
- **Response**: `TaskStatistics`

### List Templates
- **Endpoint**: `GET /api/tasks/templates`
- **Purpose**: Get available task templates
- **Response**: `TaskTemplate[]`

### Create from Template
- **Endpoint**: `POST /api/tasks/from-template`
- **Purpose**: Create task from a template with variable substitution
- **Request Body**:
```typescript
{
  templateId: string;                // Required
  variables: Record<string, string>; // Required
  overrides?: Partial<Task>;
}
```
- **Response**: `Task`

## Health Check

### Server Health
- **Endpoint**: `GET /api/health`
- **Purpose**: Check if server is running
- **Response**:
```typescript
{
  status: "ok";
  workspace: string;
}
```

## Data Types

### Agent
```typescript
{
  id: string;
  name: string;
  role: string;
  reportsTo?: string;
  features?: string[];
  specializations?: string[];
  status?: 'available' | 'busy' | 'in-meeting' | 'offline';
  markdown?: string;
  avatar?: AvatarConfig;
}
```

### ChatSession
```typescript
{
  id: string;              // session-2026-02-27-abc123
  agentId: string;
  developerId: string;     // clemens-meier
  startedAt: string;       // ISO timestamp
  lastActivityAt: string;  // ISO timestamp
  messageCount: number;
  artifacts: string[];     // Artifact IDs in context
  allowedFiles: string[];  // File paths agent can access
}
```

### ChatMessage
```typescript
{
  from: string;           // Agent or developer ID
  to?: string;            // Target agent (for handoffs)
  isHuman?: boolean;      // True if from developer
  content: string;
  timestamp: string;      // ISO timestamp
  archived?: boolean;
}
```

### Artifact
```typescript
{
  id: string;                // brief-user-auth-design
  type: 'brief' | 'summary' | 'record' | 'document';
  title: string;
  content: string;           // Markdown content
  createdAt: string;         // ISO timestamp
  createdBy: string;         // Developer ID
  sourceSessionId: string;   // Session where created
  fromMessageIndex: number;  // Start of range
  toMessageIndex: number;    // End of range
  filepath: string;          // .ai-team/artifacts/briefs/*.md
  tags?: string[];
}
```

### Task
```typescript
{
  id: string;                      // FEAT-202602-A3D5
  type: "feature" | "bug" | "documentation";
  title: string;
  description?: string;
  createdBy: string;
  createdByType: "human" | "agent";
  assignedTo?: string;
  status: TaskStatus;              // See TaskStatus enum
  priority: "low" | "medium" | "high" | "urgent";
  requiresApproval: boolean;
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  parentTaskId?: string;
  subtaskIds?: string[];
  executionMode?: "sequential" | "parallel";
  workflowSteps?: WorkflowStep[];
  estimatedHours?: number;
  actualHours?: number;
  timeLog?: TimeLogEntry[];
  dueDate?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  tags?: string[];
  sessionId?: string;
  artifactIds?: string[];
  delegationHistory?: TaskDelegationRecord[];
  delegatedTo?: string;
  blockedReason?: string;
  blockedBy?: string[];
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
```

### TaskStatus Enum
- `not_started` - Created but not begun
- `in_progress` - Currently being worked on
- `blocked` - Waiting on dependencies
- `waiting_approval` - Pending human approval
- `completed` - Successfully finished
- `cancelled` - Abandoned
- `delegated` - Handed off to another agent

## Error Handling

All endpoints return appropriate HTTP status codes:

- **200 OK**: Successful GET/PATCH
- **201 Created**: Successful POST creating a resource
- **400 Bad Request**: Invalid request body or parameters
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server-side error

Error responses include:
```typescript
{
  error: string;    // Error category
  message: string;  // Detailed error message
}
```

## Versioning and Compatibility

### Current Version
- API v1 (implicit, no version prefix in URLs)

### Compatibility Policy
- Breaking changes will require coordination between frontend and backend deployments
- Additive changes (new optional fields, new endpoints) are considered non-breaking
- Field deprecation will be communicated in advance

### Migration Strategy
When breaking changes are necessary:
1. Announce change to development team
2. Update backend with backward-compatible support
3. Update frontend to use new API
4. Remove old API support after transition period

### Type Safety
- TypeScript types should be kept in sync between packages
- `packages/core/src/types` - Source of truth
- `packages/web/src/types` - Browser-safe subset (no Node.js APIs)
- `packages/service` and `packages/api-server` import from core
