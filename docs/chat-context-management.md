# Chat Context Management

The AI Team platform provides comprehensive chat context management features that give you full control over what content is sent to LLMs. This is crucial for maintaining clean, relevant context and avoiding clutter from smalltalk or outdated information.

## Overview

Chat context management enables you to:

- **Edit** message content to correct or refine information
- **Delete** messages that are no longer relevant
- **Copy** raw message content (Markdown) for reuse
- **Archive** messages to hide them from LLM context while keeping them visible in the UI
- **Annotate** messages with metadata (summaries, anti-patterns, highlights, notes)
- **Create summaries** from selected messages for future reference
- **View statistics** about message counts and archive status

## Core Concepts

### Message States

1. **Active Messages** - Shown in UI and sent to LLM (default)
2. **Archived Messages** - Shown in UI (grayed out) but NOT sent to LLM
3. **Deleted Messages** - Permanently removed from chat history

### Why Archive vs Delete?

- **Archive**: Preserve the message for reference but exclude it from LLM context
  - Use for: smalltalk, resolved issues, outdated information
  - Visual: 50% opacity with dashed border and "📦 Archived" badge
- **Delete**: Completely remove the message from history
  - Use for: mistakes, duplicates, truly irrelevant content
  - Permanent action (cannot be undone)

## UI Features

### Message Actions

Hover over any message to reveal action buttons:

- **✏️ Edit** - Modify message content
- **📋 Copy** - Copy raw message content to clipboard
- **📦 Archive** / **📂 Unarchive** - Toggle archive state
- **🗑️ Delete** - Permanently remove message

### Editing Messages

1. Click the **✏️** button on a message
2. Edit the content in the textarea that appears
3. Click **Save** to apply changes or **Cancel** to discard
4. The updated message is immediately saved to the chat history file

**Note**: You can edit both your own messages and AI agent messages to refine the context.

### Copying Messages

Click the **📋** button to copy the raw message content (typically Markdown format) to your clipboard. Useful for:

- Extracting code snippets
- Reusing explanations in other contexts
- Creating documentation from chat sessions

### Archiving Messages

Click the **📦** button to archive a message:

- Message remains visible with reduced opacity and dashed border
- "📦 Archived" badge appears in the message header
- Message is **NOT included** in context sent to LLM
- Click **📂** to unarchive and restore to active state

**Use cases**:

- Hide resolved troubleshooting discussions
- Remove casual conversation while preserving history
- Exclude outdated technical decisions
- Keep the LLM focused on current relevant context

### Deleting Messages

Click the **🗑️** button to permanently delete a message:

- Confirmation dialog appears ("Delete this message?")
- Message is removed from the JSONL chat history file
- Cannot be recovered after deletion
- Affects both UI display and LLM context

## API Reference

All chat context operations are available via REST API endpoints.

### Base URL

```
http://localhost:3002/api/chat
```

### Endpoints

#### Load Chat History

```http
GET /api/chat/:agentId?includeArchived=true
```

**Query Parameters**:

- `includeArchived` (optional, boolean) - Include archived messages in response (default: `false`)

**Response**: Array of chat messages

```json
[
  {
    "from": "human",
    "content": "Hello, can you help me?",
    "timestamp": "2026-02-26T20:30:00.000Z"
  },
  {
    "from": "michael-brown",
    "content": "Of course! What do you need help with?",
    "timestamp": "2026-02-26T20:30:05.000Z",
    "archived": false
  }
]
```

#### Edit Message

```http
PUT /api/chat/:agentId/messages/:index
Content-Type: application/json

{
  "content": "Updated message content"
}
```

**Parameters**:

- `:agentId` - Agent identifier (e.g., "michael-brown")
- `:index` - Zero-based message index in chat history

**Response**:

```json
{ "success": true }
```

#### Delete Message

```http
DELETE /api/chat/:agentId/messages/:index
```

**Parameters**:

- `:agentId` - Agent identifier
- `:index` - Zero-based message index

**Response**:

```json
{ "success": true }
```

#### Archive Message

```http
PATCH /api/chat/:agentId/messages/:index/archive
```

**Parameters**:

- `:agentId` - Agent identifier
- `:index` - Zero-based message index

**Response**:

```json
{ "success": true }
```

#### Unarchive Message

```http
PATCH /api/chat/:agentId/messages/:index/unarchive
```

**Parameters**:

- `:agentId` - Agent identifier
- `:index` - Zero-based message index

**Response**:

```json
{ "success": true }
```

#### Add Annotation to Message

```http
POST /api/chat/:agentId/messages/:index/annotate
Content-Type: application/json

{
  "type": "summary|anti-pattern|highlight|note",
  "content": "Annotation text",
  "tags": ["tag1", "tag2"]
}
```

**Parameters**:

- `:agentId` - Agent identifier
- `:index` - Zero-based message index

**Body**:

- `type` (required) - Annotation type: `summary`, `anti-pattern`, `highlight`, or `note`
- `content` (required) - Annotation text
- `tags` (optional) - Array of tag strings

**Response**:

```json
{ "success": true }
```

#### Create Summary from Selected Messages

```http
POST /api/chat/:agentId/summary
Content-Type: application/json

{
  "messageIndices": [0, 1, 2, 5],
  "title": "Summary Title",
  "tags": ["topic", "category"]
}
```

**Parameters**:

- `:agentId` - Agent identifier

**Body**:

- `messageIndices` (required) - Array of message indices to include
- `title` (required) - Summary title
- `tags` (optional) - Array of tag strings

**Response**:

```json
{
  "id": "summary-1709069400000",
  "title": "Summary Title",
  "content": "**User:** ...\n\n**Agent:** ...",
  "sourceMessages": {
    "agentId": "michael-brown",
    "messageIndices": [0, 1, 2, 5]
  },
  "timestamp": "2026-02-26T20:30:00.000Z",
  "tags": ["topic", "category"]
}
```

**Storage**: Summaries are saved as Markdown files with frontmatter in `.ai-team/artifacts/summaries/`

#### Get Message Statistics

```http
GET /api/chat/:agentId/stats
```

**Parameters**:

- `:agentId` - Agent identifier

**Response**:

```json
{
  "total": 42,
  "archived": 8,
  "active": 34,
  "byAgent": {
    "michael-brown": 42
  }
}
```

#### List All Summaries

```http
GET /api/chat/summaries
```

**Response**: Array of all saved summaries

```json
[
  {
    "id": "summary-1709069400000",
    "title": "Feature Discussion",
    "content": "...",
    "sourceMessages": {
      "agentId": "michael-brown",
      "messageIndices": [0, 1, 2]
    },
    "timestamp": "2026-02-26T20:30:00.000Z",
    "tags": ["feature", "planning"]
  }
]
```

## Service Layer (Core Package)

### ChatContextManager

The `ChatContextManager` class (from `@ai-team/core`) provides all context management functionality.

**Location**: `packages/core/src/chat/chat-context-manager.ts`

**Usage**:

```typescript
import { ChatContextManager } from '@ai-team/core';

const contextManager = new ChatContextManager(workspaceRoot);

// Archive a message
await contextManager.archiveMessage('agent-id', messageIndex);

// Edit a message
await contextManager.editMessage('agent-id', messageIndex, 'New content');

// Delete a message
await contextManager.deleteMessage('agent-id', messageIndex);

// Create summary
const summary = await contextManager.createSummary(
  'agent-id',
  [0, 1, 2], // message indices
  'Summary Title',
  ['tag1', 'tag2']
);

// Get stats
const stats = await contextManager.getMessageStats('agent-id');
```

### ChatManager Updates

The `ChatManager` class has been updated to respect archived messages.

**Method**: `loadChatHistory(agentId: string, includeArchived: boolean = false)`

By default, archived messages are filtered out when loading chat history for LLM context. Pass `includeArchived: true` to load all messages (e.g., for UI display).

```typescript
import { ChatManager } from '@ai-team/core';

const chatManager = new ChatManager(workspaceRoot);

// Load active messages only (for LLM)
const activeMessages = await chatManager.loadChatHistory('agent-id');

// Load all messages including archived (for UI)
const allMessages = await chatManager.loadChatHistory('agent-id', true);
```

## Storage Format

### Chat Sessions and Messages

**Location**: `.ai-team/private/ai-team.db` (SQLite database)

**Schema**: Normalized relational model with sessions, messages, and related entities

**Key Tables**:

- `sessions` - Session metadata (ID, agent, developer, timestamps, artifacts, etc.)
- `messages` - Chat messages (content, timestamps, handoff info, archived flag)
- `session_agents` - Multi-agent session tracking
- `session_artifacts`, `session_files` - Session context
- `message_files`, `message_suggestions` - Message metadata
- `message_tool_calls` - Tool invocation identity, input, and request timestamp
- `message_tool_results` - Correlated terminal output, phase, and completion timestamp

**Access**: Via `SessionManager` and `SqliteMessageStorage` (see `packages/service/src/storage/`)

**Migration**: Old JSONL files (`.ai-team/private/chats/*.jsonl`) are deprecated and no longer used

### Summary Files

**Location**: `.ai-team/artifacts/summaries/{summary-id}.md`

**Format**: Markdown with YAML frontmatter

**Example**:

```markdown
---
id: summary-1709069400000
title: Technical Discussion Summary
timestamp: '2026-02-26T20:30:00.000Z'
sourceMessages:
  agentId: michael-brown
  messageIndices:
    - 0
    - 1
    - 5
tags:
  - architecture
  - planning
---

**User:** How should we structure the API?

**Agent:** I recommend a REST-based approach...

**User:** What about WebSocket support?
```

## Types Reference

### ChatMessage

```typescript
interface ChatMessage {
  timestamp: string;
  from: 'human' | string; // 'human' or agent ID
  content: string;
  context?: string[]; // File paths referenced
  tool_calls?: ToolCall[];
  suggestions?: CodeSuggestion[];
  archived?: boolean; // If true, not sent to LLM
}
```

`ChatMessage.tool_calls` is the read-model projection used by LLM context and
older callers. Storage does not collapse the lifecycle into that projection:
the invocation and completion are separate rows joined by the internal tool
call record and exposed with a stable runtime `callId`. This preserves the
actual request/result timestamps while keeping existing context construction
compatible.

### MessageAnnotation

```typescript
interface MessageAnnotation {
  type: 'summary' | 'anti-pattern' | 'highlight' | 'note';
  content: string;
  timestamp: string;
  tags?: string[];
}
```

### AnnotatedChatMessage

```typescript
interface AnnotatedChatMessage extends ChatMessage {
  annotations?: MessageAnnotation[];
}
```

### ChatSummary

```typescript
interface ChatSummary {
  id: string;
  title: string;
  content: string;
  sourceMessages: {
    agentId: string;
    messageIndices: number[];
  };
  timestamp: string;
  tags?: string[];
}
```

### MessageStats

```typescript
interface MessageStats {
  total: number;
  archived: number;
  active: number;
  byAgent: Record<string, number>;
}
```

## Best Practices

### When to Archive

✅ **Good candidates for archiving**:

- Casual greetings and goodbyes
- Troubleshooting steps that led to dead ends
- Resolved error discussions
- Outdated technical decisions
- Small talk that doesn't inform future responses
- Duplicate or clarifying questions

❌ **Keep active**:

- Current project requirements
- Recent technical decisions
- Active troubleshooting context
- Key insights and discoveries
- Code examples being referenced
- Project-specific conventions

### Context Hygiene Workflow

1. **During the conversation**: Focus on the task
2. **After resolution**: Review the chat and archive:
   - Error messages that were resolved
   - Trial-and-error attempts
   - Tangential discussions
3. **Before new features**: Archive completed feature discussions
4. **Periodically**: Create summaries of important conversations and archive the source messages

### Annotation Strategy

- **`summary`**: Key takeaways from a discussion
- **`anti-pattern`**: Examples of what NOT to do (helps LLM learn from mistakes)
- **`highlight`**: Important decisions or insights
- **`note`**: Additional context or reminders

## Future Features (Planned)

- **Multi-select mode**: Select multiple messages for batch operations
- **Summary generation UI**: Create summaries directly from message selection
- **Search and filter**: Find messages by content, date, or tags
- **Export conversations**: Export chat history as Markdown or PDF
- **Context insights**: Analyze what's in your LLM context
- **Archive suggestions**: AI-powered recommendations for what to archive

## Troubleshooting

### Delete doesn't remove message

**Issue**: Clicking delete doesn't remove the message from UI

**Solution**:

1. Hard refresh the browser (Ctrl+F5 or Ctrl+Shift+R)
2. Check browser console for errors
3. Verify API server is running (check for logs in server terminal)
4. Check server logs for `[DELETE] Deleting message X for agent Y`

### Changes not persisting

**Issue**: Edits or archive changes revert on page reload

**Solution**:

1. Ensure API server is running the latest built code
2. Rebuild API server: `pnpm --filter @ai-team/api-server build`
3. Restart API server
4. Check server logs for errors during save operations

### Archive not affecting LLM context

**Issue**: Archived messages still appear in LLM responses

**Solution**:

- Archive only affects new messages sent after archiving
- Existing LLM responses may reference previously unarchived content
- Start a fresh conversation to verify archive is working

## See Also

- [API Contracts](api/contracts.md) - Full API specification
- [Web UI Development](web-ui-development.md) - Development workflow
- [Architecture Overview](architecture/overview.md) - System architecture
