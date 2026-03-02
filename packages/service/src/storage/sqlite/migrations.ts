import type { SqliteConnection } from './connection.js';

/**
 * Schema version tracking and migration system
 * Allows evolving the database schema over time without breaking existing data
 */

export interface Migration {
  version: number;
  name: string;
  up: string;  // SQL to apply migration
  down?: string;  // SQL to rollback migration (optional)
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
];

/**
 * Schema migration manager
 */
export class MigrationManager {
  constructor(private db: SqliteConnection) {}
  
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
    return MIGRATIONS.length > 0
      ? Math.max(...MIGRATIONS.map(m => m.version))
      : 0;
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
    return MIGRATIONS.filter(m => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);
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
      await this.db.run(
        'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
        [migration.version, now]
      );
      
      await this.db.run('COMMIT');
      
      console.log(`Applied migration v${migration.version}: ${migration.name}`);
    } catch (error) {
      await this.db.run('ROLLBACK');
      throw error;
    }
  }
  
  /**
   * Initialize the database (run all migrations if needed)
   */
  async initialize(): Promise<void> {
    const applied = await this.migrate();
    
    if (applied > 0) {
      console.log(`Database initialized: applied ${applied} migration(s)`);
    } else {
      const version = await this.getCurrentVersion();
      console.log(`Database already at latest version: v${version}`);
    }
  }
}
