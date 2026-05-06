# Storage Layer

The storage layer provides an abstraction over message and session persistence, allowing the service to swap implementations without changing business logic.

## Architecture

The storage layer follows the **Repository Pattern** with dependency injection:

- **Interface**: `IMessageStorage` defines the contract for all storage implementations
- **Implementation**: `SqliteMessageStorage` provides SQLite-based persistence
- **Factory**: `createSqliteStorage()` creates configured instances
- **Connection**: `SqliteConnection` wraps Drizzle + `better-sqlite3` behind Promise-based methods
- **Migrations**: `MigrationManager` enforces alpha baseline schema initialization and legacy reset

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
await storage.migrate(); // Ensures baseline schema is initialized
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
const messages = await storage.getSessionMessages(sessionId);

// Filter messages by agent
const agentMessages = await storage.queryMessages({
  sessionId,
  fromId: 'architect-agent',
});

// Search messages by content
const searchResults = await storage.searchMessages('error handling', sessionId);

// Get archived messages only
const archived = await storage.queryMessages({
  sessionId,
  archived: true,
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
  tags: ['security', 'authentication', 'refactoring'],
});

// List all notes for an agent
const notes = await storage.listAgentNotes('architect-agent');

// Search notes by content
const searchResults = await storage.searchNotes('authentication', 'architect-agent');

// Update a note
await storage.updateNote(note.id, {
  content: 'Updated implementation plan...',
  tags: ['security', 'authentication', 'refactoring', 'high-priority'],
});

// Delete a note
await storage.deleteNote(note.id);
```

## Migrations

Schema initialization is handled by `sqlite/migrations.ts` with an **alpha baseline policy**:

```typescript
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_alpha_baseline_schema',
    up: `CREATE TABLE ...`,
  },
];
```

### Auto-initialization

Baseline initialization runs automatically on first storage usage:

- Checks current schema version in `schema_version` table
- Applies baseline schema when missing
- Auto-resets legacy alpha schemas/data if incompatible versions are detected

### Manual reset/init (via CLI)

```bash
# Check current schema version
ait db:status

# Reset database and re-initialize baseline schema (alpha behavior)
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
    ├── migrations.ts          # Alpha baseline schema + reset-aware MigrationManager
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

### Schema Evolution (Post-Alpha)

Versioned incremental migrations are intentionally deferred until the product exits alpha.

When enabling post-alpha migrations:

1. Extend `sqlite/migrations.ts` with versioned entries above baseline `v1`
2. Remove alpha reset-only assumptions from CLI wording and operator docs
3. Add migration-specific tests for upgrade paths between released versions
4. Add rollback/backfill policy as part of production hardening

## Related Documentation

- [Service Package README](../../README.md)
- [Session Manager](../session-manager.ts)
- [Storage Contracts](./contracts.ts)
- [SQL Migrations](./sqlite/migrations.ts)
