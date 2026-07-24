import type {
  ChatMessage,
  MessageFilter,
  MessageInsertResult,
  MessageSessionLink,
  SessionSkill,
  IMessagesRepository,
} from '@ai-team/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SqliteDrizzleDatabase } from '../storage/sqlite/connection.js';
import * as dbSchema from '../storage/sqlite/schema.js';

type EnsureReadyAsync = () => Promise<void>;
type GetDb = () => SqliteDrizzleDatabase;
type ToolCallRow = {
  id: number;
  tool_call_id: string | null;
  tool_name: string;
  params_json: string;
  requested_at: string | null;
  result_json: string | null;
  result_llm: string | null;
};
type ToolResultRow = {
  message_tool_call_id: number;
  phase: string;
  result_json: string | null;
  result_llm: string | null;
  completed_at: string;
};

export class MessagesRepository implements IMessagesRepository {
  constructor(
    private readonly ensureReadyAsync: EnsureReadyAsync,
    private readonly getDb: GetDb
  ) {}

  private db() {
    return this.getDb();
  }

  async insertMessage(sessionId: string, message: ChatMessage): Promise<MessageInsertResult> {
    await this.ensureReadyAsync();
    const timestamp = message.timestamp || new Date().toISOString();
    if (message.failureId) {
      const existing = this.db()
        .select({
          id: dbSchema.messages.id,
          timestamp: dbSchema.messages.timestamp,
        })
        .from(dbSchema.messages)
        .where(eq(dbSchema.messages.failureId, message.failureId))
        .get();
      if (existing) {
        return { messageId: existing.id, timestamp: existing.timestamp };
      }
    }

    return this.db().transaction((tx) => {
      const msgResult = tx
        .insert(dbSchema.messages)
        .values({
          sessionId,
          timestamp,
          fromId: message.from,
          toId: message.to || null,
          isHuman: message.isHuman ? 1 : 0,
          content: message.content,
          kind: message.kind ?? 'message',
          failureId: message.failureId ?? null,
          errorCode: message.errorCode ?? null,
          errorDetailsJson: message.errorDetails ? JSON.stringify(message.errorDetails) : null,
          archived: message.archived ? 1 : 0,
          hiddenFromLlm: message.hiddenFromLlm ? 1 : 0,
          handoffType: message.handoffType || null,
          targetAgentId: message.targetAgentId || null,
          handoffFromSessionId: message.handoffFromSessionId || null,
          handoffToSessionId: message.handoffToSessionId || null,
          handoffId: message.handoffId || null,
          importance: message.importance || null,
        })
        .run();

      const messageId = Number(msgResult.lastInsertRowid ?? 0);

      if (message.context && message.context.length > 0) {
        for (const filePath of message.context) {
          tx.insert(dbSchema.messageFiles).values({ messageId, filePath }).run();
        }
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          tx.insert(dbSchema.messageToolCalls)
            .values({
              messageId,
              toolCallId: toolCall.callId ?? null,
              toolName: toolCall.tool,
              paramsJson: JSON.stringify(toolCall.params),
              requestedAt: toolCall.requestedAt ?? timestamp,
              resultJson: toolCall.result === undefined ? null : JSON.stringify(toolCall.result),
              resultLlm: toolCall.resultLlm ?? null,
            })
            .run();
        }
      }

      if (message.suggestions && message.suggestions.length > 0) {
        for (const suggestion of message.suggestions) {
          tx.insert(dbSchema.messageSuggestions)
            .values({
              messageId,
              suggestionType: suggestion.type,
              filePath: suggestion.file,
              lineNumber: suggestion.line || null,
              description: suggestion.description,
              code: suggestion.code || null,
            })
            .run();
        }
      }

      tx.update(dbSchema.sessions)
        .set({
          messageCount: sql`${dbSchema.sessions.messageCount} + 1`,
          lastActivityAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(dbSchema.sessions.id, sessionId))
        .run();

      return { messageId, timestamp };
    });
  }

  async insertToolCallRequest(
    sessionId: string,
    message: ChatMessage
  ): Promise<MessageInsertResult> {
    return this.insertMessage(sessionId, message);
  }

  async insertToolCallResult(
    sessionId: string,
    callId: string,
    result: unknown,
    resultLlm: string | undefined,
    phase: 'result' | 'error' | 'denied',
    timestamp: string
  ): Promise<void> {
    await this.ensureReadyAsync();
    const invocation = this.db()
      .select({ id: dbSchema.messageToolCalls.id })
      .from(dbSchema.messageToolCalls)
      .innerJoin(
        dbSchema.messages,
        eq(dbSchema.messages.id, dbSchema.messageToolCalls.messageId)
      )
      .where(
        and(
          eq(dbSchema.messages.sessionId, sessionId),
          eq(dbSchema.messageToolCalls.toolCallId, callId)
        )
      )
      .orderBy(desc(dbSchema.messageToolCalls.id))
      .get();

    if (!invocation) {
      throw new Error(`Tool invocation ${callId} was not found in session ${sessionId}.`);
    }

    this.db()
      .insert(dbSchema.messageToolResults)
      .values({
        messageToolCallId: invocation.id,
        phase,
        resultJson: result === undefined ? null : JSON.stringify(result),
        resultLlm: resultLlm ?? null,
        completedAt: timestamp,
      })
      .run();
  }

  async getSessionMessages(
    sessionId: string,
    includeArchived: boolean = false
  ): Promise<ChatMessage[]> {
    await this.ensureReadyAsync();
    const whereConditions = [eq(dbSchema.messages.sessionId, sessionId)];
    if (includeArchived === false) {
      whereConditions.push(eq(dbSchema.messages.archived, 0));
    }

    const rows = await this.db()
      .select({
        id: dbSchema.messages.id,
        timestamp: dbSchema.messages.timestamp,
        from_id: dbSchema.messages.fromId,
        to_id: dbSchema.messages.toId,
        is_human: dbSchema.messages.isHuman,
        content: dbSchema.messages.content,
        kind: dbSchema.messages.kind,
        failure_id: dbSchema.messages.failureId,
        error_code: dbSchema.messages.errorCode,
        error_details_json: dbSchema.messages.errorDetailsJson,
        archived: dbSchema.messages.archived,
        hidden_from_llm: dbSchema.messages.hiddenFromLlm,
        handoff_type: dbSchema.messages.handoffType,
        target_agent_id: dbSchema.messages.targetAgentId,
        handoff_from_session_id: dbSchema.messages.handoffFromSessionId,
        handoff_to_session_id: dbSchema.messages.handoffToSessionId,
        handoff_id: dbSchema.messages.handoffId,
        importance: dbSchema.messages.importance,
      })
      .from(dbSchema.messages)
      .where(and(...whereConditions))
      .orderBy(asc(dbSchema.messages.timestamp));

    return this.rowsToMessages(rows);
  }

  async queryMessages(filter: MessageFilter): Promise<ChatMessage[]> {
    await this.ensureReadyAsync();
    const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [];

    if (filter.sessionId) {
      conditions.push(eq(dbSchema.messages.sessionId, filter.sessionId));
    }

    if (filter.fromId) {
      conditions.push(eq(dbSchema.messages.fromId, filter.fromId));
    }

    if (filter.toId) {
      conditions.push(eq(dbSchema.messages.toId, filter.toId));
    }

    if (filter.isHuman !== undefined) {
      conditions.push(eq(dbSchema.messages.isHuman, filter.isHuman ? 1 : 0));
    }

    if (filter.archived !== undefined) {
      conditions.push(eq(dbSchema.messages.archived, filter.archived ? 1 : 0));
    }

    if (filter.handoffType) {
      conditions.push(eq(dbSchema.messages.handoffType, filter.handoffType));
    }

    if (filter.timestampFrom) {
      conditions.push(sql`${dbSchema.messages.timestamp} >= ${filter.timestampFrom}`);
    }

    if (filter.timestampTo) {
      conditions.push(sql`${dbSchema.messages.timestamp} <= ${filter.timestampTo}`);
    }

    let query: any = this.db()
      .select({
        id: dbSchema.messages.id,
        timestamp: dbSchema.messages.timestamp,
        from_id: dbSchema.messages.fromId,
        to_id: dbSchema.messages.toId,
        is_human: dbSchema.messages.isHuman,
        content: dbSchema.messages.content,
        kind: dbSchema.messages.kind,
        failure_id: dbSchema.messages.failureId,
        error_code: dbSchema.messages.errorCode,
        error_details_json: dbSchema.messages.errorDetailsJson,
        archived: dbSchema.messages.archived,
        hidden_from_llm: dbSchema.messages.hiddenFromLlm,
        handoff_type: dbSchema.messages.handoffType,
        target_agent_id: dbSchema.messages.targetAgentId,
        handoff_from_session_id: dbSchema.messages.handoffFromSessionId,
        handoff_to_session_id: dbSchema.messages.handoffToSessionId,
        handoff_id: dbSchema.messages.handoffId,
        importance: dbSchema.messages.importance,
      })
      .from(dbSchema.messages)
      .orderBy(asc(dbSchema.messages.timestamp));

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    if (filter.limit) query = query.limit(filter.limit);
    if (filter.offset) query = query.offset(filter.offset);

    const rows = await query;
    return this.rowsToMessages(rows);
  }

  async archiveMessage(sessionId: string, messageTimestamp: string): Promise<boolean> {
    await this.ensureReadyAsync();
    const result = await this.db()
      .update(dbSchema.messages)
      .set({ archived: 1 })
      .where(
        and(
          eq(dbSchema.messages.sessionId, sessionId),
          eq(dbSchema.messages.timestamp, messageTimestamp)
        )
      );
    return (result.changes ?? 0) > 0;
  }

  async deleteMessage(sessionId: string, messageTimestamp: string): Promise<boolean> {
    await this.ensureReadyAsync();
    const row = this.db()
      .select({ id: dbSchema.messages.id })
      .from(dbSchema.messages)
      .where(
        and(
          eq(dbSchema.messages.sessionId, sessionId),
          eq(dbSchema.messages.timestamp, messageTimestamp)
        )
      )
      .get();

    if (!row) {
      return false;
    }

    const now = new Date().toISOString();
    this.db().transaction((tx) => {
      tx.delete(dbSchema.messages).where(eq(dbSchema.messages.id, row.id)).run();
      tx.update(dbSchema.sessions)
        .set({
          messageCount: sql`${dbSchema.sessions.messageCount} - 1`,
          updatedAt: now,
        })
        .where(eq(dbSchema.sessions.id, sessionId))
        .run();
    });

    return true;
  }

  async searchMessages(query: string, sessionId?: string): Promise<ChatMessage[]> {
    await this.ensureReadyAsync();
    const whereConditions = [sql`messages_fts MATCH ${query}`];
    if (sessionId) {
      whereConditions.push(sql`messages_fts.session_id = ${sessionId}`);
    }

    const rows = this.db().all<any>(sql`
      SELECT
        m.id,
        m.timestamp,
        m.from_id,
        m.to_id,
        m.is_human,
        m.content,
        m.kind,
        m.failure_id,
        m.error_code,
        m.error_details_json,
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
      WHERE ${sql.join(whereConditions, sql` AND `)}
      ORDER BY messages_fts.rank, m.timestamp DESC
      LIMIT 100
    `);

    return this.rowsToMessages(rows);
  }

  async getMessageById(messageId: number): Promise<ChatMessage | null> {
    await this.ensureReadyAsync();
    const row = this.db()
      .select({
        id: dbSchema.messages.id,
        timestamp: dbSchema.messages.timestamp,
        from_id: dbSchema.messages.fromId,
        to_id: dbSchema.messages.toId,
        is_human: dbSchema.messages.isHuman,
        content: dbSchema.messages.content,
        kind: dbSchema.messages.kind,
        failure_id: dbSchema.messages.failureId,
        error_code: dbSchema.messages.errorCode,
        error_details_json: dbSchema.messages.errorDetailsJson,
        archived: dbSchema.messages.archived,
        hidden_from_llm: dbSchema.messages.hiddenFromLlm,
        handoff_type: dbSchema.messages.handoffType,
        target_agent_id: dbSchema.messages.targetAgentId,
        handoff_from_session_id: dbSchema.messages.handoffFromSessionId,
        handoff_to_session_id: dbSchema.messages.handoffToSessionId,
        handoff_id: dbSchema.messages.handoffId,
        importance: dbSchema.messages.importance,
      })
      .from(dbSchema.messages)
      .where(eq(dbSchema.messages.id, messageId))
      .get();

    if (!row) {
      return null;
    }

    return this.rowToMessage(row);
  }

  async setMessageHiddenFromLlm(messageId: number, hidden: boolean): Promise<boolean> {
    await this.ensureReadyAsync();
    const result = await this.db()
      .update(dbSchema.messages)
      .set({ hiddenFromLlm: hidden ? 1 : 0 })
      .where(eq(dbSchema.messages.id, messageId));
    return (result.changes || 0) > 0;
  }

  async updateMessageContent(messageId: number, newContent: string): Promise<boolean> {
    await this.ensureReadyAsync();
    const result = await this.db()
      .update(dbSchema.messages)
      .set({ content: newContent })
      .where(eq(dbSchema.messages.id, messageId));
    return (result.changes || 0) > 0;
  }

  async createMessageSessionLink(
    messageId: number,
    sessionId: string
  ): Promise<MessageSessionLink> {
    await this.ensureReadyAsync();
    const now = new Date().toISOString();
    this.db()
      .insert(dbSchema.messageSessionLinks)
      .values({ messageId, sessionId, createdAt: now })
      .onConflictDoUpdate({
        target: [dbSchema.messageSessionLinks.messageId, dbSchema.messageSessionLinks.sessionId],
        set: { createdAt: now },
      })
      .run();

    return { messageId, sessionId, createdAt: now };
  }

  async listMessageSessionLinks(sessionId: string): Promise<MessageSessionLink[]> {
    await this.ensureReadyAsync();
    const rows = await this.db()
      .select({
        message_id: dbSchema.messageSessionLinks.messageId,
        session_id: dbSchema.messageSessionLinks.sessionId,
        created_at: dbSchema.messageSessionLinks.createdAt,
      })
      .from(dbSchema.messageSessionLinks)
      .where(eq(dbSchema.messageSessionLinks.sessionId, sessionId))
      .orderBy(desc(dbSchema.messageSessionLinks.createdAt));

    return rows.map((row) => ({
      messageId: row.message_id,
      sessionId: row.session_id,
      createdAt: row.created_at,
    }));
  }

  async deleteMessageSessionLink(messageId: number, sessionId: string): Promise<boolean> {
    await this.ensureReadyAsync();
    const result = this.db()
      .delete(dbSchema.messageSessionLinks)
      .where(
        and(
          eq(dbSchema.messageSessionLinks.messageId, messageId),
          eq(dbSchema.messageSessionLinks.sessionId, sessionId)
        )
      )
      .run();

    return (result.changes || 0) > 0;
  }

  async addSessionSkill(sessionId: string, skillPath: string): Promise<void> {
    await this.ensureReadyAsync();
    const now = new Date().toISOString();
    this.db()
      .insert(dbSchema.sessionSkills)
      .values({ sessionId, skillPath, loadedAt: now, paused: 0 })
      .onConflictDoUpdate({
        target: [dbSchema.sessionSkills.sessionId, dbSchema.sessionSkills.skillPath],
        set: { loadedAt: now },
      })
      .run();
  }

  async getSessionSkills(sessionId: string): Promise<SessionSkill[]> {
    await this.ensureReadyAsync();
    const rows = await this.db()
      .select({
        skill_path: dbSchema.sessionSkills.skillPath,
        loaded_at: dbSchema.sessionSkills.loadedAt,
        paused: dbSchema.sessionSkills.paused,
      })
      .from(dbSchema.sessionSkills)
      .where(eq(dbSchema.sessionSkills.sessionId, sessionId))
      .orderBy(asc(dbSchema.sessionSkills.loadedAt));

    return rows.map((row) => ({
      sessionId,
      skillPath: row.skill_path,
      loadedAt: row.loaded_at,
      paused: row.paused === 1,
    }));
  }

  async setSessionSkillPaused(
    sessionId: string,
    skillPath: string,
    paused: boolean
  ): Promise<void> {
    await this.ensureReadyAsync();
    await this.db()
      .update(dbSchema.sessionSkills)
      .set({ paused: paused ? 1 : 0 })
      .where(
        and(
          eq(dbSchema.sessionSkills.sessionId, sessionId),
          eq(dbSchema.sessionSkills.skillPath, skillPath)
        )
      );
  }

  async removeSessionSkill(sessionId: string, skillPath: string): Promise<void> {
    await this.ensureReadyAsync();
    this.db()
      .delete(dbSchema.sessionSkills)
      .where(
        and(
          eq(dbSchema.sessionSkills.sessionId, sessionId),
          eq(dbSchema.sessionSkills.skillPath, skillPath)
        )
      )
      .run();
  }

  async updateToolCallLlmResult(toolCallId: number, newText: string): Promise<void> {
    await this.ensureReadyAsync();
    this.db().transaction((tx) => {
      tx.update(dbSchema.messageToolResults)
        .set({ resultLlm: newText })
        .where(eq(dbSchema.messageToolResults.messageToolCallId, toolCallId))
        .run();
      // Preserve editing support for pre-split alpha records.
      tx.update(dbSchema.messageToolCalls)
        .set({ resultLlm: newText })
        .where(eq(dbSchema.messageToolCalls.id, toolCallId))
        .run();
    });
  }

  private async loadLatestToolResults(
    toolCallIds: number[]
  ): Promise<Map<number, ToolResultRow>> {
    if (toolCallIds.length === 0) return new Map();

    const rows = await this.db()
      .select({
        message_tool_call_id: dbSchema.messageToolResults.messageToolCallId,
        phase: dbSchema.messageToolResults.phase,
        result_json: dbSchema.messageToolResults.resultJson,
        result_llm: dbSchema.messageToolResults.resultLlm,
        completed_at: dbSchema.messageToolResults.completedAt,
      })
      .from(dbSchema.messageToolResults)
      .where(inArray(dbSchema.messageToolResults.messageToolCallId, toolCallIds))
      .orderBy(asc(dbSchema.messageToolResults.completedAt));

    return new Map(rows.map((row) => [row.message_tool_call_id, row]));
  }

  private toToolCall(
    row: ToolCallRow,
    completion: ToolResultRow | undefined,
    messageTimestamp?: string
  ): NonNullable<ChatMessage['tool_calls']>[number] {
    return {
      id: row.id,
      callId: row.tool_call_id ?? `legacy-${row.id}`,
      tool: row.tool_name,
      params: JSON.parse(row.params_json),
      requestedAt: row.requested_at ?? messageTimestamp,
      result: completion?.result_json
        ? JSON.parse(completion.result_json)
        : row.result_json
          ? JSON.parse(row.result_json)
          : undefined,
      resultLlm: completion?.result_llm ?? row.result_llm ?? undefined,
      completedAt: completion?.completed_at
        ?? (row.result_json !== null || row.result_llm !== null ? messageTimestamp : undefined),
      resultPhase: completion?.phase as 'result' | 'error' | 'denied' | undefined,
    };
  }

  private async rowToMessage(row: any): Promise<ChatMessage> {
    const messageId = row.id;

    const contextRows = await this.db()
      .select({ file_path: dbSchema.messageFiles.filePath })
      .from(dbSchema.messageFiles)
      .where(eq(dbSchema.messageFiles.messageId, messageId));
    const context = contextRows.map((record) => record.file_path);

    const toolCallRows = await this.db()
      .select({
        id: dbSchema.messageToolCalls.id,
        tool_call_id: dbSchema.messageToolCalls.toolCallId,
        tool_name: dbSchema.messageToolCalls.toolName,
        params_json: dbSchema.messageToolCalls.paramsJson,
        requested_at: dbSchema.messageToolCalls.requestedAt,
        result_json: dbSchema.messageToolCalls.resultJson,
        result_llm: dbSchema.messageToolCalls.resultLlm,
      })
      .from(dbSchema.messageToolCalls)
      .where(eq(dbSchema.messageToolCalls.messageId, messageId));

    const latestResultByCall = await this.loadLatestToolResults(
      toolCallRows.map((toolCall) => toolCall.id)
    );
    const toolCalls = toolCallRows.map((toolCall) =>
      this.toToolCall(toolCall, latestResultByCall.get(toolCall.id), row.timestamp)
    );

    const suggestionRows = await this.db()
      .select({
        suggestion_type: dbSchema.messageSuggestions.suggestionType,
        file_path: dbSchema.messageSuggestions.filePath,
        line_number: dbSchema.messageSuggestions.lineNumber,
        description: dbSchema.messageSuggestions.description,
        code: dbSchema.messageSuggestions.code,
      })
      .from(dbSchema.messageSuggestions)
      .where(eq(dbSchema.messageSuggestions.messageId, messageId));

    const suggestions: NonNullable<ChatMessage['suggestions']> = suggestionRows.map((record) => ({
      type: record.suggestion_type as NonNullable<ChatMessage['suggestions']>[number]['type'],
      file: record.file_path,
      line: record.line_number || undefined,
      description: record.description,
      code: record.code || undefined,
    }));

    return {
      id: messageId,
      timestamp: row.timestamp,
      from: row.from_id,
      to: row.to_id || undefined,
      isHuman: row.is_human === 1,
      content: row.content,
      kind: row.kind === 'error' ? 'error' : 'message',
      failureId: row.failure_id || undefined,
      errorCode: row.error_code || undefined,
      errorDetails: this.parseErrorDetails(row.error_details_json),
      context: context.length > 0 ? context : undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
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

  private async rowsToMessages(rows: any[]): Promise<ChatMessage[]> {
    if (rows.length === 0) {
      return [];
    }

    const messageIds = rows.map((row) => row.id as number);
    const [contextRows, toolCallRows, suggestionRows] = await Promise.all([
      this.db()
        .select({
          message_id: dbSchema.messageFiles.messageId,
          file_path: dbSchema.messageFiles.filePath,
        })
        .from(dbSchema.messageFiles)
        .where(inArray(dbSchema.messageFiles.messageId, messageIds)),
      this.db()
        .select({
          id: dbSchema.messageToolCalls.id,
          message_id: dbSchema.messageToolCalls.messageId,
          tool_call_id: dbSchema.messageToolCalls.toolCallId,
          tool_name: dbSchema.messageToolCalls.toolName,
          params_json: dbSchema.messageToolCalls.paramsJson,
          requested_at: dbSchema.messageToolCalls.requestedAt,
          result_json: dbSchema.messageToolCalls.resultJson,
          result_llm: dbSchema.messageToolCalls.resultLlm,
        })
        .from(dbSchema.messageToolCalls)
        .where(inArray(dbSchema.messageToolCalls.messageId, messageIds)),
      this.db()
        .select({
          message_id: dbSchema.messageSuggestions.messageId,
          suggestion_type: dbSchema.messageSuggestions.suggestionType,
          file_path: dbSchema.messageSuggestions.filePath,
          line_number: dbSchema.messageSuggestions.lineNumber,
          description: dbSchema.messageSuggestions.description,
          code: dbSchema.messageSuggestions.code,
        })
        .from(dbSchema.messageSuggestions)
        .where(inArray(dbSchema.messageSuggestions.messageId, messageIds)),
    ]);

    const latestResultByCall = await this.loadLatestToolResults(
      toolCallRows.map((toolCall) => toolCall.id)
    );
    const messageTimestampById = new Map<number, string>(
      rows.map((message) => [message.id as number, message.timestamp as string])
    );

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
      NonNullable<ChatMessage['tool_calls']>
    >();
    for (const row of toolCallRows) {
      const parsed = this.toToolCall(
        row,
        latestResultByCall.get(row.id),
        messageTimestampById.get(row.message_id)
      );
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
        type: row.suggestion_type,
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
        kind: row.kind === 'error' ? 'error' : 'message',
        failureId: row.failure_id || undefined,
        errorCode: row.error_code || undefined,
        errorDetails: this.parseErrorDetails(row.error_details_json),
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

  private parseErrorDetails(value: unknown): ChatMessage['errorDetails'] {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object'
        ? (parsed as ChatMessage['errorDetails'])
        : undefined;
    } catch {
      return undefined;
    }
  }
}
