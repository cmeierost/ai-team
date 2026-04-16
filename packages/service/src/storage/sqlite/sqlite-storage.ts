import type { ChatMessage, ChatSession } from '@ai-team/infrastructure';
import type {
  IMessageStorage,
  IPlanningStorage,
  MessageFilter,
  SessionFilter,
  StorageStats,
  MessageInsertResult,
  Note,
  NoteAttachment,
  NoteAttachmentInput,
  NoteAttachmentUpdateInput,
  NoteCreateInput,
  NoteUpdateInput,
  RetainedNoteAttachmentInput,
  MessageSessionLink,
  SessionDeleteImpact,
  SessionDeleteOptions,
  SessionSkill,
  PlanningIntakeFilter,
  PlanningPlanFilter,
  PlanningTaskFilter,
} from '../contracts.js';
import type {
  PlanningIntakeItem,
  PlanningPlan,
  PlanningPlanSessionVisibility,
  PlanningTask,
  PlanningTaskDelegation,
  PlanningTodo,
} from '@ai-team/core';
import { SqliteConnection } from './connection.js';
import { MigrationManager } from './migrations.js';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * SQLite-based implementation of message storage
 * Stores messages and sessions in a local SQLite database
 */
export class SqliteMessageStorage implements IMessageStorage, IPlanningStorage {
  private readonly connection: SqliteConnection;
  private readonly migrations: MigrationManager;
  private readonly workspaceRoot: string;
  private readonly noteAttachmentsDir: string;
  private ready = false;
  private initPromise: Promise<SqliteConnection> | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.noteAttachmentsDir = path.join(workspaceRoot, '.ai-team', 'private', 'note-attachments');
    this.connection = new SqliteConnection(workspaceRoot);
    this.migrations = new MigrationManager(this.connection);
  }

  private async ensureNoteAttachmentsDir(): Promise<void> {
    await fs.mkdir(this.noteAttachmentsDir, { recursive: true });
  }

  private sanitizeAttachmentName(fileName: string): string {
    const base = path.basename(fileName || 'attachment');
    return base.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  }

  private async writeAttachmentAsync(
    noteId: string,
    attachment: NoteAttachmentInput,
    attachmentId: string
  ): Promise<NoteAttachment> {
    await this.ensureNoteAttachmentsDir();
    const safeName = this.sanitizeAttachmentName(attachment.fileName);
    const storedName = `${noteId}-${attachmentId}-${safeName}`;
    const absolutePath = path.join(this.noteAttachmentsDir, storedName);
    const buffer = Buffer.from(attachment.contentBase64, 'base64');
    await fs.writeFile(absolutePath, buffer);
    return {
      id: attachmentId,
      fileName: attachment.fileName,
      filePath: path.relative(this.workspaceRoot, absolutePath),
      contentType: attachment.contentType || undefined,
      sizeBytes: attachment.sizeBytes ?? buffer.byteLength,
      description: attachment.description || undefined,
    };
  }

  private toLegacyAttachment(row: any): NoteAttachment | undefined {
    if (!row.attachment_path) {
      return undefined;
    }

    return {
      id: `${row.id}-legacy-0`,
      fileName: row.attachment_name,
      filePath: row.attachment_path,
      contentType: row.attachment_content_type || undefined,
      sizeBytes: row.attachment_size_bytes || 0,
      description: row.attachment_description || undefined,
    };
  }

  private async deleteAttachmentFilesAsync(attachments: NoteAttachment[]): Promise<void> {
    await Promise.all(
      attachments
        .filter((attachment) => attachment.filePath)
        .map(async (attachment) => {
          const absolutePath = path.join(this.workspaceRoot, attachment.filePath);
          await fs.rm(absolutePath, { force: true });
        })
    );
  }

  private async deleteAttachmentsIfPresent(note: Note | null): Promise<void> {
    const attachments = note?.attachments ?? (note?.attachment ? [note.attachment] : []);
    if (attachments.length === 0) {
      return;
    }

    await this.deleteAttachmentFilesAsync(attachments);
  }

  private async listNoteAttachmentsByNoteIdsAsync(
    noteIds: string[]
  ): Promise<Map<string, NoteAttachment[]>> {
    const byNoteId = new Map<string, NoteAttachment[]>();
    if (noteIds.length === 0) {
      return byNoteId;
    }

    const placeholders = noteIds.map(() => '?').join(', ');
    const rows = await this.connection.all<{
      id: string;
      note_id: string;
      file_name: string;
      file_path: string;
      content_type: string | null;
      size_bytes: number;
      description: string | null;
      sort_order: number;
    }>(
      `SELECT id, note_id, file_name, file_path, content_type, size_bytes, description, sort_order
         FROM note_attachments
        WHERE note_id IN (${placeholders})
        ORDER BY note_id ASC, sort_order ASC, created_at ASC`,
      noteIds
    );

    for (const row of rows) {
      const attachment: NoteAttachment = {
        id: row.id,
        fileName: row.file_name,
        filePath: row.file_path,
        contentType: row.content_type || undefined,
        sizeBytes: row.size_bytes,
        description: row.description || undefined,
      };

      const existing = byNoteId.get(row.note_id);
      if (existing) {
        existing.push(attachment);
      } else {
        byNoteId.set(row.note_id, [attachment]);
      }
    }

    return byNoteId;
  }

  private isRetainedNoteAttachmentInput(
    input: NoteAttachmentUpdateInput
  ): input is RetainedNoteAttachmentInput {
    return 'id' in input && !('contentBase64' in input);
  }

  private async resolveUpdatedAttachmentsAsync(
    noteId: string,
    existingAttachments: NoteAttachment[],
    requestedAttachments: NoteAttachmentUpdateInput[] | null
  ): Promise<NoteAttachment[]> {
    if (requestedAttachments === null) {
      return [];
    }

    const existingById = new Map(
      existingAttachments.map((attachment) => [attachment.id, attachment])
    );
    const nextAttachments: NoteAttachment[] = [];

    for (const requestedAttachment of requestedAttachments) {
      if (this.isRetainedNoteAttachmentInput(requestedAttachment)) {
        const existing = existingById.get(requestedAttachment.id);
        if (!existing) {
          throw new Error(`Cannot retain missing attachment "${requestedAttachment.id}".`);
        }
        nextAttachments.push(existing);
        continue;
      }

      const attachmentId = randomBytes(8).toString('hex');
      const storedAttachment = await this.writeAttachmentAsync(
        noteId,
        requestedAttachment,
        attachmentId
      );
      nextAttachments.push(storedAttachment);
    }

    return nextAttachments;
  }

  private rowToNote(row: any, attachments: NoteAttachment[] = []): Note {
    const normalizedAttachments =
      attachments.length > 0
        ? attachments
        : (() => {
            const legacyAttachment = this.toLegacyAttachment(row);
            return legacyAttachment ? [legacyAttachment] : [];
          })();

    return {
      id: row.id,
      agentId: row.agent_id,
      sessionId: row.session_id || undefined,
      sharedSessionIds: row.shared_session_ids
        ? (row.shared_session_ids as string).split(',').filter(Boolean)
        : undefined,
      title: row.title || undefined,
      content: row.content,
      compactedContent: row.compacted_content || undefined,
      hiddenFromLlm: row.hidden_from_llm === 1,
      showOnDashboard: row.show_on_dashboard === 1,
      tags: row.tags_json ? JSON.parse(row.tags_json) : undefined,
      attachments: normalizedAttachments.length > 0 ? normalizedAttachments : undefined,
      attachment: normalizedAttachments[0],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ========== Lifecycle ==========

  /**
   * Return a ready connection, opening it and running any pending migrations on
   * the first call.  Concurrent callers share the same init promise so the DB
   * is only opened once.
   */
  private getConnection(): Promise<SqliteConnection> {
    if (this.ready) return Promise.resolve(this.connection);
    this.initPromise ??= (async () => {
      await this.connection.open();
      await this.migrations.initialize();
      this.ready = true;
      return this.connection;
    })();
    return this.initPromise;
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

    return this.connection.runTransaction(async (run) => {
      // Insert the message row first so we can capture its auto-generated ID.
      const msgResult = await run(
        `INSERT INTO messages (session_id, timestamp, from_id, to_id, is_human, content, archived, hidden_from_llm, handoff_type, target_agent_id, handoff_from_session_id, handoff_to_session_id, handoff_id, importance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          timestamp,
          message.from,
          message.to || null,
          message.isHuman ? 1 : 0,
          message.content,
          message.archived ? 1 : 0,
          message.hiddenFromLlm ? 1 : 0,
          message.handoffType || null,
          message.targetAgentId || null,
          message.handoffFromSessionId || null,
          message.handoffToSessionId || null,
          message.handoffId || null,
          message.importance || null,
        ]
      );

      const messageId = msgResult.lastID;

      // Insert context files
      if (message.context && message.context.length > 0) {
        for (const filePath of message.context) {
          await run('INSERT INTO message_files (message_id, file_path) VALUES (?, ?)', [
            messageId,
            filePath,
          ]);
        }
      }

      // Insert tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          await run(
            'INSERT INTO message_tool_calls (message_id, tool_name, params_json, result_json, result_llm) VALUES (?, ?, ?, ?, ?)',
            [
              messageId,
              toolCall.tool,
              JSON.stringify(toolCall.params),
              toolCall.result === undefined ? null : JSON.stringify(toolCall.result),
              toolCall.resultLlm === undefined ? null : toolCall.resultLlm,
            ]
          );
        }
      }

      // Insert code suggestions
      if (message.suggestions && message.suggestions.length > 0) {
        for (const suggestion of message.suggestions) {
          await run(
            'INSERT INTO message_suggestions (message_id, suggestion_type, file_path, line_number, description, code) VALUES (?, ?, ?, ?, ?, ?)',
            [
              messageId,
              suggestion.type,
              suggestion.file,
              suggestion.line || null,
              suggestion.description,
              suggestion.code || null,
            ]
          );
        }
      }

      // Update session message count and last activity atomically with the insert.
      await run(
        `UPDATE sessions
            SET message_count = message_count + 1,
                last_activity_at = ?,
                updated_at = ?
            WHERE id = ?`,
        [timestamp, timestamp, sessionId]
      );

      return { messageId, timestamp };
    });
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
        m.hidden_from_llm,
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
        m.hidden_from_llm,
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
        m.hidden_from_llm,
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

  async getMessageById(messageId: number): Promise<ChatMessage | null> {
    await this.getConnection();
    const row = await this.connection.get<any>(
      `SELECT 
        m.id,
        m.timestamp,
        m.from_id,
        m.to_id,
        m.is_human,
        m.content,
        m.archived,
        m.hidden_from_llm,
        m.handoff_type,
        m.target_agent_id,
        m.handoff_from_session_id,
        m.handoff_to_session_id,
        m.handoff_id,
        m.importance
      FROM messages m
      WHERE m.id = ?`,
      [messageId]
    );

    if (!row) {
      return null;
    }

    return this.rowToMessage(row);
  }

  async setMessageHiddenFromLlm(messageId: number, hidden: boolean): Promise<boolean> {
    await this.getConnection();
    const result = await this.connection.run(
      'UPDATE messages SET hidden_from_llm = ? WHERE id = ?',
      [hidden ? 1 : 0, messageId]
    );
    return (result.changes || 0) > 0;
  }

  async updateMessageContent(messageId: number, newContent: string): Promise<boolean> {
    await this.getConnection();
    const result = await this.connection.run('UPDATE messages SET content = ? WHERE id = ?', [
      newContent,
      messageId,
    ]);
    return (result.changes || 0) > 0;
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

  async getSessionDeleteImpact(sessionId: string): Promise<SessionDeleteImpact> {
    await this.getConnection();

    const ownedNotes = await this.listSessionNotes(sessionId);
    const sharesByNote = new Map<string, string[]>();
    if (ownedNotes.length > 0) {
      const noteIds = ownedNotes.map((note) => note.id);
      const placeholders = noteIds.map(() => '?').join(', ');
      const shareRows = await this.connection.all<{ note_id: string; session_id: string }>(
        `SELECT note_id, session_id
           FROM note_session_shares
          WHERE note_id IN (${placeholders})
          ORDER BY created_at ASC`,
        noteIds
      );

      for (const row of shareRows) {
        const existing = sharesByNote.get(row.note_id);
        if (existing) {
          existing.push(row.session_id);
        } else {
          sharesByNote.set(row.note_id, [row.session_id]);
        }
      }
    }

    const sharedSessionCandidates = Array.from(
      new Set(
        ownedNotes.flatMap((note) =>
          (sharesByNote.get(note.id) ?? []).filter(
            (sharedSessionId) => sharedSessionId !== sessionId
          )
        )
      )
    );

    const existingSharedSessions = new Set<string>();
    if (sharedSessionCandidates.length > 0) {
      const placeholders = sharedSessionCandidates.map(() => '?').join(', ');
      const rows = await this.connection.all<{ id: string }>(
        `SELECT id FROM sessions WHERE id IN (${placeholders})`,
        sharedSessionCandidates
      );
      for (const row of rows) {
        existingSharedSessions.add(row.id);
      }
    }

    const transferableNotes: SessionDeleteImpact['transferableNotes'] = [];
    const unsharedOwnedNotes: SessionDeleteImpact['unsharedOwnedNotes'] = [];

    for (const note of ownedNotes) {
      const survivingSharedSessionIds = (sharesByNote.get(note.id) ?? []).filter(
        (sharedSessionId) => existingSharedSessions.has(sharedSessionId)
      );
      const [targetSessionId, ...remainingSharedSessionIds] = survivingSharedSessionIds;
      if (targetSessionId) {
        transferableNotes.push({
          noteId: note.id,
          title: note.title,
          targetSessionId,
          remainingSharedSessionIds,
        });
      } else {
        unsharedOwnedNotes.push({
          noteId: note.id,
          title: note.title,
        });
      }
    }

    return {
      sessionId,
      transferableNotes,
      unsharedOwnedNotes,
    };
  }

  async deleteSession(sessionId: string, options?: SessionDeleteOptions): Promise<boolean> {
    await this.getConnection();
    const impact = await this.getSessionDeleteImpact(sessionId);
    if (impact.unsharedOwnedNotes.length > 0 && !options?.deleteUnsharedOwnedNotes) {
      throw new Error(
        `Cannot delete session ${sessionId} because it owns ${impact.unsharedOwnedNotes.length} unshared note(s).`
      );
    }

    const existingSession = await this.getSession(sessionId);
    if (!existingSession) {
      return false;
    }

    const ownedNotes = await this.listSessionNotes(sessionId);
    const noteById = new Map(ownedNotes.map((note) => [note.id, note]));
    const deletedNotes = impact.unsharedOwnedNotes
      .map((entry) => noteById.get(entry.noteId) ?? null)
      .filter((note): note is Note => note !== null);
    const now = new Date().toISOString();

    await this.connection.runTransaction(async (run) => {
      for (const transfer of impact.transferableNotes) {
        await run('UPDATE notes SET session_id = ?, updated_at = ? WHERE id = ?', [
          transfer.targetSessionId,
          now,
          transfer.noteId,
        ]);
        await run('DELETE FROM note_session_shares WHERE note_id = ?', [transfer.noteId]);
        for (const sharedSessionId of transfer.remainingSharedSessionIds) {
          await run(
            'INSERT OR IGNORE INTO note_session_shares (note_id, session_id, created_at) VALUES (?, ?, ?)',
            [transfer.noteId, sharedSessionId, now]
          );
        }
      }

      if (options?.deleteUnsharedOwnedNotes) {
        for (const blockedNote of impact.unsharedOwnedNotes) {
          await run('DELETE FROM notes WHERE id = ?', [blockedNote.noteId]);
        }
      }

      await run('UPDATE sessions SET previous_session_id = NULL WHERE previous_session_id = ?', [
        sessionId,
      ]);
      await run(
        'UPDATE messages SET handoff_from_session_id = NULL WHERE handoff_from_session_id = ?',
        [sessionId]
      );
      await run(
        'UPDATE messages SET handoff_to_session_id = NULL WHERE handoff_to_session_id = ?',
        [sessionId]
      );
      await run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    });

    for (const note of deletedNotes) {
      await this.deleteAttachmentsIfPresent(note);
    }

    return true;
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
      'SELECT id, tool_name, params_json, result_json, result_llm FROM message_tool_calls WHERE message_id = ?',
      [messageId]
    );
    const tool_calls = toolCallRows.map((r) => ({
      id: r.id as number,
      tool: r.tool_name,
      params: JSON.parse(r.params_json),
      result: r.result_json ? JSON.parse(r.result_json) : undefined,
      resultLlm: r.result_llm ?? undefined,
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
      id: messageId,
      timestamp: row.timestamp,
      from: row.from_id,
      to: row.to_id || undefined,
      isHuman: row.is_human === 1,
      content: row.content,
      context: context.length > 0 ? context : undefined,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      archived: row.archived === 1 || undefined,
      hiddenFromLlm: row.hidden_from_llm === 1 || undefined,
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
        result_llm: string | null;
      }>(
        `SELECT id, message_id, tool_name, params_json, result_json, result_llm
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
      Array<{ id: number; tool: string; params: unknown; result?: unknown; resultLlm?: string }>
    >();
    for (const row of toolCallRows) {
      const parsed = {
        id: row.id,
        tool: row.tool_name,
        params: JSON.parse(row.params_json),
        result: row.result_json ? JSON.parse(row.result_json) : undefined,
        resultLlm: row.result_llm ?? undefined,
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
        id: messageId,
        timestamp: row.timestamp,
        from: row.from_id,
        to: row.to_id || undefined,
        isHuman: row.is_human === 1,
        content: row.content,
        context: context && context.length > 0 ? context : undefined,
        tool_calls: tool_calls && tool_calls.length > 0 ? tool_calls : undefined,
        suggestions: suggestions && suggestions.length > 0 ? suggestions : undefined,
        archived: row.archived === 1 || undefined,
        hiddenFromLlm: row.hidden_from_llm === 1 || undefined,
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
      notes: row.notes || undefined,
      ragConfig,
      previousSessionId: row.previous_session_id || undefined,
      mergedFromSessionIds: mergedFromSessionIds.length > 0 ? mergedFromSessionIds : undefined,
    };
  }

  // ========== Notes ==========

  async createNote(note: NoteCreateInput): Promise<Note> {
    await this.getConnection();
    const id = randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    const tagsJson = note.tags ? JSON.stringify(note.tags) : null;
    const requestedAttachments = note.attachments ?? (note.attachment ? [note.attachment] : []);
    const storedAttachments = await Promise.all(
      requestedAttachments.map(async (attachment) => {
        const attachmentId = randomBytes(8).toString('hex');
        return this.writeAttachmentAsync(id, attachment, attachmentId);
      })
    );
    const firstAttachment = storedAttachments[0];

    await this.connection.runTransaction(async (run) => {
      await run(
        `INSERT INTO notes (
          id, agent_id, session_id, title, content, tags_json,
          attachment_name, attachment_path, attachment_content_type, attachment_size_bytes, attachment_description,
          compacted_content, hidden_from_llm, show_on_dashboard,
          created_at, updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          note.agentId,
          note.sessionId || null,
          note.title || null,
          note.content ?? '',
          tagsJson,
          firstAttachment?.fileName || null,
          firstAttachment?.filePath || null,
          firstAttachment?.contentType || null,
          firstAttachment?.sizeBytes || null,
          firstAttachment?.description || null,
          null,
          note.hiddenFromLlm ? 1 : 0,
          note.showOnDashboard ? 1 : 0,
          now,
          now,
        ]
      );

      for (const [index, attachment] of storedAttachments.entries()) {
        await run(
          `INSERT INTO note_attachments (
             id, note_id, file_name, file_path, content_type, size_bytes, description, sort_order, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            attachment.id,
            id,
            attachment.fileName,
            attachment.filePath,
            attachment.contentType || null,
            attachment.sizeBytes,
            attachment.description || null,
            index,
            now,
          ]
        );
      }

      if (note.sharedSessionIds && note.sharedSessionIds.length > 0) {
        for (const sharedSessionId of note.sharedSessionIds) {
          await run(
            'INSERT OR IGNORE INTO note_session_shares (note_id, session_id, created_at) VALUES (?, ?, ?)',
            [id, sharedSessionId, now]
          );
        }
      }
    });

    return {
      id,
      agentId: note.agentId,
      sessionId: note.sessionId,
      sharedSessionIds: note.sharedSessionIds,
      title: note.title,
      content: note.content ?? '',
      hiddenFromLlm: note.hiddenFromLlm ?? false,
      showOnDashboard: note.showOnDashboard ?? false,
      tags: note.tags,
      attachments: storedAttachments.length > 0 ? storedAttachments : undefined,
      attachment: firstAttachment,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getNote(noteId: string): Promise<Note | null> {
    await this.getConnection();
    const row = await this.connection.get<any>(
      `SELECT n.id, n.agent_id, n.session_id, n.title, n.content, n.tags_json,
              n.attachment_name, n.attachment_path, n.attachment_content_type, n.attachment_size_bytes, n.attachment_description,
              n.compacted_content, n.hidden_from_llm, n.show_on_dashboard,
              n.created_at, n.updated_at,
              GROUP_CONCAT(nss.session_id) AS shared_session_ids
         FROM notes n
         LEFT JOIN note_session_shares nss ON nss.note_id = n.id
        WHERE n.id = ?
        GROUP BY n.id`,
      [noteId]
    );

    if (!row) {
      return null;
    }

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync([noteId]);
    return this.rowToNote(row, attachmentsByNoteId.get(noteId) ?? []);
  }

  async listSessionNotes(sessionId: string): Promise<Note[]> {
    await this.getConnection();
    const rows = await this.connection.all<any>(
      `SELECT n.id, n.agent_id, n.session_id, n.title, n.content, n.tags_json,
              n.attachment_name, n.attachment_path, n.attachment_content_type, n.attachment_size_bytes, n.attachment_description,
              n.compacted_content, n.hidden_from_llm, n.show_on_dashboard,
              n.created_at, n.updated_at,
              GROUP_CONCAT(nss.session_id) AS shared_session_ids
         FROM notes n
         LEFT JOIN note_session_shares nss ON nss.note_id = n.id
        WHERE n.session_id = ?
        GROUP BY n.id
        ORDER BY n.updated_at DESC`,
      [sessionId]
    );

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync(
      rows.map((row) => row.id as string)
    );

    return rows.map((row) => this.rowToNote(row, attachmentsByNoteId.get(row.id) ?? []));
  }

  async listAgentNotes(agentId: string): Promise<Note[]> {
    await this.getConnection();
    const rows = await this.connection.all<any>(
      `SELECT n.id, n.agent_id, n.session_id, n.title, n.content, n.tags_json,
              n.attachment_name, n.attachment_path, n.attachment_content_type, n.attachment_size_bytes, n.attachment_description,
              n.compacted_content, n.hidden_from_llm, n.show_on_dashboard,
              n.created_at, n.updated_at,
              GROUP_CONCAT(nss.session_id) AS shared_session_ids
         FROM notes n
         LEFT JOIN note_session_shares nss ON nss.note_id = n.id
        WHERE n.agent_id = ?
        GROUP BY n.id
        ORDER BY n.created_at DESC`,
      [agentId]
    );

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync(
      rows.map((row) => row.id as string)
    );

    return rows.map((row) => this.rowToNote(row, attachmentsByNoteId.get(row.id) ?? []));
  }

  async listDashboardNotes(limit?: number): Promise<Note[]> {
    await this.getConnection();
    const limitClause = limit && limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';
    const rows = await this.connection.all<any>(
      `SELECT n.id, n.agent_id, n.session_id, n.title, n.content, n.tags_json,
              n.attachment_name, n.attachment_path, n.attachment_content_type, n.attachment_size_bytes, n.attachment_description,
              n.compacted_content, n.hidden_from_llm, n.show_on_dashboard,
              n.created_at, n.updated_at,
              GROUP_CONCAT(nss.session_id) AS shared_session_ids
         FROM notes n
         LEFT JOIN note_session_shares nss ON nss.note_id = n.id
        WHERE n.show_on_dashboard = 1
        GROUP BY n.id
        ORDER BY n.updated_at DESC
        ${limitClause}`
    );

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync(
      rows.map((row) => row.id as string)
    );

    return rows.map((row) => this.rowToNote(row, attachmentsByNoteId.get(row.id) ?? []));
  }

  async updateNote(noteId: string, updates: NoteUpdateInput): Promise<void> {
    await this.getConnection();
    const existing = await this.getNote(noteId);
    if (!existing) {
      return;
    }
    const now = new Date().toISOString();
    const setParts: string[] = [];
    const params: any[] = [];
    const currentAttachments =
      existing.attachments ?? (existing.attachment ? [existing.attachment] : []);
    const requestedAttachments =
      updates.attachments !== undefined
        ? updates.attachments
        : updates.attachment !== undefined
          ? updates.attachment
            ? [updates.attachment]
            : null
          : undefined;
    let nextAttachments: NoteAttachment[] | undefined;

    if (updates.title !== undefined) {
      setParts.push('title = ?');
      params.push(updates.title || null);
    }

    if (updates.content !== undefined) {
      setParts.push('content = ?');
      params.push(updates.content);
    }

    if (updates.sessionId !== undefined) {
      setParts.push('session_id = ?');
      params.push(updates.sessionId || null);
    }

    if (updates.tags !== undefined) {
      setParts.push('tags_json = ?');
      params.push(updates.tags ? JSON.stringify(updates.tags) : null);
    }

    if (updates.compactedContent !== undefined) {
      setParts.push('compacted_content = ?');
      params.push(updates.compactedContent ?? null);
    }

    if (updates.hiddenFromLlm !== undefined) {
      setParts.push('hidden_from_llm = ?');
      params.push(updates.hiddenFromLlm ? 1 : 0);
    }

    if (updates.showOnDashboard !== undefined) {
      setParts.push('show_on_dashboard = ?');
      params.push(updates.showOnDashboard ? 1 : 0);
    }

    if (requestedAttachments !== undefined) {
      nextAttachments = await this.resolveUpdatedAttachmentsAsync(
        noteId,
        currentAttachments,
        requestedAttachments
      );

      const retainedAttachmentIds = new Set(nextAttachments.map((attachment) => attachment.id));
      const removedAttachments = currentAttachments.filter(
        (attachment) => !retainedAttachmentIds.has(attachment.id)
      );
      await this.deleteAttachmentFilesAsync(removedAttachments);

      const firstAttachment = nextAttachments[0];
      setParts.push('attachment_name = ?');
      params.push(firstAttachment?.fileName || null);
      setParts.push('attachment_path = ?');
      params.push(firstAttachment?.filePath || null);
      setParts.push('attachment_content_type = ?');
      params.push(firstAttachment?.contentType || null);
      setParts.push('attachment_size_bytes = ?');
      params.push(firstAttachment?.sizeBytes || null);
      setParts.push('attachment_description = ?');
      params.push(firstAttachment?.description || null);
    }

    if (setParts.length === 0 && updates.sharedSessionIds === undefined) {
      return; // No updates
    }
    setParts.push('updated_at = ?');
    params.push(now);

    if (setParts.length > 0) {
      await this.connection.run(`UPDATE notes SET ${setParts.join(', ')} WHERE id = ?`, [
        ...params,
        noteId,
      ]);
    }

    if (nextAttachments !== undefined) {
      await this.setNoteAttachmentsAsync(noteId, nextAttachments);
    }

    // Update note_session_shares link table when sharedSessionIds is provided
    if (updates.sharedSessionIds !== undefined) {
      await this.connection.run('DELETE FROM note_session_shares WHERE note_id = ?', [noteId]);
      if (updates.sharedSessionIds && updates.sharedSessionIds.length > 0) {
        const sharesNow = new Date().toISOString();
        for (const sid of updates.sharedSessionIds) {
          await this.connection.run(
            'INSERT OR IGNORE INTO note_session_shares (note_id, session_id, created_at) VALUES (?, ?, ?)',
            [noteId, sid, sharesNow]
          );
        }
      }
    }
  }

  async setNoteAttachmentsAsync(noteId: string, attachments: NoteAttachment[]): Promise<void> {
    await this.getConnection();
    const now = new Date().toISOString();
    const firstAttachment = attachments[0];
    await this.connection.runTransaction(async (run) => {
      await run(
        `UPDATE notes
            SET attachment_name = ?,
                attachment_path = ?,
                attachment_content_type = ?,
                attachment_size_bytes = ?,
                attachment_description = ?,
                updated_at = ?
          WHERE id = ?`,
        [
          firstAttachment?.fileName ?? null,
          firstAttachment?.filePath ?? null,
          firstAttachment?.contentType ?? null,
          firstAttachment?.sizeBytes ?? null,
          firstAttachment?.description ?? null,
          now,
          noteId,
        ]
      );

      await run('DELETE FROM note_attachments WHERE note_id = ?', [noteId]);
      for (const [index, attachment] of attachments.entries()) {
        await run(
          `INSERT INTO note_attachments (
             id, note_id, file_name, file_path, content_type, size_bytes, description, sort_order, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            attachment.id,
            noteId,
            attachment.fileName,
            attachment.filePath,
            attachment.contentType || null,
            attachment.sizeBytes,
            attachment.description || null,
            index,
            now,
          ]
        );
      }
    });
  }

  async deleteNote(noteId: string): Promise<boolean> {
    await this.getConnection();
    const existing = await this.getNote(noteId);
    const result = await this.connection.run('DELETE FROM notes WHERE id = ?', [noteId]);
    if ((result.changes || 0) > 0) {
      await this.deleteAttachmentsIfPresent(existing);
    }
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
        n.session_id,
        n.attachment_name,
        n.attachment_path,
        n.attachment_content_type,
        n.attachment_size_bytes,
        n.attachment_description,
        n.compacted_content, n.hidden_from_llm, n.show_on_dashboard,
        n.created_at,
        n.updated_at,
        notes_fts.rank,
        GROUP_CONCAT(nss.session_id) AS shared_session_ids
      FROM notes n
      INNER JOIN notes_fts ON notes_fts.note_id = n.id
      LEFT JOIN note_session_shares nss ON nss.note_id = n.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY n.id
      ORDER BY notes_fts.rank, n.created_at DESC
      LIMIT 100
    `;

    const rows = await this.connection.all<any>(sql, params);

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync(
      rows.map((row) => row.id as string)
    );

    return rows.map((row) => this.rowToNote(row, attachmentsByNoteId.get(row.id) ?? []));
  }

  async createMessageSessionLink(
    messageId: number,
    sessionId: string
  ): Promise<MessageSessionLink> {
    await this.getConnection();
    const now = new Date().toISOString();
    await this.connection.run(
      `INSERT OR REPLACE INTO message_session_links (message_id, session_id, created_at)
       VALUES (?, ?, ?)`,
      [messageId, sessionId, now]
    );
    return { messageId, sessionId, createdAt: now };
  }

  async listMessageSessionLinks(sessionId: string): Promise<MessageSessionLink[]> {
    await this.getConnection();
    const rows = await this.connection.all<{
      message_id: number;
      session_id: string;
      created_at: string;
    }>(
      'SELECT message_id, session_id, created_at FROM message_session_links WHERE session_id = ? ORDER BY created_at DESC',
      [sessionId]
    );
    return rows.map((row) => ({
      messageId: row.message_id,
      sessionId: row.session_id,
      createdAt: row.created_at,
    }));
  }

  async deleteMessageSessionLink(messageId: number, sessionId: string): Promise<boolean> {
    await this.getConnection();
    const result = await this.connection.run(
      'DELETE FROM message_session_links WHERE message_id = ? AND session_id = ?',
      [messageId, sessionId]
    );
    return (result.changes || 0) > 0;
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
    await this.connection.run('UPDATE message_tool_calls SET result_llm = ? WHERE id = ?', [
      newText,
      toolCallId,
    ]);
  }

  // ========== Planning Storage ==========

  async listPlanningIntakeItemsAsync(filter?: PlanningIntakeFilter): Promise<PlanningIntakeItem[]> {
    await this.getConnection();
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }

    if (filter?.sourceType) {
      conditions.push('source_type = ?');
      params.push(filter.sourceType);
    }

    if (filter?.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = filter?.limit ? `LIMIT ${filter.limit}` : '';
    const offsetClause = filter?.offset ? `OFFSET ${filter.offset}` : '';

    const rows = await this.connection.all<any>(
      `SELECT * FROM planning_intake_items ${whereClause} ORDER BY updated_at DESC ${limitClause} ${offsetClause}`,
      params
    );

    return rows.map((row) => ({
      id: row.id,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      sourceUrl: row.source_url || undefined,
      type: row.type,
      title: row.title,
      description: row.description || undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    }));
  }

  async upsertPlanningIntakeItemAsync(item: PlanningIntakeItem): Promise<void> {
    await this.getConnection();
    await this.connection.run(
      `INSERT INTO planning_intake_items (
        id, source_type, source_ref, source_url, type, title, description,
        status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_type = excluded.source_type,
        source_ref = excluded.source_ref,
        source_url = excluded.source_url,
        type = excluded.type,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`,
      [
        item.id,
        item.sourceType,
        item.sourceRef,
        item.sourceUrl || null,
        item.type,
        item.title,
        item.description || null,
        item.status,
        item.metadata ? JSON.stringify(item.metadata) : null,
        item.createdAt,
        item.updatedAt,
      ]
    );
  }

  async createPlanningPlanAsync(plan: PlanningPlan): Promise<PlanningPlan> {
    await this.getConnection();
    await this.connection.run(
      `INSERT INTO planning_plans (
        id, title, goal, status, priority, created_by, created_by_type, assigned_to,
        origin_type, origin_session_id, origin_note_id, markdown_snapshot, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plan.id,
        plan.title,
        plan.goal || null,
        plan.status,
        plan.priority,
        plan.createdBy,
        plan.createdByType,
        plan.assignedTo || null,
        plan.originType,
        plan.originSessionId || null,
        plan.originNoteId || null,
        plan.markdownSnapshot || null,
        plan.metadata ? JSON.stringify(plan.metadata) : null,
        plan.createdAt,
        plan.updatedAt,
      ]
    );
    return plan;
  }

  async getPlanningPlanAsync(planId: string): Promise<PlanningPlan | null> {
    await this.getConnection();
    const row = await this.connection.get<any>('SELECT * FROM planning_plans WHERE id = ?', [
      planId,
    ]);
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      goal: row.goal || undefined,
      status: row.status,
      priority: row.priority,
      createdBy: row.created_by,
      createdByType: row.created_by_type,
      assignedTo: row.assigned_to || undefined,
      originType: row.origin_type,
      originSessionId: row.origin_session_id || undefined,
      originNoteId: row.origin_note_id || undefined,
      markdownSnapshot: row.markdown_snapshot || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    };
  }

  async listPlanningPlansAsync(filter?: PlanningPlanFilter): Promise<PlanningPlan[]> {
    await this.getConnection();
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }

    if (filter?.assignedTo) {
      conditions.push('assigned_to = ?');
      params.push(filter.assignedTo);
    }

    if (filter?.createdBy) {
      conditions.push('created_by = ?');
      params.push(filter.createdBy);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = filter?.limit ? `LIMIT ${filter.limit}` : '';
    const offsetClause = filter?.offset ? `OFFSET ${filter.offset}` : '';

    const rows = await this.connection.all<any>(
      `SELECT * FROM planning_plans ${whereClause} ORDER BY updated_at DESC ${limitClause} ${offsetClause}`,
      params
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      goal: row.goal || undefined,
      status: row.status,
      priority: row.priority,
      createdBy: row.created_by,
      createdByType: row.created_by_type,
      assignedTo: row.assigned_to || undefined,
      originType: row.origin_type,
      originSessionId: row.origin_session_id || undefined,
      originNoteId: row.origin_note_id || undefined,
      markdownSnapshot: row.markdown_snapshot || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    }));
  }

  async updatePlanningPlanAsync(planId: string, updates: Partial<PlanningPlan>): Promise<void> {
    await this.getConnection();
    const setParts: string[] = [];
    const params: any[] = [];

    if (updates.title !== undefined) {
      setParts.push('title = ?');
      params.push(updates.title);
    }
    if (updates.goal !== undefined) {
      setParts.push('goal = ?');
      params.push(updates.goal || null);
    }
    if (updates.status !== undefined) {
      setParts.push('status = ?');
      params.push(updates.status);
    }
    if (updates.priority !== undefined) {
      setParts.push('priority = ?');
      params.push(updates.priority);
    }
    if (updates.assignedTo !== undefined) {
      setParts.push('assigned_to = ?');
      params.push(updates.assignedTo || null);
    }
    if (updates.markdownSnapshot !== undefined) {
      setParts.push('markdown_snapshot = ?');
      params.push(updates.markdownSnapshot || null);
    }
    if (updates.metadata !== undefined) {
      setParts.push('metadata_json = ?');
      params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }
    if (updates.updatedAt !== undefined) {
      setParts.push('updated_at = ?');
      params.push(updates.updatedAt);
    }

    if (setParts.length === 0) {
      return;
    }

    params.push(planId);
    await this.connection.run(
      `UPDATE planning_plans SET ${setParts.join(', ')} WHERE id = ?`,
      params
    );
  }

  async getPlanningPlanSessionVisibilityAsync(
    planId: string
  ): Promise<PlanningPlanSessionVisibility | null> {
    await this.getConnection();
    const rows = await this.connection.all<{ session_id: string }>(
      `SELECT DISTINCT session_id FROM planning_tasks WHERE plan_id = ? ORDER BY session_id ASC`,
      [planId]
    );
    if (rows.length === 0) {
      return null;
    }
    return {
      planId,
      sessionIds: rows.map((row) => row.session_id),
    };
  }

  async createPlanningTaskAsync(task: PlanningTask): Promise<PlanningTask> {
    await this.getConnection();
    await this.connection.run(
      `INSERT INTO planning_tasks (
        id, plan_id, session_id, title, description, type, status, priority,
        created_by, created_by_type, assigned_to, source_action_item, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.planId,
        task.sessionId,
        task.title,
        task.description || null,
        task.type,
        task.status,
        task.priority,
        task.createdBy,
        task.createdByType,
        task.assignedTo || null,
        task.sourceActionItem || null,
        task.metadata ? JSON.stringify(task.metadata) : null,
        task.createdAt,
        task.updatedAt,
      ]
    );
    return task;
  }

  async getPlanningTaskAsync(taskId: string): Promise<PlanningTask | null> {
    await this.getConnection();
    const row = await this.connection.get<any>('SELECT * FROM planning_tasks WHERE id = ?', [
      taskId,
    ]);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      planId: row.plan_id,
      sessionId: row.session_id,
      title: row.title,
      description: row.description || undefined,
      type: row.type,
      status: row.status,
      priority: row.priority,
      createdBy: row.created_by,
      createdByType: row.created_by_type,
      assignedTo: row.assigned_to || undefined,
      sourceActionItem: row.source_action_item || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    };
  }

  async listPlanningTasksAsync(filter?: PlanningTaskFilter): Promise<PlanningTask[]> {
    await this.getConnection();
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.planId) {
      conditions.push('plan_id = ?');
      params.push(filter.planId);
    }
    if (filter?.sessionId) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter?.assignedTo) {
      conditions.push('assigned_to = ?');
      params.push(filter.assignedTo);
    }
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = filter?.limit ? `LIMIT ${filter.limit}` : '';
    const offsetClause = filter?.offset ? `OFFSET ${filter.offset}` : '';

    const rows = await this.connection.all<any>(
      `SELECT * FROM planning_tasks ${whereClause} ORDER BY updated_at DESC ${limitClause} ${offsetClause}`,
      params
    );

    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      sessionId: row.session_id,
      title: row.title,
      description: row.description || undefined,
      type: row.type,
      status: row.status,
      priority: row.priority,
      createdBy: row.created_by,
      createdByType: row.created_by_type,
      assignedTo: row.assigned_to || undefined,
      sourceActionItem: row.source_action_item || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    }));
  }

  async updatePlanningTaskAsync(taskId: string, updates: Partial<PlanningTask>): Promise<void> {
    await this.getConnection();
    const setParts: string[] = [];
    const params: any[] = [];

    if (updates.title !== undefined) {
      setParts.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      setParts.push('description = ?');
      params.push(updates.description || null);
    }
    if (updates.status !== undefined) {
      setParts.push('status = ?');
      params.push(updates.status);
    }
    if (updates.priority !== undefined) {
      setParts.push('priority = ?');
      params.push(updates.priority);
    }
    if (updates.assignedTo !== undefined) {
      setParts.push('assigned_to = ?');
      params.push(updates.assignedTo || null);
    }
    if (updates.sourceActionItem !== undefined) {
      setParts.push('source_action_item = ?');
      params.push(updates.sourceActionItem || null);
    }
    if (updates.metadata !== undefined) {
      setParts.push('metadata_json = ?');
      params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }
    if (updates.updatedAt !== undefined) {
      setParts.push('updated_at = ?');
      params.push(updates.updatedAt);
    }

    if (setParts.length === 0) {
      return;
    }

    params.push(taskId);
    await this.connection.run(
      `UPDATE planning_tasks SET ${setParts.join(', ')} WHERE id = ?`,
      params
    );
  }

  async createPlanningTodoAsync(todo: PlanningTodo): Promise<PlanningTodo> {
    await this.getConnection();
    await this.connection.run(
      `INSERT INTO planning_todos (
        id, task_id, content, order_index, done, completed_at, completed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        todo.id,
        todo.taskId,
        todo.content,
        todo.orderIndex,
        todo.done ? 1 : 0,
        todo.completedAt || null,
        todo.completedBy || null,
        todo.createdAt,
        todo.updatedAt,
      ]
    );
    return todo;
  }

  async listPlanningTodosAsync(taskId: string): Promise<PlanningTodo[]> {
    await this.getConnection();
    const rows = await this.connection.all<any>(
      `SELECT * FROM planning_todos WHERE task_id = ? ORDER BY order_index ASC, created_at ASC`,
      [taskId]
    );
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      content: row.content,
      orderIndex: row.order_index,
      done: row.done === 1,
      completedAt: row.completed_at || undefined,
      completedBy: row.completed_by || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async updatePlanningTodoAsync(todoId: string, updates: Partial<PlanningTodo>): Promise<void> {
    await this.getConnection();
    const setParts: string[] = [];
    const params: any[] = [];

    if (updates.content !== undefined) {
      setParts.push('content = ?');
      params.push(updates.content);
    }
    if (updates.orderIndex !== undefined) {
      setParts.push('order_index = ?');
      params.push(updates.orderIndex);
    }
    if (updates.done !== undefined) {
      setParts.push('done = ?');
      params.push(updates.done ? 1 : 0);
    }
    if (updates.completedAt !== undefined) {
      setParts.push('completed_at = ?');
      params.push(updates.completedAt || null);
    }
    if (updates.completedBy !== undefined) {
      setParts.push('completed_by = ?');
      params.push(updates.completedBy || null);
    }
    if (updates.updatedAt !== undefined) {
      setParts.push('updated_at = ?');
      params.push(updates.updatedAt);
    }

    if (setParts.length === 0) {
      return;
    }

    params.push(todoId);
    await this.connection.run(
      `UPDATE planning_todos SET ${setParts.join(', ')} WHERE id = ?`,
      params
    );
  }

  async createPlanningTaskDelegationAsync(
    delegation: PlanningTaskDelegation
  ): Promise<PlanningTaskDelegation> {
    await this.getConnection();
    await this.connection.run(
      `INSERT INTO planning_task_delegations (
        id, task_id, from_agent_id, to_agent_id, reason, delegated_at, accepted, accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        delegation.id,
        delegation.taskId,
        delegation.fromAgentId,
        delegation.toAgentId,
        delegation.reason || null,
        delegation.delegatedAt,
        delegation.accepted ? 1 : 0,
        delegation.acceptedAt || null,
      ]
    );
    return delegation;
  }

  async listPlanningTaskDelegationsAsync(taskId: string): Promise<PlanningTaskDelegation[]> {
    await this.getConnection();
    const rows = await this.connection.all<any>(
      `SELECT * FROM planning_task_delegations WHERE task_id = ? ORDER BY delegated_at DESC`,
      [taskId]
    );
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      reason: row.reason || undefined,
      delegatedAt: row.delegated_at,
      accepted: row.accepted === 1,
      acceptedAt: row.accepted_at || undefined,
    }));
  }
}
