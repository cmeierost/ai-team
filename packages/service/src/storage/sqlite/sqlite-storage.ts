import type { ChatMessage, ChatSession } from '@ai-team/infrastructure';
import type {
  IMessageStorage,
  MessageFilter,
  SessionFilter,
  StorageStats,
  MessageInsertResult,
  Note,
  SessionSkill,
} from '../contracts.js';
import { SqliteConnection } from './connection.js';
import { MigrationManager } from './migrations.js';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

/**
 * SQLite-based implementation of message storage
 * Stores messages and sessions in a local SQLite database
 */
export class SqliteMessageStorage implements IMessageStorage {
  private readonly connection: SqliteConnection;
  private readonly migrations: MigrationManager;
  private ready = false;

  constructor(workspaceRoot: string) {
    this.connection = new SqliteConnection(workspaceRoot);
    this.migrations = new MigrationManager(this.connection);
  }

  // ========== Lifecycle ==========

  private async getConnection(): Promise<SqliteConnection> {
    if (!this.ready) {
      await this.connection.open();
      this.ready = true;
    }
    return this.connection;
  }

  /**
   * Run pending schema migrations.
   * Call explicitly during upgrade flows — not on every connection.
   */
  async migrate(): Promise<number> {
    await this.getConnection();
    return this.migrations.migrate();
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  // ========== Messages ==========

  async insertMessage(sessionId: string, message: ChatMessage): Promise<MessageInsertResult> {
    await this.getConnection();
    const timestamp = message.timestamp || new Date().toISOString();

    // Start transaction
    const statements: Array<{ sql: string; params?: any[] }> = [];

    // Insert message
    const messageResult = await this.connection.run(
      `INSERT INTO messages (session_id, timestamp, from_id, to_id, is_human, content, archived, handoff_type, target_agent_id, handoff_from_session_id, handoff_to_session_id, handoff_id, importance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        timestamp,
        message.from,
        message.to || null,
        message.isHuman ? 1 : 0,
        message.content,
        message.archived ? 1 : 0,
        message.handoffType || null,
        message.targetAgentId || null,
        message.handoffFromSessionId || null,
        message.handoffToSessionId || null,
        message.handoffId || null,
        message.importance || null,
      ]
    );

    const messageId = messageResult.lastID;

    // Insert context files
    if (message.context && message.context.length > 0) {
      for (const filePath of message.context) {
        statements.push({
          sql: 'INSERT INTO message_files (message_id, file_path) VALUES (?, ?)',
          params: [messageId, filePath],
        });
      }
    }

    // Insert tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        statements.push({
          sql: 'INSERT INTO message_tool_calls (message_id, tool_name, params_json, result_json, result_llm_json) VALUES (?, ?, ?, ?, ?)',
          params: [
            messageId,
            toolCall.tool,
            JSON.stringify(toolCall.params),
            toolCall.result !== undefined ? JSON.stringify(toolCall.result) : null,
            toolCall.resultLlm !== undefined ? JSON.stringify(toolCall.resultLlm) : null,
          ],
        });
      }
    }

    // Insert code suggestions
    if (message.suggestions && message.suggestions.length > 0) {
      for (const suggestion of message.suggestions) {
        statements.push({
          sql: 'INSERT INTO message_suggestions (message_id, suggestion_type, file_path, line_number, description, code) VALUES (?, ?, ?, ?, ?, ?)',
          params: [
            messageId,
            suggestion.type,
            suggestion.file,
            suggestion.line || null,
            suggestion.description,
            suggestion.code || null,
          ],
        });
      }
    }

    // Update session message count and last activity
    statements.push({
      sql: `UPDATE sessions 
            SET message_count = message_count + 1,
                last_activity_at = ?,
                updated_at = ?
            WHERE id = ?`,
      params: [timestamp, timestamp, sessionId],
    });

    // Execute all statements in transaction
    if (statements.length > 0) {
      await this.connection.transaction(statements);
    }

    return {
      messageId,
      timestamp,
    };
  }

  async getSessionMessages(
    sessionId: string,
    includeArchived: boolean = false
  ): Promise<ChatMessage[]> {
    await this.getConnection();
    const sql = `
      SELECT 
        m.id,
        m.timestamp,
        m.from_id,
        m.to_id,
        m.is_human,
        m.content,
        m.archived,
        m.handoff_type,
        m.target_agent_id,
        m.handoff_from_session_id,
        m.handoff_to_session_id,
        m.handoff_id,
        m.importance
      FROM messages m
      WHERE m.session_id = ?
        ${!includeArchived ? 'AND m.archived = 0' : ''}
      ORDER BY m.timestamp ASC
    `;

    const rows = await this.connection.all<any>(sql, [sessionId]);
    return this.rowsToMessages(rows);
  }

  async queryMessages(filter: MessageFilter): Promise<ChatMessage[]> {
    await this.getConnection();
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.sessionId) {
      conditions.push('m.session_id = ?');
      params.push(filter.sessionId);
    }

    if (filter.fromId) {
      conditions.push('m.from_id = ?');
      params.push(filter.fromId);
    }

    if (filter.toId) {
      conditions.push('m.to_id = ?');
      params.push(filter.toId);
    }

    if (filter.isHuman !== undefined) {
      conditions.push('m.is_human = ?');
      params.push(filter.isHuman ? 1 : 0);
    }

    if (filter.archived !== undefined) {
      conditions.push('m.archived = ?');
      params.push(filter.archived ? 1 : 0);
    }

    if (filter.handoffType) {
      conditions.push('m.handoff_type = ?');
      params.push(filter.handoffType);
    }

    if (filter.timestampFrom) {
      conditions.push('m.timestamp >= ?');
      params.push(filter.timestampFrom);
    }

    if (filter.timestampTo) {
      conditions.push('m.timestamp <= ?');
      params.push(filter.timestampTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = filter.limit ? `LIMIT ${filter.limit}` : '';
    const offsetClause = filter.offset ? `OFFSET ${filter.offset}` : '';

    const sql = `
      SELECT 
        m.id,
        m.timestamp,
        m.from_id,
        m.to_id,
        m.is_human,
        m.content,
        m.archived,
        m.handoff_type,
        m.target_agent_id,
        m.handoff_from_session_id,
        m.handoff_to_session_id,
        m.handoff_id,
        m.importance
      FROM messages m
      ${whereClause}
      ORDER BY m.timestamp ASC
      ${limitClause} ${offsetClause}
    `;

    const rows = await this.connection.all<any>(sql, params);
    return this.rowsToMessages(rows);
  }

  async archiveMessage(sessionId: string, messageTimestamp: string): Promise<boolean> {
    await this.getConnection();
    const result = await this.connection.run(
      'UPDATE messages SET archived = 1 WHERE session_id = ? AND timestamp = ?',
      [sessionId, messageTimestamp]
    );
    return result.changes > 0;
  }

  async deleteMessage(sessionId: string, messageTimestamp: string): Promise<boolean> {
    await this.getConnection();
    // Get message ID first
    const row = await this.connection.get<{ id: number }>(
      'SELECT id FROM messages WHERE session_id = ? AND timestamp = ?',
      [sessionId, messageTimestamp]
    );

    if (!row) {
      return false;
    }

    // Delete message (CASCADE will delete related rows)
    await this.connection.transaction([
      {
        sql: 'DELETE FROM messages WHERE id = ?',
        params: [row.id],
      },
      {
        sql: 'UPDATE sessions SET message_count = message_count - 1, updated_at = ? WHERE id = ?',
        params: [new Date().toISOString(), sessionId],
      },
    ]);

    return true;
  }

  async searchMessages(query: string, sessionId?: string): Promise<ChatMessage[]> {
    await this.getConnection();
    // Use FTS5 for full-text search with relevance ranking
    const conditions = ['messages_fts MATCH ?'];
    const params: any[] = [query];

    if (sessionId) {
      conditions.push('messages_fts.session_id = ?');
      params.push(sessionId);
    }

    const sql = `
      SELECT 
        m.id,
        m.timestamp,
        m.from_id,
        m.to_id,
        m.is_human,
        m.content,
        m.archived,
        m.handoff_type,
        m.target_agent_id,
        m.handoff_from_session_id,
        m.handoff_to_session_id,
        m.handoff_id,
        m.importance,
        messages_fts.rank
      FROM messages m
      INNER JOIN messages_fts ON messages_fts.message_id = m.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY messages_fts.rank, m.timestamp DESC
      LIMIT 100
    `;

    const rows = await this.connection.all<any>(sql, params);
    return this.rowsToMessages(rows);
  }

  // ========== Sessions ==========

  async createSession(session: Omit<ChatSession, 'id' | 'messageCount'>): Promise<ChatSession> {
    await this.getConnection();
    const now = new Date().toISOString();
    const id = session.startedAt
      ? `session-${session.startedAt.split('T')[0]}-${Math.random().toString(36).substring(2, 8)}`
      : `session-${now.split('T')[0]}-${Math.random().toString(36).substring(2, 8)}`;

    const statements: Array<{ sql: string; params?: any[] }> = [];

    // Insert session
    statements.push({
      sql: `INSERT INTO sessions (
        id, developer_id, started_at, last_activity_at, message_count,
        title, notes, previous_session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      params: [
        id,
        session.developerId,
        session.startedAt || now,
        session.lastActivityAt || now,
        session.title || null,
        session.notes || null,
        session.previousSessionId || null,
        now,
        now,
      ],
    });

    // Insert agent associations
    for (const agentId of session.agentIds) {
      statements.push({
        sql: 'INSERT INTO session_agents (session_id, agent_id) VALUES (?, ?)',
        params: [id, agentId],
      });
    }

    // Insert artifacts
    if (session.artifacts && session.artifacts.length > 0) {
      for (const artifact of session.artifacts) {
        statements.push({
          sql: 'INSERT INTO session_artifacts (session_id, artifact_path) VALUES (?, ?)',
          params: [id, artifact],
        });
      }
    }

    // Insert allowed files
    if (session.allowedFiles && session.allowedFiles.length > 0) {
      for (const filePath of session.allowedFiles) {
        statements.push({
          sql: 'INSERT INTO session_files (session_id, file_path, is_prioritized) VALUES (?, ?, ?)',
          params: [id, filePath, session.prioritizedFiles?.includes(filePath) ? 1 : 0],
        });
      }
    }

    // Insert tasks
    if (session.tasks && session.tasks.length > 0) {
      for (const taskId of session.tasks) {
        statements.push({
          sql: 'INSERT INTO session_tasks (session_id, task_id) VALUES (?, ?)',
          params: [id, taskId],
        });
      }
    }

    // Insert merged from sessions
    if (session.mergedFromSessionIds && session.mergedFromSessionIds.length > 0) {
      for (const mergedId of session.mergedFromSessionIds) {
        statements.push({
          sql: 'INSERT INTO session_merged_from (session_id, merged_session_id) VALUES (?, ?)',
          params: [id, mergedId],
        });
      }
    }

    // Insert RAG config
    if (session.ragConfig) {
      statements.push({
        sql: 'INSERT INTO session_rag_config (session_id, config_json) VALUES (?, ?)',
        params: [id, JSON.stringify(session.ragConfig)],
      });
    }

    await this.connection.transaction(statements);

    return {
      id,
      ...session,
      messageCount: 0,
    };
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    await this.getConnection();
    const row = await this.connection.get<any>(
      `SELECT 
        id, developer_id, started_at, last_activity_at, message_count,
        title, notes, previous_session_id, created_at, updated_at
       FROM sessions
       WHERE id = ?`,
      [sessionId]
    );

    if (!row) {
      return null;
    }

    return this.rowToSession(row);
  }

  async updateSession(
    sessionId: string,
    updates: Partial<Omit<ChatSession, 'id' | 'messageCount'>>
  ): Promise<void> {
    await this.getConnection();
    const now = new Date().toISOString();
    const statements: Array<{ sql: string; params?: any[] }> = [];

    // Build UPDATE statement for main session fields
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      params.push(updates.title);
    }

    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      params.push(updates.notes);
    }

    if (updates.lastActivityAt) {
      fields.push('last_activity_at = ?');
      params.push(updates.lastActivityAt);
    }

    if (updates.previousSessionId !== undefined) {
      fields.push('previous_session_id = ?');
      params.push(updates.previousSessionId);
    }

    fields.push('updated_at = ?');
    params.push(now);

    if (fields.length > 0) {
      params.push(sessionId);
      statements.push({
        sql: `UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`,
        params,
      });
    }

    // Handle artifacts update
    if (updates.artifacts !== undefined) {
      statements.push({
        sql: 'DELETE FROM session_artifacts WHERE session_id = ?',
        params: [sessionId],
      });
      for (const artifact of updates.artifacts) {
        statements.push({
          sql: 'INSERT INTO session_artifacts (session_id, artifact_path) VALUES (?, ?)',
          params: [sessionId, artifact],
        });
      }
    }

    // Handle files update
    if (updates.allowedFiles !== undefined || updates.prioritizedFiles !== undefined) {
      statements.push({
        sql: 'DELETE FROM session_files WHERE session_id = ?',
        params: [sessionId],
      });
      const allowedFiles = updates.allowedFiles || [];
      const prioritizedFiles = updates.prioritizedFiles || [];
      for (const filePath of allowedFiles) {
        statements.push({
          sql: 'INSERT INTO session_files (session_id, file_path, is_prioritized) VALUES (?, ?, ?)',
          params: [sessionId, filePath, prioritizedFiles.includes(filePath) ? 1 : 0],
        });
      }
    }

    // Handle tasks update
    if (updates.tasks !== undefined) {
      statements.push({
        sql: 'DELETE FROM session_tasks WHERE session_id = ?',
        params: [sessionId],
      });
      for (const taskId of updates.tasks) {
        statements.push({
          sql: 'INSERT INTO session_tasks (session_id, task_id) VALUES (?, ?)',
          params: [sessionId, taskId],
        });
      }
    }

    // Handle RAG config update
    if (updates.ragConfig !== undefined) {
      statements.push({
        sql: 'DELETE FROM session_rag_config WHERE session_id = ?',
        params: [sessionId],
      });
      if (updates.ragConfig) {
        statements.push({
          sql: 'INSERT INTO session_rag_config (session_id, config_json) VALUES (?, ?)',
          params: [sessionId, JSON.stringify(updates.ragConfig)],
        });
      }
    }

    // Handle merged sessions tracking
    if (updates.mergedFromSessionIds !== undefined) {
      statements.push({
        sql: 'DELETE FROM session_merged_from WHERE session_id = ?',
        params: [sessionId],
      });
      for (const mergedId of updates.mergedFromSessionIds) {
        statements.push({
          sql: 'INSERT INTO session_merged_from (session_id, merged_session_id) VALUES (?, ?)',
          params: [sessionId, mergedId],
        });
      }
    }

    if (statements.length > 0) {
      await this.connection.transaction(statements);
    }
  }

  async listSessions(filter?: SessionFilter): Promise<ChatSession[]> {
    await this.getConnection();
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.developerId) {
      conditions.push('s.developer_id = ?');
      params.push(filter.developerId);
    }

    if (filter?.agentId) {
      conditions.push(
        'EXISTS (SELECT 1 FROM session_agents sa WHERE sa.session_id = s.id AND sa.agent_id = ?)'
      );
      params.push(filter.agentId);
    }

    if (filter?.hasAgents && filter.hasAgents.length > 0) {
      for (const agentId of filter.hasAgents) {
        conditions.push(
          'EXISTS (SELECT 1 FROM session_agents sa WHERE sa.session_id = s.id AND sa.agent_id = ?)'
        );
        params.push(agentId);
      }
    }

    if (filter?.timestampFrom) {
      conditions.push('s.started_at >= ?');
      params.push(filter.timestampFrom);
    }

    if (filter?.timestampTo) {
      conditions.push('s.started_at <= ?');
      params.push(filter.timestampTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortBy = filter?.sortBy || 'lastActivityAt';
    const sortOrder = filter?.sortOrder || 'desc';
    const orderByColumn =
      sortBy === 'lastActivityAt'
        ? 'last_activity_at'
        : sortBy === 'startedAt'
          ? 'started_at'
          : 'message_count';
    const orderClause = `ORDER BY s.${orderByColumn} ${sortOrder.toUpperCase()}`;
    const limitClause = filter?.limit ? `LIMIT ${filter.limit}` : '';
    const offsetClause = filter?.offset ? `OFFSET ${filter.offset}` : '';

    const sql = `
      SELECT 
        s.id, s.developer_id, s.started_at, s.last_activity_at, s.message_count,
        s.title, s.notes, s.previous_session_id, s.created_at, s.updated_at
      FROM sessions s
      ${whereClause}
      ${orderClause}
      ${limitClause} ${offsetClause}
    `;

    const rows = await this.connection.all<any>(sql, params);

    const sessions: ChatSession[] = [];
    for (const row of rows) {
      const session = await this.rowToSession(row);
      sessions.push(session);
    }

    return sessions;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.getConnection();
    // NULL-out cross-session references before deleting so linked sessions/messages
    // don't hold dangling IDs. These columns have no FK ON DELETE SET NULL because
    // they were added via ALTER TABLE (SQLite limitation).
    await this.connection.run(
      'UPDATE sessions SET previous_session_id = NULL WHERE previous_session_id = ?',
      [sessionId]
    );
    await this.connection.run(
      'UPDATE messages SET handoff_from_session_id = NULL WHERE handoff_from_session_id = ?',
      [sessionId]
    );
    await this.connection.run(
      'UPDATE messages SET handoff_to_session_id = NULL WHERE handoff_to_session_id = ?',
      [sessionId]
    );
    const result = await this.connection.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return result.changes > 0;
  }

  async addSessionAgent(sessionId: string, agentId: string): Promise<void> {
    await this.getConnection();
    await this.connection.run(
      'INSERT OR IGNORE INTO session_agents (session_id, agent_id) VALUES (?, ?)',
      [sessionId, agentId]
    );
  }

  async removeSessionAgent(sessionId: string, agentId: string): Promise<void> {
    await this.getConnection();
    await this.connection.run('DELETE FROM session_agents WHERE session_id = ? AND agent_id = ?', [
      sessionId,
      agentId,
    ]);
  }

  // ========== Statistics ==========

  async getStats(): Promise<StorageStats> {
    await this.getConnection();
    const sessionCount = await this.connection.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM sessions'
    );

    const messageCount = await this.connection.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM messages'
    );

    const version = await this.migrations.getCurrentVersion();

    let storageSize: number | undefined;
    try {
      const dbPath = this.connection.getPath();
      const stats = await fs.stat(dbPath);
      storageSize = stats.size;
    } catch {
      // File doesn't exist or can't be accessed
      storageSize = undefined;
    }

    return {
      totalSessions: sessionCount?.count || 0,
      totalMessages: messageCount?.count || 0,
      storageSize,
      schemaVersion: version,
    };
  }

  // ========== Helper Methods ==========

  /**
   * Convert a database row to a ChatMessage with all related data
   */
  private async rowToMessage(row: any): Promise<ChatMessage> {
    const messageId = row.id;

    // Load context files
    const contextRows = await this.connection.all<{ file_path: string }>(
      'SELECT file_path FROM message_files WHERE message_id = ?',
      [messageId]
    );
    const context = contextRows.map((r) => r.file_path);

    // Load tool calls
    const toolCallRows = await this.connection.all<any>(
      'SELECT id, tool_name, params_json, result_json, result_llm_json FROM message_tool_calls WHERE message_id = ?',
      [messageId]
    );
    const tool_calls = toolCallRows.map((r) => ({
      id: r.id as number,
      tool: r.tool_name,
      params: JSON.parse(r.params_json),
      result: r.result_json ? JSON.parse(r.result_json) : undefined,
      resultLlm: r.result_llm_json ? JSON.parse(r.result_llm_json) : undefined,
    }));

    // Load suggestions
    const suggestionRows = await this.connection.all<any>(
      'SELECT suggestion_type, file_path, line_number, description, code FROM message_suggestions WHERE message_id = ?',
      [messageId]
    );
    const suggestions = suggestionRows.map((r) => ({
      type: r.suggestion_type as any,
      file: r.file_path,
      line: r.line_number || undefined,
      description: r.description,
      code: r.code || undefined,
    }));

    return {
      timestamp: row.timestamp,
      from: row.from_id,
      to: row.to_id || undefined,
      isHuman: row.is_human === 1,
      content: row.content,
      context: context.length > 0 ? context : undefined,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      archived: row.archived === 1 || undefined,
      handoffType: row.handoff_type || undefined,
      targetAgentId: row.target_agent_id || undefined,
      handoffFromSessionId: row.handoff_from_session_id || undefined,
      handoffToSessionId: row.handoff_to_session_id || undefined,
      handoffId: row.handoff_id || undefined,
      importance: (row.importance as 'low' | 'normal' | 'high' | null) || undefined,
    };
  }

  /**
   * Convert multiple database rows to ChatMessage objects using batched lookups
   * for related tables to avoid N+1 queries on large histories.
   */
  private async rowsToMessages(rows: any[]): Promise<ChatMessage[]> {
    if (rows.length === 0) {
      return [];
    }

    const messageIds = rows.map((row) => row.id as number);
    const placeholders = messageIds.map(() => '?').join(', ');

    const [contextRows, toolCallRows, suggestionRows] = await Promise.all([
      this.connection.all<{ message_id: number; file_path: string }>(
        `SELECT message_id, file_path FROM message_files WHERE message_id IN (${placeholders})`,
        messageIds
      ),
      this.connection.all<{
        id: number;
        message_id: number;
        tool_name: string;
        params_json: string;
        result_json: string | null;
        result_llm_json: string | null;
      }>(
        `SELECT id, message_id, tool_name, params_json, result_json, result_llm_json
         FROM message_tool_calls
         WHERE message_id IN (${placeholders})`,
        messageIds
      ),
      this.connection.all<{
        message_id: number;
        suggestion_type: string;
        file_path: string;
        line_number: number | null;
        description: string;
        code: string | null;
      }>(
        `SELECT message_id, suggestion_type, file_path, line_number, description, code
         FROM message_suggestions
         WHERE message_id IN (${placeholders})`,
        messageIds
      ),
    ]);

    const contextByMessage = new Map<number, string[]>();
    for (const row of contextRows) {
      const existing = contextByMessage.get(row.message_id);
      if (existing) {
        existing.push(row.file_path);
      } else {
        contextByMessage.set(row.message_id, [row.file_path]);
      }
    }

    const toolCallsByMessage = new Map<
      number,
      Array<{ id: number; tool: string; params: unknown; result?: unknown; resultLlm?: unknown }>
    >();
    for (const row of toolCallRows) {
      const parsed = {
        id: row.id,
        tool: row.tool_name,
        params: JSON.parse(row.params_json),
        result: row.result_json ? JSON.parse(row.result_json) : undefined,
        resultLlm: row.result_llm_json ? JSON.parse(row.result_llm_json) : undefined,
      };
      const existing = toolCallsByMessage.get(row.message_id);
      if (existing) {
        existing.push(parsed);
      } else {
        toolCallsByMessage.set(row.message_id, [parsed]);
      }
    }

    const suggestionsByMessage = new Map<
      number,
      Array<{ type: any; file: string; line?: number; description: string; code?: string }>
    >();
    for (const row of suggestionRows) {
      const parsed = {
        type: row.suggestion_type as any,
        file: row.file_path,
        line: row.line_number || undefined,
        description: row.description,
        code: row.code || undefined,
      };
      const existing = suggestionsByMessage.get(row.message_id);
      if (existing) {
        existing.push(parsed);
      } else {
        suggestionsByMessage.set(row.message_id, [parsed]);
      }
    }

    return rows.map((row) => {
      const messageId = row.id as number;
      const context = contextByMessage.get(messageId);
      const tool_calls = toolCallsByMessage.get(messageId);
      const suggestions = suggestionsByMessage.get(messageId);

      return {
        timestamp: row.timestamp,
        from: row.from_id,
        to: row.to_id || undefined,
        isHuman: row.is_human === 1,
        content: row.content,
        context: context && context.length > 0 ? context : undefined,
        tool_calls: tool_calls && tool_calls.length > 0 ? tool_calls : undefined,
        suggestions: suggestions && suggestions.length > 0 ? suggestions : undefined,
        archived: row.archived === 1 || undefined,
        handoffType: row.handoff_type || undefined,
        targetAgentId: row.target_agent_id || undefined,
        handoffFromSessionId: row.handoff_from_session_id || undefined,
        handoffToSessionId: row.handoff_to_session_id || undefined,
        handoffId: row.handoff_id || undefined,
        importance: (row.importance as 'low' | 'normal' | 'high' | null) || undefined,
      } as ChatMessage;
    });
  }

  /**
   * Convert a database row to a ChatSession with all related data
   */
  private async rowToSession(row: any): Promise<ChatSession> {
    const sessionId = row.id;

    // Load agent IDs
    const agentRows = await this.connection.all<{ agent_id: string }>(
      'SELECT agent_id FROM session_agents WHERE session_id = ?',
      [sessionId]
    );
    const agentIds = agentRows.map((r) => r.agent_id);

    // Load artifacts
    const artifactRows = await this.connection.all<{ artifact_path: string }>(
      'SELECT artifact_path FROM session_artifacts WHERE session_id = ?',
      [sessionId]
    );
    const artifacts = artifactRows.map((r) => r.artifact_path);

    // Load files
    const fileRows = await this.connection.all<{ file_path: string; is_prioritized: number }>(
      'SELECT file_path, is_prioritized FROM session_files WHERE session_id = ?',
      [sessionId]
    );
    const allowedFiles = fileRows.map((r) => r.file_path);
    const prioritizedFiles = fileRows.filter((r) => r.is_prioritized === 1).map((r) => r.file_path);

    // Load tasks
    const taskRows = await this.connection.all<{ task_id: string }>(
      'SELECT task_id FROM session_tasks WHERE session_id = ?',
      [sessionId]
    );
    const tasks = taskRows.map((r) => r.task_id);

    // Load merged from sessions
    const mergedRows = await this.connection.all<{ merged_session_id: string }>(
      'SELECT merged_session_id FROM session_merged_from WHERE session_id = ?',
      [sessionId]
    );
    const mergedFromSessionIds = mergedRows.map((r) => r.merged_session_id);

    // Load RAG config
    const ragRow = await this.connection.get<{ config_json: string }>(
      'SELECT config_json FROM session_rag_config WHERE session_id = ?',
      [sessionId]
    );
    const ragConfig = ragRow ? JSON.parse(ragRow.config_json) : undefined;

    return {
      id: sessionId,
      agentIds,
      agentId: agentIds[0] || '', // Backward compatibility
      developerId: row.developer_id,
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      messageCount: row.message_count,
      title: row.title || undefined,
      artifacts,
      allowedFiles,
      prioritizedFiles: prioritizedFiles.length > 0 ? prioritizedFiles : undefined,
      tasks: tasks.length > 0 ? tasks : undefined,
      notes: row.notes || undefined,
      ragConfig,
      previousSessionId: row.previous_session_id || undefined,
      mergedFromSessionIds: mergedFromSessionIds.length > 0 ? mergedFromSessionIds : undefined,
    };
  }

  // ========== Notes ==========

  async createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note> {
    await this.getConnection();
    const id = randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    const tagsJson = note.tags ? JSON.stringify(note.tags) : null;

    await this.connection.run(
      `INSERT INTO notes (id, agent_id, title, content, tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, note.agentId, note.title || null, note.content, tagsJson, now, now]
    );

    return {
      id,
      agentId: note.agentId,
      title: note.title,
      content: note.content,
      tags: note.tags,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getNote(noteId: string): Promise<Note | null> {
    await this.getConnection();
    const row = await this.connection.get<any>(
      'SELECT id, agent_id, title, content, tags_json, created_at, updated_at FROM notes WHERE id = ?',
      [noteId]
    );

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title || undefined,
      content: row.content,
      tags: row.tags_json ? JSON.parse(row.tags_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listAgentNotes(agentId: string): Promise<Note[]> {
    await this.getConnection();
    const rows = await this.connection.all<any>(
      'SELECT id, agent_id, title, content, tags_json, created_at, updated_at FROM notes WHERE agent_id = ? ORDER BY created_at DESC',
      [agentId]
    );

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title || undefined,
      content: row.content,
      tags: row.tags_json ? JSON.parse(row.tags_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async updateNote(
    noteId: string,
    updates: Partial<Omit<Note, 'id' | 'agentId' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    await this.getConnection();
    const now = new Date().toISOString();
    const setParts: string[] = [];
    const params: any[] = [];

    if (updates.title !== undefined) {
      setParts.push('title = ?');
      params.push(updates.title || null);
    }

    if (updates.content !== undefined) {
      setParts.push('content = ?');
      params.push(updates.content);
    }

    if (updates.tags !== undefined) {
      setParts.push('tags_json = ?');
      params.push(updates.tags ? JSON.stringify(updates.tags) : null);
    }

    if (setParts.length === 0) {
      return; // No updates
    }

    setParts.push('updated_at = ?');
    params.push(now);

    params.push(noteId);

    await this.connection.run(`UPDATE notes SET ${setParts.join(', ')} WHERE id = ?`, params);
  }

  async deleteNote(noteId: string): Promise<boolean> {
    await this.getConnection();
    const result = await this.connection.run('DELETE FROM notes WHERE id = ?', [noteId]);
    return (result.changes || 0) > 0;
  }

  async searchNotes(query: string, agentId?: string): Promise<Note[]> {
    await this.getConnection();
    // Use FTS5 for full-text search with Porter stemming and relevance ranking
    const conditions = ['notes_fts MATCH ?'];
    const params: any[] = [query];

    if (agentId) {
      conditions.push('notes_fts.agent_id = ?');
      params.push(agentId);
    }

    const sql = `
      SELECT 
        n.id,
        n.agent_id,
        n.title,
        n.content,
        n.tags_json,
        n.created_at,
        n.updated_at,
        notes_fts.rank
      FROM notes n
      INNER JOIN notes_fts ON notes_fts.note_id = n.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY notes_fts.rank, n.created_at DESC
      LIMIT 100
    `;

    const rows = await this.connection.all<any>(sql, params);

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title || undefined,
      content: row.content,
      tags: row.tags_json ? JSON.parse(row.tags_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // ========== Session Skills ==========

  async addSessionSkill(sessionId: string, skillPath: string): Promise<void> {
    await this.getConnection();
    const now = new Date().toISOString();
    await this.connection.run(
      `INSERT INTO session_skills (session_id, skill_path, loaded_at, paused)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(session_id, skill_path) DO UPDATE SET loaded_at = excluded.loaded_at`,
      [sessionId, skillPath, now]
    );
  }

  async getSessionSkills(sessionId: string): Promise<SessionSkill[]> {
    await this.getConnection();
    const rows = await this.connection.all<{
      skill_path: string;
      loaded_at: string;
      paused: number;
    }>(
      'SELECT skill_path, loaded_at, paused FROM session_skills WHERE session_id = ? ORDER BY loaded_at ASC',
      [sessionId]
    );
    return rows.map((r) => ({
      sessionId,
      skillPath: r.skill_path,
      loadedAt: r.loaded_at,
      paused: r.paused === 1,
    }));
  }

  async setSessionSkillPaused(
    sessionId: string,
    skillPath: string,
    paused: boolean
  ): Promise<void> {
    await this.getConnection();
    await this.connection.run(
      'UPDATE session_skills SET paused = ? WHERE session_id = ? AND skill_path = ?',
      [paused ? 1 : 0, sessionId, skillPath]
    );
  }

  async removeSessionSkill(sessionId: string, skillPath: string): Promise<void> {
    await this.getConnection();
    await this.connection.run(
      'DELETE FROM session_skills WHERE session_id = ? AND skill_path = ?',
      [sessionId, skillPath]
    );
  }

  async updateToolCallLlmResult(toolCallId: number, newText: string): Promise<void> {
    await this.getConnection();
    await this.connection.run('UPDATE message_tool_calls SET result_llm_json = ? WHERE id = ?', [
      JSON.stringify(newText),
      toolCallId,
    ]);
  }
}
