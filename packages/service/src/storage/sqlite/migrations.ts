import type { SqliteConnection } from './connection.js';

/**
 * Schema version tracking and migration system
 * Allows evolving the database schema over time without breaking existing data
 */

export interface Migration {
  version: number;
  name: string;
  up: string; // SQL to apply migration
  down?: string; // SQL to rollback migration (optional)
}

/**
 * Schema migrations registry
 * Each migration must have a unique, sequential version number
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Schema version tracking
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      
      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        developer_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        notes TEXT,
        previous_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      -- Session-Agent many-to-many relationship
      CREATE TABLE IF NOT EXISTS session_agents (
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        PRIMARY KEY (session_id, agent_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      
      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT,
        is_human INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        handoff_type TEXT,
        target_agent_id TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      
      -- Message context files (message -> file paths)
      CREATE TABLE IF NOT EXISTS message_files (
        message_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        PRIMARY KEY (message_id, file_path),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      
      -- Message tool calls
      CREATE TABLE IF NOT EXISTS message_tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        params_json TEXT NOT NULL,
        result_json TEXT,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      
      -- Message code suggestions
      CREATE TABLE IF NOT EXISTS message_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        suggestion_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line_number INTEGER,
        description TEXT NOT NULL,
        code TEXT,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      
      -- Session artifacts
      CREATE TABLE IF NOT EXISTS session_artifacts (
        session_id TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        PRIMARY KEY (session_id, artifact_path),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      
      -- Session files (allowedFiles and prioritizedFiles)
      CREATE TABLE IF NOT EXISTS session_files (
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        is_prioritized INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, file_path),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      
      -- Session tasks
      CREATE TABLE IF NOT EXISTS session_tasks (
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        PRIMARY KEY (session_id, task_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      
      -- Session merged sessions tracking
      CREATE TABLE IF NOT EXISTS session_merged_from (
        session_id TEXT NOT NULL,
        merged_session_id TEXT NOT NULL,
        PRIMARY KEY (session_id, merged_session_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      
      -- Session RAG configuration (stored as JSON for flexibility)
      CREATE TABLE IF NOT EXISTS session_rag_config (
        session_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      
      -- Agent notes
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        tags_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp ON messages(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_from_id ON messages(from_id);
      CREATE INDEX IF NOT EXISTS idx_messages_to_id ON messages(to_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_developer ON sessions(developer_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_agents_agent ON session_agents(agent_id);
      CREATE INDEX IF NOT EXISTS idx_notes_agent ON notes(agent_id);
      CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
    `,
  },
  {
    version: 2,
    name: 'add_fts5_search',
    up: `
      -- Full-text search for messages (uses default unicode61 tokenizer)
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        from_id UNINDEXED,
        session_id UNINDEXED,
        message_id UNINDEXED
      );
      
      -- Triggers to keep FTS index in sync with messages table
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(content, from_id, session_id, message_id)
        VALUES (new.content, new.from_id, new.session_id, new.id);
      END;
      
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE message_id = old.id;
      END;
     CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        UPDATE messages_fts 
        SET content = new.content, from_id = new.from_id, session_id = new.session_id
        WHERE message_id = old.id;
      END;
      
      -- Full-text search for notes (uses default unicode61 tokenizer)
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        title,
        content,
        agent_id UNINDEXED,
        note_id UNINDEXED
      );
      
      -- Triggers to keep notes FTS index in sync
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(title, content, agent_id, note_id)
        VALUES (new.title, new.content, new.agent_id, new.id);
      END;
      
      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        DELETE FROM notes_fts WHERE note_id = old.id;
      END;
      
      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        UPDATE notes_fts
        SET title = new.title, content = new.content, agent_id = new.agent_id
        WHERE note_id = old.id;
      END;
      
      -- Populate FTS tables with existing data
      INSERT INTO messages_fts(content, from_id, session_id, message_id)
      SELECT content, from_id, session_id, id FROM messages;
      
      INSERT INTO notes_fts(title, content, agent_id, note_id)
      SELECT title, content, agent_id, id FROM notes;
    `,
  },
  {
    version: 3,
    name: 'add_handoff_session_links',
    up: `
      ALTER TABLE messages ADD COLUMN handoff_from_session_id TEXT;
      ALTER TABLE messages ADD COLUMN handoff_to_session_id TEXT;
    `,
  },
  {
    version: 4,
    name: 'add_handoff_id',
    up: `
      ALTER TABLE messages ADD COLUMN handoff_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_messages_handoff_id ON messages(handoff_id) WHERE handoff_id IS NOT NULL;
    `,
  },
  {
    version: 5,
    name: 'add_message_importance',
    up: `
      ALTER TABLE messages ADD COLUMN importance TEXT;
      CREATE INDEX IF NOT EXISTS idx_messages_importance ON messages(importance) WHERE importance IS NOT NULL;
    `,
  },
  {
    version: 6,
    name: 'add_session_skills',
    up: `
      -- Session skills — tracks which .ai-team/skills/<id>/SKILL.md files have been
      -- loaded for a session (by path). Content is never stored; loaded from disk each turn.
      CREATE TABLE IF NOT EXISTS session_skills (
        session_id TEXT NOT NULL,
        skill_path TEXT NOT NULL,
        loaded_at TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, skill_path),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_session_skills_session ON session_skills(session_id);
    `,
  },
  {
    version: 7,
    name: 'add_tool_call_llm_result',
    up: `
      ALTER TABLE message_tool_calls ADD COLUMN result_llm TEXT;
    `,
  },
  {
    version: 8,
    name: 'add_notes_attachments_and_message_session_links',
    up: `
      ALTER TABLE notes ADD COLUMN session_id TEXT;
      ALTER TABLE notes ADD COLUMN attachment_name TEXT;
      ALTER TABLE notes ADD COLUMN attachment_path TEXT;
      ALTER TABLE notes ADD COLUMN attachment_content_type TEXT;
      ALTER TABLE notes ADD COLUMN attachment_size_bytes INTEGER;
      ALTER TABLE notes ADD COLUMN attachment_description TEXT;

      CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id);

      CREATE TABLE IF NOT EXISTS message_session_links (
        message_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, session_id),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_message_session_links_session ON message_session_links(session_id);
    `,
  },
  {
    version: 9,
    name: 'add_note_session_shares',
    up: `
      CREATE TABLE IF NOT EXISTS note_session_shares (
        note_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (note_id, session_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_note_session_shares_note ON note_session_shares(note_id);
      CREATE INDEX IF NOT EXISTS idx_note_session_shares_session ON note_session_shares(session_id);
    `,
  },
  {
    version: 10,
    name: 'add_notes_compacted_and_hidden',
    up: `
      ALTER TABLE notes ADD COLUMN compacted_content TEXT;
      ALTER TABLE notes ADD COLUMN hidden_from_llm INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 11,
    name: 'add_notes_show_on_dashboard',
    up: `
      ALTER TABLE notes ADD COLUMN show_on_dashboard INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 12,
    name: 'drop_legacy_session_tasks_table',
    up: `
      DROP TABLE IF EXISTS session_tasks;
    `,
  },
  {
    version: 13,
    name: 'create_planning_pipeline_schema',
    up: `
      CREATE TABLE IF NOT EXISTS planning_intake_items (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        source_url TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_intake_source
        ON planning_intake_items(source_type, source_ref);
      CREATE INDEX IF NOT EXISTS idx_planning_intake_status
        ON planning_intake_items(status);

      CREATE TABLE IF NOT EXISTS planning_plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_by_type TEXT NOT NULL,
        assigned_to TEXT,
        origin_type TEXT NOT NULL,
        origin_session_id TEXT,
        origin_note_id TEXT,
        markdown_snapshot TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_planning_plans_status
        ON planning_plans(status);
      CREATE INDEX IF NOT EXISTS idx_planning_plans_assigned_to
        ON planning_plans(assigned_to);

      CREATE TABLE IF NOT EXISTS planning_plan_intake_items (
        plan_id TEXT NOT NULL,
        intake_item_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, intake_item_id),
        FOREIGN KEY (plan_id) REFERENCES planning_plans(id) ON DELETE CASCADE,
        FOREIGN KEY (intake_item_id) REFERENCES planning_intake_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS planning_tasks (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_by_type TEXT NOT NULL,
        assigned_to TEXT,
        source_action_item TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES planning_plans(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_planning_tasks_plan_id
        ON planning_tasks(plan_id);
      CREATE INDEX IF NOT EXISTS idx_planning_tasks_session_id
        ON planning_tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_planning_tasks_assigned_to
        ON planning_tasks(assigned_to);

      CREATE TABLE IF NOT EXISTS planning_todos (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        content TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        completed_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES planning_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_planning_todos_task_id
        ON planning_todos(task_id);

      CREATE TABLE IF NOT EXISTS planning_task_delegations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        reason TEXT,
        delegated_at TEXT NOT NULL,
        accepted INTEGER NOT NULL DEFAULT 0,
        accepted_at TEXT,
        FOREIGN KEY (task_id) REFERENCES planning_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_planning_task_delegations_task_id
        ON planning_task_delegations(task_id);
    `,
  },
  {
    version: 14,
    name: 'add_messages_hidden_from_llm',
    up: `
      ALTER TABLE messages ADD COLUMN hidden_from_llm INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_messages_hidden_from_llm ON messages(hidden_from_llm);
    `,
  },
  {
    version: 15,
    name: 'add_note_attachments_table',
    up: `
      CREATE TABLE IF NOT EXISTS note_attachments (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id, sort_order);

      INSERT INTO note_attachments (
        id,
        note_id,
        file_name,
        file_path,
        content_type,
        size_bytes,
        description,
        sort_order,
        created_at
      )
      SELECT
        n.id || '-legacy-0',
        n.id,
        n.attachment_name,
        n.attachment_path,
        n.attachment_content_type,
        COALESCE(n.attachment_size_bytes, 0),
        n.attachment_description,
        0,
        COALESCE(n.updated_at, n.created_at, datetime('now'))
      FROM notes n
      WHERE n.attachment_path IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM note_attachments na
          WHERE na.note_id = n.id
        );
    `,
  },
];

/**
 * Schema migration manager
 */
export class MigrationManager {
  constructor(private readonly db: SqliteConnection) {}

  /**
   * Get the current schema version
   * @returns Current version number or 0 if no version table exists
   */
  async getCurrentVersion(): Promise<number> {
    try {
      const row = await this.db.get<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_version'
      );
      return row?.version || 0;
    } catch {
      // Table doesn't exist yet, version is 0
      return 0;
    }
  }

  /**
   * Get the target schema version (latest migration)
   */
  getTargetVersion(): number {
    return MIGRATIONS.length > 0 ? Math.max(...MIGRATIONS.map((m) => m.version)) : 0;
  }

  /**
   * Check if migrations are needed
   */
  async needsMigration(): Promise<boolean> {
    const current = await this.getCurrentVersion();
    const target = this.getTargetVersion();
    return current < target;
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations(): Promise<Migration[]> {
    const currentVersion = await this.getCurrentVersion();
    return MIGRATIONS.filter((m) => m.version > currentVersion).sort(
      (a, b) => a.version - b.version
    );
  }

  /**
   * Apply all pending migrations
   * @returns Number of migrations applied
   */
  async migrate(): Promise<number> {
    const pending = await this.getPendingMigrations();

    if (pending.length === 0) {
      return 0;
    }

    for (const migration of pending) {
      await this.applyMigration(migration);
    }

    return pending.length;
  }

  /**
   * Apply a single migration
   */
  private async applyMigration(migration: Migration): Promise<void> {
    const now = new Date().toISOString();

    // Execute migration SQL in a transaction
    await this.db.run('BEGIN TRANSACTION');

    try {
      // Execute the migration SQL (may contain multiple statements including triggers)
      await this.db.exec(migration.up);

      // Track the migration version
      await this.db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
        migration.version,
        now,
      ]);

      await this.db.run('COMMIT');

      console.log(`Applied migration v${migration.version}: ${migration.name}`);
    } catch (error) {
      await this.db.run('ROLLBACK');
      throw error;
    }
  }

  private initialized = false;

  /**
   * Initialize the database (run all migrations if needed).
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const applied = await this.migrate();
    this.initialized = true;

    if (applied > 0) {
      console.log(`Database initialized: applied ${applied} migration(s)`);
    }
  }
}
