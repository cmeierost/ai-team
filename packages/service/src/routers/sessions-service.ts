import type {
  ISessionsService,
  ChatSession,
  ChatMessage,
  HandoffEdge,
  SessionThread,
} from '@ai-team/api-client';
import type { AgentManager } from '@ai-team/infrastructure';
import type { LlmService } from '@ai-team/infrastructure';
import type { SessionManager } from '../session-manager.js';
import { BadRequestError, NotFoundError } from '../http-errors.js';

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
    private readonly agentManager: AgentManager,
    private readonly llmService: LlmService
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
    const chain = await this.sessionManager.getSessionChain(sessionId);
    const sessions = await Promise.all(
      chain.map(async (s: any) => {
        const messages = await this.sessionManager.getSessionMessages(s.id);
        const ids = s.agentIds ?? (s.agentId ? [s.agentId] : []);
        const agentNames = await Promise.all(
          ids.map(async (id: string) => {
            try {
              return (await this.agentManager.getAgentAsync(id))?.name ?? id;
            } catch {
              return id;
            }
          })
        );
        return {
          sessionId: s.id,
          agentIds: ids,
          agentNames,
          developerId: s.developerId ?? null,
          title: s.title ?? null,
          startedAt: s.startedAt,
          lastActivityAt: s.lastActivityAt,
          previousSessionId: s.previousSessionId ?? null,
          mergedFromSessionIds: s.mergedFromSessionIds ?? null,
          messageCount: messages.length,
          messages,
        };
      })
    );
    const handoffMap = new Map<string, HandoffEdge>();
    for (const sess of sessions) {
      for (const msg of sess.messages as any[]) {
        if (msg.handoffId) {
          const edge = handoffMap.get(msg.handoffId) ?? {
            handoffId: msg.handoffId,
            fromSessionId: null,
            toSessionId: null,
            fromAgentIds: [],
            toAgentIds: [],
          };
          if (msg.handoffType === 'agent-briefing' && msg.handoffFromSessionId)
            (edge as any).fromSessionId = msg.handoffFromSessionId;
          if (msg.handoffType === 'user-acknowledgment' && msg.handoffToSessionId)
            (edge as any).toSessionId = msg.handoffToSessionId;
          handoffMap.set(msg.handoffId, edge);
        }
      }
    }
    for (const [, edge] of handoffMap) {
      if ((edge as any).fromSessionId) {
        const s = sessions.find((x) => x.sessionId === (edge as any).fromSessionId);
        if (s) (edge as any).fromAgentIds = s.agentIds;
      }
      if ((edge as any).toSessionId) {
        const s = sessions.find((x) => x.sessionId === (edge as any).toSessionId);
        if (s) (edge as any).toAgentIds = s.agentIds;
      }
    }
    return {
      rootSessionId: sessions[0]?.sessionId ?? sessionId,
      currentSessionId: sessionId,
      depth: sessions.length,
      handoffs: Array.from(handoffMap.values()),
      sessions,
    } as unknown as SessionThread;
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
    const msgIndex = parseInt(body.fromTimestamp, 10);
    if (isNaN(msgIndex)) throw new BadRequestError('fromTimestamp must be a numeric message index');
    return this.sessionManager.splitSession(
      sessionId,
      msgIndex,
      body.newAgentId ?? 'developer'
    ) as Promise<ChatSession>;
  }

  async generateTitle(sessionId: string): Promise<{ title: string }> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    const title = await this.sessionManager.generateTitle(sessionId, this.llmService);
    return { title };
  }

  async update(sessionId: string, body: Record<string, unknown>): Promise<ChatSession> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    await this.sessionManager.saveSession({ ...(existing as any), ...body, id: sessionId } as any);
    const updated = await this.sessionManager.getSession(sessionId);
    return hydrateSession((updated ?? existing) as any);
  }

  async delete(sessionId: string): Promise<void> {
    const existing = await this.sessionManager.getSession(sessionId);
    if (!existing) throw new NotFoundError('Session not found');
    await this.sessionManager.deleteSession(sessionId);
  }
}
