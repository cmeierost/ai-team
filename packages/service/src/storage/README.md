# Storage Layer

The storage layer provides an abstraction over message and session persistence, allowing the service to swap implementations without changing business logic.

## Architecture

The storage layer follows the **Repository Pattern** with dependency injection:

- **Interface**: `IMessageStorage` defines the contract for all storage implementations
- **Implementation**: `SqliteMessageStorage` provides SQLite-based persistence
- **Factory**: `createSqliteStorage()` creates configured instances
- **Connection**: `SqliteConnection` wraps sqlite3 with Promise-based API
- **Migrations**: `MigrationManager` handles schema evolution

### Why Abstract Storage?

1. **Testability**: Tests can use in-memory SQLite or mock implementations
2. **Flexibility**: Easy to switch to PostgreSQL, MySQL, or cloud databases later
3. **Separation of Concerns**: Business logic in `SessionManager` doesn't depend on storage details
4. **Development**: Can delete `.ai-team/private/ai-team.db` anytime during solo development

## Database Schema

The SQLite database uses a normalized relational model for efficient querying:

```mermaid
erDiagram
    sessions ||--o{ messages : "contains"
    sessions ||--o{ session_agents : "has"
    sessions ||--o{ session_artifacts : "tracks"
    sessions ||--o{ session_files : "includes"
    sessions ||--o{ session_tasks : "manages"
    sessions ||--o{ session_merged_from : "merged"
    sessions ||--o| session_rag_config : "configures"
    
    messages ||--o{ message_files : "references"
    messages ||--o{ message_tool_calls : "invokes"
    messages ||--o{ message_suggestions : "suggests"
    
    sessions {
        TEXT id PK
        TEXT developer_id
        TEXT started_at
        TEXT last_activity_at
        INTEGER message_count
        TEXT title
        TEXT notes
        TEXT previous_session_id
        TEXT created_at
        TEXT updated_at
    }
    
    messages {
        INTEGER id PK "AUTOINCREMENT"
        TEXT session_id FK
        TEXT timestamp
        TEXT from_id
        TEXT to_id
        INTEGER is_human
        TEXT content
        INTEGER archived
        TEXT handoff_type
        TEXT target_agent_id
    }
    
    session_agents {
        TEXT session_id PK_FK
        TEXT agent_id PK
    }
    
    message_files {
        INTEGER message_id PK_FK
        TEXT file_path PK
    }
    
    message_tool_calls {
        INTEGER id PK "AUTOINCREMENT"
        INTEGER message_id FK
        TEXT tool_name
        TEXT params_json
        TEXT result_json
    }
    
    message_suggestions {
        INTEGER id PK "AUTOINCREMENT"
        INTEGER message_id FK
        TEXT suggestion_type
        TEXT file_path
        INTEGER line_number
        TEXT description
        TEXT code
    }
    
    session_artifacts {
        TEXT session_id PK_FK
        TEXT artifact_path PK
    }
    
    session_files {
        TEXT session_id PK_FK
        TEXT file_path PK
        INTEGER is_prioritized
    }
    
    session_tasks {
        TEXT session_id PK_FK
        TEXT task_id PK
    }
    
    session_merged_from {
        TEXT session_id PK_FK
        TEXT merged_session_id PK
    }
    
    session_rag_config {
        TEXT session_id PK_FK
        TEXT config_json
    }
    
    notes {
        TEXT id PK
        TEXT agent_id
        TEXT title
        TEXT content
        TEXT tags_json
        TEXT created_at
        TEXT updated_at
    }
```

### Schema Design Rationale

- **Normalized tables**: Reduces data duplication and maintains referential integrity
- **Foreign keys with CASCADE**: Deleting a session automatically cleans up related records
- **Indexes**: Optimized for common query patterns (session lookups, message history, agent filtering, note lookups)
- **JSON storage**: RAG config, tool parameters, and note tags stored as JSON for flexibility
- **TEXT timestamps**: ISO 8601 format strings for easy parsing and timezone handling
- **INTEGER booleans**: SQLite convention (0 = false, 1 = true)
- **Notes independence**: Notes are standalone entities (not tied to sessions) for flexible future work planning

## Usage

### Creating Storage Instance

```typescript
import { createSqliteStorage } from '@ai-team/service/storage';

const storage = createSqliteStorage('/path/to/workspace');
await storage.initialize(); // Creates DB, runs migrations
```

### Dependency Injection into SessionManager

```typescript
import { SessionManager } from '@ai-team/service';
import { createSqliteStorage } from '@ai-team/service/storage';

const storage = createSqliteStorage(workspaceRoot);
const sessionManager = new SessionManager(workspaceRoot, storage);
```

### Querying Messages

```typescript
// Get all messages for a session
const messages = await storage.getMessages(sessionId);

// Filter messages by agent
const agentMessages = await storage.getMessages(sessionId, {
  fromId: 'architect-agent'
});

// Search messages by content
const searchResults = await storage.searchMessages(sessionId, 'error handling');

// Get archived messages only
const archived = await storage.getMessages(sessionId, {
  archived: true
});
```

### Transactions

```typescript
await storage.transaction(async () => {
  await storage.appendMessage(sessionId, message1);
  await storage.appendMessage(sessionId, message2);
  // Both messages committed together, or both rolled back on error
});
```

### Agent Notes

Notes are standalone information items assigned to agents for future work planning:

```typescript
// Create a note for an agent
const note = await storage.createNote({
  agentId: 'architect-agent',
  title: 'Refactor auth module',
  content: 'Consider using JWT tokens instead of session cookies. Review security implications.',
  tags: ['security', 'authentication', 'refactoring']
});

// List all notes for an agent
const notes = await storage.listAgentNotes('architect-agent');

// Search notes by content
const searchResults = await storage.searchNotes('authentication', 'architect-agent');

// Update a note
await storage.updateNote(note.id, {
  content: 'Updated implementation plan...',
  tags: ['security', 'authentication', 'refactoring', 'high-priority']
});

// Delete a note
await storage.deleteNote(note.id);
```

## Migrations

Schema changes are versioned and tracked in `sqlite/migrations.ts`:

```typescript
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `CREATE TABLE ...`,
  },
  // Future migrations go here with version 2, 3, etc.
];
```

### Auto-Migration

Migrations run automatically on `storage.initialize()`:
- Checks current schema version in `schema_version` table
- Applies any pending migrations in order
- Tracks applied migrations to prevent double-application

### Manual Migration (via CLI)

```bash
# Check current schema version
ait db:status

# Apply pending migrations (usually not needed - auto-runs on init)
ait db:migrate
```

### Resetting Database (Solo Development)

During solo development, you can reset the database anytime:

```bash
# Delete the database file
rm .ai-team/private/ai-team.db

# Next storage.initialize() recreates it with latest schema
```

## File Structure

```
storage/
├── README.md                  # This file
├── contracts.ts               # IMessageStorage interface
├── index.ts                   # Public exports
└── sqlite/
    ├── connection.ts          # SqliteConnection wrapper
    ├── migrations.ts          # Schema versions and MigrationManager
    └── sqlite-storage.ts      # SqliteMessageStorage implementation
```

## Performance Characteristics

- **WAL Mode**: Enables concurrent reads without blocking writes
- **Prepared Statements**: All queries use parameterized statements (prevents SQL injection)
- **Indexes**: Common queries (by session, by agent, by timestamp) are indexed
- **Foreign Keys**: Enforced at database level for data integrity
- **Transactions**: Atomic multi-operation updates

## Future Considerations

### Adding New Storage Implementations

To add PostgreSQL, MySQL, or cloud storage:

1. Create `packages/service/src/storage/postgres/` directory
2. Implement `IMessageStorage` interface
3. Add factory function `createPostgresStorage()`
4. Update service initialization to choose storage type

### Schema Evolution

To add new fields or tables:

1. Add migration to `MIGRATIONS` array with next version number
2. Write `up` SQL for schema changes
3. Optionally write `down` SQL for rollback
4. Test migration on copy of production data
5. Deploy - migrations auto-apply on next `initialize()`

### Migration Strategy

- Current design uses forward migrations
- For production use, consider adding:
  - Migration rollback command (`db:rollback`)
  - Data transformation migrations (not just DDL)
  - Schema validation tests
  - Backup/restore utilities

## Related Documentation

- [Service Package README](../../README.md)
- [Session Manager](../session-manager.ts)
- [Storage Contracts](./contracts.ts)
- [SQL Migrations](./sqlite/migrations.ts)
