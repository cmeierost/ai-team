import type {
  ISessionsService,
  ChatSession,
  ChatMessage,
  SessionThread,
} from '@ai-team/api-contracts';
import type {
  IAgentManager,
  ILlmService,
  MessageSessionLink,
  Note,
  NoteSessionShare,
  SessionDeleteImpact,
} from '@ai-team/core';
import type { SessionManager } from '../sessions/session-manager.js';
import { BadRequestError, NotFoundError } from '@ai-team/core';

// ── Session meta helpers ──────────────────────────────────────────────────────

const SESSION_META_PREFIX = '<!-- ai-team:session-meta ';
const SESSION_META_SUFFIX = ' -->';

function readSessionMeta(notes?: string) {
  if (!notes?.includes(SESSION_META_PREFIX)) return { cleanNotes: notes, activatedTools: [] };
  const start = notes.lastIndexOf(SESSION_META_PREFIX);
  if (start < 0) return { cleanNotes: notes, activatedTools: [] };
  const afterPrefix = start + SESSION_META_PREFIX.length;
  const end = notes.indexOf(SESSION_META_SUFFIX, afterPrefix);
  if (end < 0) return { cleanNotes: notes, activatedTools: [] };
  const json = notes.slice(afterPrefix, end);
  const cleanNotes = notes.slice(0, start).trimEnd() || undefined;
  try {
    const parsed = JSON.parse(json) as { activatedTools?: unknown[] };
    return {
      cleanNotes,
      activatedTools: Array.isArray(parsed.activatedTools) ? parsed.activatedTools : [],
    };
  } catch {
    return { cleanNotes: notes, activatedTools: [] };
  }
}

function hydrateSession(session: Record<string, unknown>): ChatSession {
  const { cleanNotes, activatedTools } = readSessionMeta(session.notes as string | undefined);
  return { ...session, notes: cleanNotes, activatedTools } as unknown as ChatSession;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SessionsService implements ISessionsService {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly agentManager: IAgentManager,
    private readonly llmService: ILlmService
  ) {}

  async recent(query?: { limit?: number }): Promise<ChatSession[]> {
    const sessions = await this.sessionManager.listRecentSessions(query?.limit ?? 10);
    return (sessions as any[]).map((s) => hydrateSession(s));
  }

  async list(query?: {
    agentId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ChatSession[]> {
    if (!query?.agentId) return [];
    const sessions = await this.sessionManager.listSessions(query.agentId, query.limit);
    return (sessions as any[]).map((s) => hydrateSession(s));
  }

  async latestByAgent(agentId: string): Promise<ChatSession> {
    const session = await this.sessionManager.getLatestSession(agentId);
    if (!session) throw new NotFoundError(`No sessions for agent ${agentId}`);
    return hydrateSession(session as any);
  }

  async create(body: {
    agentId: string;
    developerId?: string;
    title?: string;
  }): Promise<ChatSession> {
    if (!body.agentId) throw new BadRequestError('agentId is required');
    return this.sessionManager.createSession(
      body.agentId,
      body.developerId ?? 'developer'
    ) as Promise<ChatSession>;
  }

  async handoff(body: {
    toAgentId: string;
    developerId?: string;
    previousSessionId: string;
    transferArtifacts?: boolean;
    transferAllowedFiles?: boolean;
  }): Promise<ChatSession> {
    if (!body.toAgentId) throw new BadRequestError('toAgentId is required');
    if (!body.previousSessionId) throw new BadRequestError('previousSessionId is required');

    return this.sessionManager.createHandoffSession(
      body.toAgentId,
      body.developerId ?? 'developer',
      body.previousSessionId,
      body.transferArtifacts ?? true,
      body.transferAllowedFiles ?? true
    ) as Promise<ChatSession>;
  }

  async getById(sessionId: string): Promise<ChatSession> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) throw new NotFoundError('Session not found');
    return hydrateSession(session as any);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.sessionManager.getSessionMessages(sessionId) as Promise<ChatMessage[]>;
  }

  async deleteMessage(sessionId: string, timestamp: string): Promise<{ ok: boolean }> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) throw new NotFoundError('Session not found');
    const ts = decodeURIComponent(timestamp);
    const deleted = await this.sessionManager.deleteSessionMessage(sessionId, ts);
    if (!deleted) throw new NotFoundError('Message not found');
    return { ok: true };
  }

  async getThread(sessionId: string): Promise<SessionThread> {
    const check = await this.sessionManager.getSession(sessionId);
    if (!check) throw new NotFoundError('Session not found');

    const threadGraph = await this.sessionManager.getThreadGraphData(sessionId);

    const sessions = await Promise.all(
      threadGraph.sessions.map(async (session) => {
        const agentNames = await Promise.all(
          session.agentIds.map(async (id) => {
            try {
              return (await this.agentManager.getAgentAsync(id))?.name ?? id;
            } catch {
              return id;
            }
          })
        );

        return {
          ...session,
          agentNames,
        };
      })
    );

    return {
      rootSessionId: threadGraph.rootSessionId,
      currentSessionId: sessionId,
      depth: threadGraph.depth,
      handoffs: threadGraph.handoffs,
      sessions,
    } as unknown as SessionThread;
  }

  async listNotes(sessionId: string): Promise<Note[]> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    return this.sessionManager.listSessionNotes(sessionId);
  }

  async getDeleteImpact(sessionId: string): Promise<SessionDeleteImpact> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    return this.sessionManager.getSessionDeleteImpact(sessionId);
  }

  async listDashboardNotes(query?: { limit?: number }): Promise<Note[]> {
    return this.sessionManager.listDashboardNotes(query?.limit);
  }

  async createNote(
    sessionId: string,
    body: {
      agentId: string;
      sharedSessionIds?: string[];
      title?: string;
      content?: string;
      hiddenFromLlm?: boolean;
      showOnDashboard?: boolean;
      tags?: string[];
      attachments?: Array<{
        fileName: string;
        contentBase64: string;
        contentType?: string;
        sizeBytes?: number;
        description?: string;
      }>;
      attachment?: {
        fileName: string;
        contentBase64: string;
        contentType?: string;
        sizeBytes?: number;
        description?: string;
      };
    }
  ): Promise<Note> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    if (!body?.agentId) throw new BadRequestError('agentId is required');
    return this.sessionManager.createNote({
      agentId: body.agentId,
      sessionId,
      sharedSessionIds: body.sharedSessionIds,
      title: body.title,
      content: body.content,
      hiddenFromLlm: body.hiddenFromLlm,
      showOnDashboard: body.showOnDashboard,
      tags: body.tags,
      attachments: body.attachments,
      attachment: body.attachment,
    });
  }

  async getNote(sessionId: string, noteId: string): Promise<Note> {
    const note = await this.sessionManager.getNote(noteId);
    if (note?.sessionId !== sessionId) throw new NotFoundError('Note not found');
    return note;
  }

  async updateNote(
    sessionId: string,
    noteId: string,
    body: {
      title?: string;
      content?: string;
      compactedContent?: string | null;
      tags?: string[];
      sharedSessionIds?: string[] | null;
      hiddenFromLlm?: boolean;
      showOnDashboard?: boolean;
      attachments?: Array<
        | {
            id: string;
          }
        | {
            fileName: string;
            contentBase64: string;
            contentType?: string;
            sizeBytes?: number;
            description?: string;
          }
      > | null;
      attachment?: {
        fileName: string;
        contentBase64: string;
        contentType?: string;
        sizeBytes?: number;
        description?: string;
      } | null;
    }
  ): Promise<Note> {
    const note = await this.sessionManager.getNote(noteId);
    if (note?.sessionId !== sessionId) throw new NotFoundError('Note not found');
    const updated = await this.sessionManager.updateNote(noteId, {
      ...body,
      sharedSessionIds: body.sharedSessionIds,
      hiddenFromLlm: body.hiddenFromLlm,
      showOnDashboard: body.showOnDashboard,
      attachments: body.attachments,
    });
    if (!updated) throw new NotFoundError('Note not found');
    return updated;
  }

  async compactNote(
    sessionId: string,
    noteId: string,
    body?: { maxWords?: number; focusInstruction?: string; generateTitle?: boolean }
  ): Promise<Note> {
    const note = await this.sessionManager.getNote(noteId);
    if (note?.sessionId !== sessionId) throw new NotFoundError('Note not found');
    await this.llmService.ensureInitialized();
    const maxWords =
      typeof body?.maxWords === 'number' && body.maxWords > 0 ? body.maxWords : undefined;
    const focusInstruction =
      typeof body?.focusInstruction === 'string' ? body.focusInstruction.trim() : undefined;
    const updated = await this.sessionManager.compactNoteAsync(
      noteId,
      this.llmService,
      maxWords,
      focusInstruction,
      body?.generateTitle === true
    );
    if (!updated) throw new NotFoundError('Note not found');
    return updated;
  }

  async crawlSummarizeWebsiteNote(
    sessionId: string,
    noteId: string,
    body: {
      websiteUrl: string;
      maxPages?: number;
      maxWords?: number;
      focusInstruction?: string;
      generateTitle?: boolean;
    }
  ): Promise<Note> {
    const note = await this.sessionManager.getNote(noteId);
    if (note?.sessionId !== sessionId) throw new NotFoundError('Note not found');
    if (!body?.websiteUrl?.trim()) {
      throw new BadRequestError('websiteUrl is required');
    }

    await this.llmService.ensureInitialized();
    const maxPages =
      typeof body?.maxPages === 'number' && body.maxPages > 0
        ? Math.min(20, Math.floor(body.maxPages))
        : undefined;
    const maxWords =
      typeof body?.maxWords === 'number' && body.maxWords > 0 ? body.maxWords : undefined;
    const focusInstruction =
      typeof body?.focusInstruction === 'string' ? body.focusInstruction.trim() : undefined;

    const updated = await this.sessionManager.summarizeWebsiteNoteAsync(
      noteId,
      this.llmService,
      body.websiteUrl,
      maxPages,
      maxWords,
      focusInstruction,
      body.generateTitle === true
    );

    if (!updated) throw new NotFoundError('Note not found');
    return updated;
  }

  async exportNoteMarkdown(
    sessionId: string,
    noteId: string
  ): Promise<{ markdownPath: string; attachmentPath?: string }> {
    const note = await this.sessionManager.getNote(noteId);
    if (note?.sessionId !== sessionId) throw new NotFoundError('Note not found');

    const exported = await this.sessionManager.exportNoteAsMarkdownAsync(noteId);
    if (!exported) throw new NotFoundError('Note not found');
    return exported;
  }

  async deleteNote(sessionId: string, noteId: string): Promise<void> {
    const note = await this.sessionManager.getNote(noteId);
    if (note?.sessionId !== sessionId) throw new NotFoundError('Note not found');
    await this.sessionManager.deleteNote(noteId);
  }

  async listNoteShares(sessionId: string): Promise<NoteSessionShare[]> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    return this.sessionManager.listNoteSessionSharesAsync(sessionId);
  }

  async linkNote(
    sessionId: string,
    noteId: string,
    body: { anchorMessageId: number }
  ): Promise<NoteSessionShare> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    if (typeof body?.anchorMessageId !== 'number')
      throw new BadRequestError('anchorMessageId is required');
    await this.sessionManager.setNoteAnchorAsync(sessionId, noteId, body.anchorMessageId, 'linked');
    const shares = await this.sessionManager.listNoteSessionSharesAsync(sessionId);
    const share = shares.find((s) => s.noteId === noteId);
    if (!share) throw new NotFoundError('Share not found');
    return share;
  }

  async unlinkNote(sessionId: string, noteId: string): Promise<void> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    await this.sessionManager.deactivateNoteShareAsync(sessionId, noteId);
  }

  async compressContext(
    sessionId: string,
    body: {
      toIndex: number;
      mode?: 'selected' | 'visible';
      selectedMarkdown?: string;
      compactPercent?: number;
      focusInstruction?: string;
    }
  ): Promise<{ note: Note; share: NoteSessionShare }> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    if (typeof body?.toIndex !== 'number') throw new BadRequestError('toIndex is required');
    await this.llmService.ensureInitialized();

    const allMessages = await this.sessionManager.listSessionMessages(sessionId);
    // Messages up to and including toIndex
    const boundedMessages = allMessages.slice(0, body.toIndex + 1);

    // Build source text
    let sourceText: string;
    if (body.mode === 'selected' && body.selectedMarkdown?.trim()) {
      sourceText = body.selectedMarkdown.trim();
    } else {
      const visibleMessages = boundedMessages.filter(
        (m) => !(m as any).archived && (m as any).hiddenFromLlm !== true
      );
      // If everything in the selected range is currently hidden from LLM,
      // still allow compression by using non-archived bounded messages.
      const sourceMessages =
        visibleMessages.length > 0
          ? visibleMessages
          : boundedMessages.filter((m) => !(m as any).archived);
      if (sourceMessages.length === 0) throw new BadRequestError('No messages to compress');
      sourceText = sourceMessages
        .map((m) => {
          const role = (m as any).role ?? ((m as any).isHuman ? 'user' : 'assistant');
          const content =
            typeof (m as any).content === 'string'
              ? (m as any).content
              : JSON.stringify((m as any).content ?? '');
          return `[${role}]: ${content}`;
        })
        .join('\n\n');
    }

    const sourceWordCount = sourceText
      .replaceAll(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean).length;
    const requestedCompactPercent =
      typeof body?.compactPercent === 'number' ? Math.floor(body.compactPercent) : 35;
    const clampedCompactPercent = Math.max(10, Math.min(90, requestedCompactPercent));
    const byPercent = Math.max(1, Math.round((sourceWordCount * clampedCompactPercent) / 100));
    const boundedByRaw = sourceWordCount > 1 ? Math.min(byPercent, sourceWordCount - 1) : byPercent;
    const maxWords = Math.max(1, Math.min(500, boundedByRaw));

    // Summarize via LLM
    const summary = await this.sessionManager.summarizeForContextAsync(
      this.llmService,
      sourceText,
      maxWords,
      body?.focusInstruction
    );

    // Create note with summary
    const agentId = (existing as any).agentId ?? (existing as any).agent_id ?? 'unknown';
    const note = await this.sessionManager.createNote({
      agentId,
      sessionId,
      title: 'Context summary',
      content: summary,
    });

    const titledNote = await this.sessionManager.generateNoteTitleForNoteAsync(
      note.id,
      this.llmService,
      body?.focusInstruction
    );
    const finalNote = titledNote ?? note;

    // Anchor to the message at toIndex
    const anchorMessage = boundedMessages[boundedMessages.length - 1];
    const anchorMessageId = (anchorMessage as any).id as number | undefined;
    if (!anchorMessageId) throw new BadRequestError('Could not determine anchor message id');

    const fromMessage = boundedMessages[0];
    const fromMessageId = (fromMessage as any).id as number | undefined;

    await this.sessionManager.setNoteAnchorAsync(
      sessionId,
      note.id,
      anchorMessageId,
      'compression',
      fromMessageId,
      anchorMessageId
    );

    // Hide all bounded messages from LLM
    await Promise.all(
      boundedMessages.map((m) =>
        (m as any).id != null
          ? this.sessionManager.setMessageHiddenFromLlm((m as any).id as number, true)
          : Promise.resolve(false)
      )
    );

    const shares = await this.sessionManager.listNoteSessionSharesAsync(sessionId);
    const share = shares.find((s) => s.noteId === finalNote.id);
    if (!share) throw new NotFoundError('Share not found after creation');
    return { note: finalNote, share };
  }

  async listMessageLinks(sessionId: string): Promise<MessageSessionLink[]> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    return this.sessionManager.listMessageSessionLinks(sessionId);
  }

  async createMessageLink(
    sessionId: string,
    body: { messageId: number }
  ): Promise<MessageSessionLink> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    if (typeof body?.messageId !== 'number') throw new BadRequestError('messageId is required');
    return this.sessionManager.createMessageSessionLink(body.messageId, sessionId);
  }

  async deleteMessageLink(sessionId: string, messageId: string): Promise<void> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    const parsedMessageId = Number.parseInt(messageId, 10);
    if (Number.isNaN(parsedMessageId)) throw new BadRequestError('messageId must be numeric');
    await this.sessionManager.deleteMessageSessionLink(parsedMessageId, sessionId);
  }

  async summarize(
    sessionId: string,
    body: {
      fromIndex: number;
      toIndex: number;
      title: string;
      summary: string;
      developerId?: string;
    }
  ): Promise<unknown> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    if (!body?.title) throw new BadRequestError('title is required');
    if (!body?.summary) throw new BadRequestError('summary is required');
    if (typeof body.fromIndex !== 'number' || typeof body.toIndex !== 'number') {
      throw new BadRequestError('fromIndex and toIndex must be numbers');
    }

    return this.sessionManager.createArtifact(
      sessionId,
      body.fromIndex,
      body.toIndex,
      body.summary,
      body.title,
      body.developerId ?? 'developer'
    );
  }

  async split(
    sessionId: string,
    body: { fromTimestamp: string; newAgentId?: string }
  ): Promise<ChatSession> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    if (!body.fromTimestamp) throw new BadRequestError('fromTimestamp is required');
    const msgIndex = Number.parseInt(body.fromTimestamp, 10);
    if (Number.isNaN(msgIndex))
      throw new BadRequestError('fromTimestamp must be a numeric message index');
    return this.sessionManager.splitSession(
      sessionId,
      msgIndex,
      body.newAgentId ?? 'developer'
    ) as Promise<ChatSession>;
  }

  async generateTitle(sessionId: string): Promise<{ title: string }> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    await this.llmService.ensureInitialized();
    const title = await this.sessionManager.generateTitle(sessionId, this.llmService);
    return { title };
  }

  async update(sessionId: string, body: Record<string, unknown>): Promise<ChatSession> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');

    if ('title' in body) {
      const requestedTitle = typeof body.title === 'string' ? body.title.trim() : '';
      const currentTitle = typeof existing.title === 'string' ? existing.title.trim() : '';
      const isTitleChange = requestedTitle !== currentTitle;

      if (existing.previousSessionId && isTitleChange) {
        throw new BadRequestError('Sessions with a parent session cannot be renamed');
      }
    }

    // When activatedTools are included, serialize them into the notes column as session meta.
    const updates: Record<string, unknown> = { ...body };
    if ('activatedTools' in body) {
      const { cleanNotes } = readSessionMeta((existing as any).notes as string | undefined);
      const meta = JSON.stringify({ activatedTools: body.activatedTools });
      const metaBlock = `${SESSION_META_PREFIX}${meta}${SESSION_META_SUFFIX}`;
      updates.notes = cleanNotes ? `${cleanNotes}\n${metaBlock}` : metaBlock;
      delete updates.activatedTools;
    }

    if ('title' in updates && typeof updates.title === 'string' && !existing.previousSessionId) {
      await this.sessionManager.setThreadTitle(sessionId, updates.title);
      delete updates.title;
    }

    const nextSession = {
      ...existing,
      ...updates,
      id: sessionId,
    };
    await this.sessionManager.saveSession(nextSession as any);
    const updated = await this.sessionManager.getSession(sessionId);
    return hydrateSession((updated ?? existing) as any);
  }

  async deleteWithOptions(
    sessionId: string,
    body?: { deleteUnsharedOwnedNotes?: boolean }
  ): Promise<void> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    const impact = await this.sessionManager.getSessionDeleteImpact(sessionId);
    if (impact.unsharedOwnedNotes.length > 0 && !body?.deleteUnsharedOwnedNotes) {
      throw new BadRequestError(
        'Session owns notes that are not shared with another session. Confirm deletion to remove those notes.'
      );
    }

    await this.sessionManager.deleteSession(sessionId, {
      deleteUnsharedOwnedNotes: body?.deleteUnsharedOwnedNotes,
    });
  }

  async delete(sessionId: string): Promise<void> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    const impact = await this.sessionManager.getSessionDeleteImpact(sessionId);
    if (impact.unsharedOwnedNotes.length > 0) {
      throw new BadRequestError(
        'Session owns notes that are not shared with another session. Confirm deletion to remove those notes.'
      );
    }

    await this.sessionManager.deleteSession(sessionId);
  }
}
