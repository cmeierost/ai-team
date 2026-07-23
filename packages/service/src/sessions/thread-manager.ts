import {
  ChatMessage,
  ChatSession,
  HandoffEdge,
  type IThreadManager,
  type ISessionManager,
  type ISessionsRepository,
  type INotesRepository,
  type SessionNavEntry,
  type SessionThreadState,
} from '@ai-team/core';

export interface SessionThreadGraphSession {
  sessionId: string;
  agentIds: string[];
  developerId: string | null;
  title: string | null;
  startedAt: string;
  lastActivityAt: string;
  previousSessionId: string | null;
  mergedFromSessionIds: string[] | null;
  messageCount: number;
  messages: ChatMessage[];
}

export interface SessionThreadGraphData {
  rootSessionId: string;
  depth: number;
  sessions: SessionThreadGraphSession[];
  handoffs: HandoffEdge[];
}

export class ThreadManager implements IThreadManager {
  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly sessions: ISessionsRepository,
    private readonly notes: INotesRepository
  ) {}

  async resolveActiveSession(
    sessionId: string
  ): Promise<{ session: ChatSession | null; state: SessionThreadState }> {
    const thread = await this.getSessionChain(sessionId);
    const root = thread[0];
    if (!root) {
      return {
        session: null,
        state: {
          rootSessionId: sessionId,
          activeSessionId: sessionId,
          navigationStack: [],
          updatedAt: new Date(0).toISOString(),
        },
      };
    }

    const storedActive = root.activeSessionId
      ? thread.find((session) => session.id === root.activeSessionId)
      : undefined;
    const active = storedActive ?? this.selectLegacyActiveSession(thread);
    const state: SessionThreadState = {
      rootSessionId: root.id,
      activeSessionId: active.id,
      navigationStack: storedActive
        ? [...(root.threadNavigationStack ?? [])]
        : this.buildLegacyNavigationStack(thread, active.id),
      updatedAt: root.threadLastActiveAt ?? active.lastActivityAt ?? active.startedAt,
    };

    if (!storedActive) {
      await this.persistThreadState(state);
    }

    return { session: active, state };
  }

  async resolveLatestActiveSession(developerId?: string): Promise<ChatSession | null> {
    const sessions = await this.sessions.listSessions(developerId ? { developerId } : undefined);
    const roots = sessions.filter((session) => !session.previousSessionId);
    const latestRoot = [...roots].sort(
      (left, right) =>
        Number(Boolean(right.threadLastActiveAt)) - Number(Boolean(left.threadLastActiveAt)) ||
        (right.threadLastActiveAt ?? right.lastActivityAt).localeCompare(
          left.threadLastActiveAt ?? left.lastActivityAt
        ) || right.id.localeCompare(left.id)
    )[0];
    if (!latestRoot) return null;
    return (await this.resolveActiveSession(latestRoot.id)).session;
  }

  async resolveLatestSessionWithActivity(developerId?: string): Promise<ChatSession | null> {
    const sessions = await this.sessions.listSessions(developerId ? { developerId } : undefined);
    const candidates = await Promise.all(
      sessions.map(async (session) => {
        const messages = await this.sessionManager.getSessionMessages(session.id);
        const lastActivity = messages.reduce<string | null>((latest, message) => {
          const hasMessage = message.content.trim().length > 0;
          const hasToolCall = (message.tool_calls?.length ?? 0) > 0;
          if (!hasMessage && !hasToolCall) {
            return latest;
          }
          return !latest || message.timestamp > latest ? message.timestamp : latest;
        }, null);
        return lastActivity ? { session, lastActivity } : null;
      })
    );

    return candidates
      .filter((candidate): candidate is { session: ChatSession; lastActivity: string } => Boolean(candidate))
      .sort(
        (left, right) =>
          right.lastActivity.localeCompare(left.lastActivity) || right.session.id.localeCompare(left.session.id)
      )[0]?.session ?? null;
  }

  async recordHandoff(
    fromSessionId: string,
    toSessionId: string,
    returnFrame: SessionNavEntry
  ): Promise<SessionThreadState> {
    const target = await this.sessionManager.getSession(toSessionId);
    if (!target) {
      throw new Error(`Handoff target session ${toSessionId} not found`);
    }

    const thread = await this.getSessionChain(fromSessionId);
    const root = thread[0];
    if (!root) {
      throw new Error(`Handoff source session ${fromSessionId} not found`);
    }
    if (!thread.some((session) => session.id === target.id)) {
      throw new Error(
        `Session ${toSessionId} does not belong to thread ${root.id}`
      );
    }

    const state: SessionThreadState = {
      rootSessionId: root.id,
      activeSessionId: target.id,
      navigationStack: [
        ...(root.activeSessionId
          ? (root.threadNavigationStack ?? [])
          : this.buildLegacyNavigationStack(thread, fromSessionId)),
        { ...returnFrame },
      ],
      updatedAt: new Date().toISOString(),
    };
    await this.persistThreadState(state);
    return state;
  }

  async recordReturn(
    fromSessionId: string,
    toSessionId: string,
    returnFrame: SessionNavEntry
  ): Promise<SessionThreadState> {
    return this.recordHandoff(fromSessionId, toSessionId, returnFrame);
  }

  async recordBack(fromSessionId: string): Promise<SessionThreadState> {
    const resolved = await this.resolveActiveSession(fromSessionId);
    const top = resolved.state.navigationStack.at(-1);
    if (!top) {
      throw new Error('No previous agent to return to.');
    }
    const target = await this.sessionManager.getSession(top.sessionId);
    if (!target) {
      throw new Error(`Previous session ${top.sessionId} not found`);
    }

    const state: SessionThreadState = {
      ...resolved.state,
      activeSessionId: top.sessionId,
      navigationStack: resolved.state.navigationStack.slice(0, -1),
      updatedAt: new Date().toISOString(),
    };
    await this.persistThreadState(state);
    return state;
  }

  async getSessionChain(sessionId: string): Promise<ChatSession[]> {
    // 1. Walk upward to find the root session.
    const upwardChain: ChatSession[] = [];
    const visited = new Set<string>();
    let current: ChatSession | null = await this.sessionManager.getSession(sessionId);

    while (current) {
      if (visited.has(current.id)) break; // cycle guard
      visited.add(current.id);
      upwardChain.push(current);
      if (!current.previousSessionId) break;
      current = await this.sessionManager.getSession(current.previousSessionId);
    }

    upwardChain.reverse(); // root first
    const root = upwardChain[0];
    if (!root) return [];

    // 2. BFS downward from root to collect all descendants.
    const allSessions = await this.sessions.listSessions(
      root.developerId ? { developerId: root.developerId } : undefined
    );

    const childrenOf = new Map<string, ChatSession[]>();
    for (const s of allSessions) {
      if (!s.previousSessionId) continue;
      const children = childrenOf.get(s.previousSessionId) ?? [];
      children.push(s);
      childrenOf.set(s.previousSessionId, children);
    }

    // BFS from root
    const result: ChatSession[] = [];
    const queue: ChatSession[] = [root];
    const seen = new Set<string>([root.id]);

    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);
      for (const child of childrenOf.get(node.id) ?? []) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          queue.push(child);
        }
      }
    }

    return result;
  }

  async getThreadGraphData(sessionId: string): Promise<SessionThreadGraphData> {
    const chain = await this.getSessionChain(sessionId);

    const sessionsWithMessages = await Promise.all(
      chain.map(async (session) => {
        const allMessages = await this.sessionManager.getSessionMessages(session.id);
        const timelineMessages = this.sortMessagesByTimestamp(
          allMessages.filter((message) => this.isTimelineMessage(message))
        );

        return {
          session,
          allMessages,
          timelineMessages,
        };
      })
    );

    interface RawHandoffEdge {
      handoffId: string;
      fromSessionId: string | null;
      toSessionId: string | null;
      fromAgentIds: string[];
      toAgentIds: string[];
      createdAt: string;
    }

    const handoffMap = new Map<string, RawHandoffEdge>();
    for (const entry of sessionsWithMessages) {
      for (const msg of entry.allMessages) {
        if (!msg.handoffId) continue;

        const existing = handoffMap.get(msg.handoffId);
        if (existing) continue;

        handoffMap.set(msg.handoffId, {
          handoffId: msg.handoffId,
          fromSessionId: msg.handoffFromSessionId ?? null,
          toSessionId: msg.handoffToSessionId ?? null,
          fromAgentIds: [],
          toAgentIds: [],
          createdAt: msg.timestamp,
        });
      }
    }

    for (const edge of handoffMap.values()) {
      if (edge.fromSessionId) {
        const session = sessionsWithMessages.find(
          (entry) => entry.session.id === edge.fromSessionId
        );
        if (session) {
          edge.fromAgentIds = this.getSessionAgentIds(session.session);
        }
      }

      if (edge.toSessionId) {
        const session = sessionsWithMessages.find((entry) => entry.session.id === edge.toSessionId);
        if (session) {
          edge.toAgentIds = this.getSessionAgentIds(session.session);
        }
      }
    }

    const handoffs: HandoffEdge[] = Array.from(handoffMap.values()).map((edge) => ({
      fromSessionId: edge.fromSessionId ?? '',
      toSessionId: edge.toSessionId ?? '',
      agentId: edge.toAgentIds[0] ?? edge.fromAgentIds[0] ?? '',
      createdAt: edge.createdAt,
    }));

    return {
      rootSessionId: sessionsWithMessages[0]?.session.id ?? sessionId,
      depth: sessionsWithMessages.length,
      handoffs,
      sessions: sessionsWithMessages.map(({ session, timelineMessages }) => ({
        sessionId: session.id,
        agentIds: this.getSessionAgentIds(session),
        developerId: session.developerId ?? null,
        title: session.title ?? null,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        previousSessionId: session.previousSessionId ?? null,
        mergedFromSessionIds: session.mergedFromSessionIds ?? null,
        messageCount: timelineMessages.length,
        messages: timelineMessages,
      })),
    };
  }

  async resolveHandoffSession(
    targetAgentId: string,
    currentSessionId: string,
    developerId: string
  ): Promise<{ session: ChatSession; isNew: boolean }> {
    const chain = await this.getSessionChain(currentSessionId);
    const existing = chain.find((s) => {
      const ids: string[] = (s as any).agentIds ?? (s.agentId ? [(s as any).agentId] : []);
      return ids.includes(targetAgentId);
    });
    if (existing) return { session: existing, isNew: false };

    // First time reaching this agent in this thread — extend the spine.
    const session = await this.sessionManager.createHandoffSession(
      targetAgentId,
      developerId,
      currentSessionId
    );
    return { session, isNew: true };
  }

  async findAgentSessionInChain(
    fromSessionId: string,
    agentId: string
  ): Promise<ChatSession | null> {
    const visited = new Set<string>();
    let current: ChatSession | null = await this.sessionManager.getSession(fromSessionId);

    while (current) {
      if (visited.has(current.id)) break; // cycle guard
      visited.add(current.id);

      const ids = this.getSessionAgentIds(current);

      if (ids.includes(agentId)) return current;

      if (!current.previousSessionId) break;
      current = await this.sessionManager.getSession(current.previousSessionId);
    }

    return null;
  }

  async mergeSessionsIntoOlder(
    olderSessionId: string,
    newerSessionId: string
  ): Promise<ChatSession> {
    const olderSession = await this.sessionManager.getSession(olderSessionId);
    const newerSession = await this.sessionManager.getSession(newerSessionId);

    if (!olderSession || !newerSession) {
      throw new Error('Both sessions must exist');
    }

    if (olderSession.developerId !== newerSession.developerId) {
      throw new Error('Cannot merge sessions from different developers');
    }

    // Load messages from newer session and copy to older
    const newerMessages = await this.sessionManager.getSessionMessages(newerSessionId);
    for (const message of newerMessages) {
      await this.sessionManager.appendMessage(olderSessionId, message);
    }

    // Merge agentIds arrays
    const mergedAgentIds = new Set([...olderSession.agentIds, ...newerSession.agentIds]);

    for (const agentId of mergedAgentIds) {
      await this.sessions.addSessionAgent(olderSessionId, agentId);
    }

    // Track merge history and merge artifacts/files
    const mergedFromSessionIds = [
      ...(olderSession.mergedFromSessionIds || []),
      newerSessionId,
      ...(newerSession.mergedFromSessionIds || []),
    ];

    await this.sessions.updateSession(olderSessionId, {
      lastActivityAt: new Date().toISOString(),
      mergedFromSessionIds,
      artifacts: [...new Set([...olderSession.artifacts, ...newerSession.artifacts])],
      allowedFiles: [...new Set([...olderSession.allowedFiles, ...newerSession.allowedFiles])],
    });

    // Move notes to the surviving session before deleting the merged-away session.
    const newerSessionNotes = await this.notes.listSessionNotes(newerSessionId);
    for (const note of newerSessionNotes) {
      await this.notes.updateNote(note.id, {
        sessionId: olderSessionId,
        sharedSessionIds: (note.sharedSessionIds ?? []).filter(
          (sharedSessionId) => sharedSessionId !== olderSessionId
        ),
      });
    }

    // Delete newer session
    await this.sessions.deleteSession(newerSessionId);

    const updatedSession = await this.sessionManager.getSession(olderSessionId);
    if (!updatedSession) {
      throw new Error(`Failed to retrieve merged session ${olderSessionId}`);
    }

    return updatedSession;
  }

  async splitSession(
    sessionId: string,
    atIndex: number,
    developerId: string
  ): Promise<ChatSession> {
    const currentSession = await this.sessionManager.getSession(sessionId);
    if (!currentSession) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const messages = await this.sessionManager.getSessionMessages(sessionId);
    if (atIndex < 0 || atIndex >= messages.length) {
      throw new Error(`Invalid split index ${atIndex}`);
    }

    // Create new session
    const newSession = await this.sessionManager.createSession(currentSession.agentId, developerId);

    // Copy messages from split point to new session
    const newMessages = messages.slice(atIndex);
    for (const message of newMessages) {
      await this.sessionManager.appendMessage(newSession.id, message);
    }

    // Delete messages from old session (split point onwards)
    for (let i = messages.length - 1; i >= atIndex; i--) {
      await this.sessionManager.deleteSessionMessage(sessionId, messages[i].timestamp);
    }

    return newSession;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isTimelineMessage(message: ChatMessage): boolean {
    return !message.handoffId && !message.handoffType;
  }

  private sortMessagesByTimestamp(messages: ChatMessage[]): ChatMessage[] {
    return messages
      .map((message, index) => ({
        message,
        index,
        timestampMs: Number.isFinite(Date.parse(message.timestamp))
          ? Date.parse(message.timestamp)
          : 0,
      }))
      .sort((left, right) => left.timestampMs - right.timestampMs || left.index - right.index)
      .map((entry) => entry.message);
  }

  private getSessionAgentIds(session: ChatSession): string[] {
    if (Array.isArray(session.agentIds) && session.agentIds.length > 0) {
      return session.agentIds;
    }

    return session.agentId ? [session.agentId] : [];
  }

  private selectLegacyActiveSession(thread: ChatSession[]): ChatSession {
    const parentIds = new Set(
      thread.map((session) => session.previousSessionId).filter((id): id is string => Boolean(id))
    );
    const leaves = thread.filter((session) => !parentIds.has(session.id));
    return [...(leaves.length > 0 ? leaves : thread)].sort(
      (left, right) =>
        right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id)
    )[0];
  }

  private buildLegacyNavigationStack(
    thread: ChatSession[],
    activeSessionId: string
  ): SessionNavEntry[] {
    const byId = new Map(thread.map((session) => [session.id, session]));
    const path: ChatSession[] = [];
    let current = byId.get(activeSessionId);
    while (current?.previousSessionId) {
      const parent = byId.get(current.previousSessionId);
      if (!parent) break;
      path.unshift(parent);
      current = parent;
    }
    return path.map((session) => ({
      agentId: session.agentId,
      agentName: session.agentId,
      sessionId: session.id,
    }));
  }

  private async persistThreadState(state: SessionThreadState): Promise<void> {
    await this.sessions.updateSession(state.rootSessionId, {
      activeSessionId: state.activeSessionId,
      threadNavigationStack: state.navigationStack,
      threadLastActiveAt: state.updatedAt,
    });
  }
}
