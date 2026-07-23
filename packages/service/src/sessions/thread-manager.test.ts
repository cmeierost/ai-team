import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession, IAgentManager, ITitleGenerator } from '@ai-team/core';
import { SessionManager } from './session-manager.js';
import { ThreadManager } from './thread-manager.js';
import type { IMessagesRepository, ISessionsRepository, INotesRepository } from '@ai-team/core';

// ---------------------------------------------------------------------------
// Helpers (mirrors session-manager.test.ts)
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

type StoredMessage = ChatMessage & {
  _messageId: number;
  _hiddenFromLlm?: boolean;
  _archived?: boolean;
};

function cloneSession(session: ChatSession): ChatSession {
  return {
    id: session.id,
    agentIds: [...(session.agentIds ?? [])],
    agentId: session.agentId,
    developerId: session.developerId,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    messageCount: session.messageCount,
    title: session.title,
    artifacts: [...(session.artifacts ?? [])],
    allowedFiles: [...(session.allowedFiles ?? [])],
    prioritizedFiles: session.prioritizedFiles ? [...session.prioritizedFiles] : undefined,
    tasks: session.tasks ? [...session.tasks] : undefined,
    notes: session.notes,
    ragConfig: session.ragConfig ? { ...session.ragConfig } : undefined,
    previousSessionId: session.previousSessionId,
    activeSessionId: session.activeSessionId,
    threadNavigationStack: session.threadNavigationStack
      ? session.threadNavigationStack.map((entry) => ({ ...entry }))
      : undefined,
    threadLastActiveAt: session.threadLastActiveAt,
    mergedFromSessionIds: session.mergedFromSessionIds
      ? [...session.mergedFromSessionIds]
      : undefined,
  };
}

function createInMemoryRepos() {
  const sessions = new Map<string, ChatSession>();
  const messagesBySession = new Map<string, StoredMessage[]>();
  let nextSessionId = 1;
  let nextMessageId = 1;

  const messages: IMessagesRepository = {
    async insertMessage(sessionId, message) {
      const list = messagesBySession.get(sessionId);
      if (!list) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const stored: StoredMessage = { ...message, _messageId: nextMessageId++ };
      list.push(stored);
      return { id: stored._messageId } as any;
    },
    async getSessionMessages(sessionId, includeArchived = false) {
      const list = messagesBySession.get(sessionId) ?? [];
      return list
        .filter((message) => includeArchived || !message._archived)
        .map(({ _messageId, _hiddenFromLlm, _archived, ...message }) => ({ ...message }));
    },
    async queryMessages(filter) {
      const base = filter.sessionId
        ? (messagesBySession.get(filter.sessionId) ?? [])
        : [...messagesBySession.values()].flat();
      let result = base.filter((message) => !message._archived);
      if (typeof (filter as any).isHuman === 'boolean') {
        result = result.filter((message) => message.isHuman === (filter as any).isHuman);
      }
      if (typeof (filter as any).hiddenFromLlm === 'boolean') {
        result = result.filter(
          (message) => Boolean(message._hiddenFromLlm) === (filter as any).hiddenFromLlm
        );
      }
      if (typeof (filter as any).limit === 'number') {
        result = result.slice(0, (filter as any).limit);
      }
      return result.map(({ _messageId, _hiddenFromLlm, _archived, ...message }) => ({
        ...message,
      }));
    },
    async archiveMessage() {
      return false;
    },
    async deleteMessage() {
      return false;
    },
    async searchMessages() {
      return [];
    },
    async getMessageById() {
      return null;
    },
    async setMessageHiddenFromLlm() {
      return false;
    },
    async updateMessageContent() {
      return false;
    },
    async createMessageSessionLink() {
      throw new Error('Not implemented');
    },
    async listMessageSessionLinks() {
      return [];
    },
    async deleteMessageSessionLink() {
      return false;
    },
    async addSessionSkill() {
      return undefined;
    },
    async getSessionSkills() {
      return [];
    },
    async setSessionSkillPaused() {
      return undefined;
    },
    async removeSessionSkill() {
      return undefined;
    },
    async updateToolCallLlmResult() {
      return undefined;
    },
  };

  const sessionRepo: ISessionsRepository = {
    async createSession(session) {
      const created: ChatSession = {
        ...session,
        id: `session-${nextSessionId++}`,
        messageCount: 0,
      };
      sessions.set(created.id, cloneSession(created));
      messagesBySession.set(created.id, []);
      return cloneSession(created);
    },
    async getSession(sessionId) {
      const session = sessions.get(sessionId);
      return session ? cloneSession(session) : null;
    },
    async updateSession(sessionId, updates) {
      const current = sessions.get(sessionId);
      if (!current) return;
      const merged = cloneSession({
        ...current,
        ...updates,
        id: current.id,
        messageCount: current.messageCount,
      });
      sessions.set(sessionId, merged);
    },
    async listSessions(filter) {
      let result = [...sessions.values()].map(cloneSession);
      if (filter?.developerId) {
        result = result.filter((session) => session.developerId === filter.developerId);
      }
      if (filter?.agentId) {
        result = result.filter(
          (session) =>
            ((session.agentIds ?? []) as string[]).includes(filter.agentId!) ||
            session.agentId === filter.agentId
        );
      }
      if (filter?.sortBy) {
        const key = filter.sortBy;
        result.sort((a, b) => {
          const left = String((a as any)[key] ?? '');
          const right = String((b as any)[key] ?? '');
          return left.localeCompare(right);
        });
        if (filter.sortOrder === 'desc') {
          result.reverse();
        }
      }
      if (typeof filter?.limit === 'number') {
        result = result.slice(0, filter.limit);
      }
      return result;
    },
    async addSessionAgent(sessionId, agentId) {
      const current = sessions.get(sessionId);
      if (!current) return;
      if (!(current.agentIds ?? []).includes(agentId)) {
        current.agentIds = [...(current.agentIds ?? []), agentId];
      }
    },
    async removeSessionAgent(sessionId, agentId) {
      const current = sessions.get(sessionId);
      if (!current) return;
      current.agentIds = (current.agentIds ?? []).filter((id) => id !== agentId);
    },
    async deleteSession(sessionId) {
      messagesBySession.delete(sessionId);
      return sessions.delete(sessionId);
    },
    async getSessionDeleteImpact() {
      return {
        sessionId: '',
        sessionsToDelete: [],
        sessionsToReparent: [],
        notesToDelete: [],
        notesToRescope: [],
        rootSessionId: null,
      } as any;
    },
  };

  const notes: INotesRepository = {
    async deleteAttachmentsIfPresentAsync() {
      return undefined;
    },
    async createNote() {
      throw new Error('Not implemented');
    },
    async getNote() {
      return null;
    },
    async listSessionNotes() {
      return [];
    },
    async listAgentNotes() {
      return [];
    },
    async listDashboardNotes() {
      return [];
    },
    async updateNote() {
      return undefined;
    },
    async setNoteAttachmentsAsync() {
      return undefined;
    },
    async deleteNote() {
      return false;
    },
    async searchNotes() {
      return [];
    },
    async listNoteSessionSharesBySessionAsync() {
      return [];
    },
    async updateNoteSessionShareAsync() {
      return undefined;
    },
  };

  return { messages, sessions: sessionRepo, notes };
}

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-tm-test-'));
  tempDirs.push(dir);
  return dir;
}

async function createManagersForTest(): Promise<{
  sessionManager: SessionManager;
  threadManager: ThreadManager;
}> {
  const workspaceRoot = await createTempWorkspace();
  const repos = createInMemoryRepos();
  const agentManager = {
    getAgentAsync: async () => null,
    getAllAgentsAsync: async () => [],
    resolveAgentForOperationAsync: async (query: string) => ({ id: query }),
  } as any as IAgentManager;
  const titleGenerator = {
    generateTitle: async (_id: string) => 'Auto Title',
    setThreadTitle: async () => undefined,
    summarizeForContextAsync: async (text: string, maxWords: number) => text.slice(0, maxWords * 5),
  } as any as ITitleGenerator;
  const sessionManager = new SessionManager(
    workspaceRoot,
    repos.messages,
    repos.sessions,
    agentManager,
    titleGenerator
  );
  const threadManager = new ThreadManager(sessionManager, repos.sessions, repos.notes);
  return { sessionManager, threadManager };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

// ---------------------------------------------------------------------------
// persisted active thread navigation
// ---------------------------------------------------------------------------

describe('ThreadManager active thread navigation', () => {
  let sessionManager: SessionManager;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    ({ sessionManager, threadManager } = await createManagersForTest());
  });

  it('resolves every member of a thread to the persisted active handoff target', async () => {
    const michael = await sessionManager.createSession('michael-brown', 'dev-1');
    const emily = await sessionManager.createHandoffSession(
      'emily-davis',
      'dev-1',
      michael.id
    );

    await threadManager.recordHandoff(michael.id, emily.id, {
      agentId: 'michael-brown',
      agentName: 'Michael Brown',
      sessionId: michael.id,
    });

    const fromRoot = await threadManager.resolveActiveSession(michael.id);
    const fromTarget = await threadManager.resolveActiveSession(emily.id);

    expect(fromRoot.session?.id).toBe(emily.id);
    expect(fromTarget.session?.id).toBe(emily.id);
    expect(fromRoot.state).toMatchObject({
      rootSessionId: michael.id,
      activeSessionId: emily.id,
      navigationStack: [{ sessionId: michael.id, agentId: 'michael-brown' }],
    });
  });

  it('persists a return to the delegating session and pops the navigation stack', async () => {
    const michael = await sessionManager.createSession('michael-brown', 'dev-1');
    const emily = await sessionManager.createHandoffSession(
      'emily-davis',
      'dev-1',
      michael.id
    );

    await threadManager.recordHandoff(michael.id, emily.id, {
      agentId: 'michael-brown',
      agentName: 'Michael Brown',
      sessionId: michael.id,
    });
    await threadManager.recordReturn(emily.id, michael.id);

    const resolved = await threadManager.resolveActiveSession(emily.id);

    expect(resolved.session?.id).toBe(michael.id);
    expect(resolved.state.navigationStack).toEqual([]);
  });

  it('seeds legacy threads deterministically at their newest leaf', async () => {
    const michael = await sessionManager.createSession('michael-brown', 'dev-1');
    const emily = await sessionManager.createHandoffSession(
      'emily-davis',
      'dev-1',
      michael.id
    );

    const resolved = await threadManager.resolveActiveSession(michael.id);

    expect(resolved.session?.id).toBe(emily.id);
    expect(resolved.state.rootSessionId).toBe(michael.id);
  });

  it('resumes the most recently navigated thread at its active cursor', async () => {
    const firstRoot = await sessionManager.createSession('michael-brown', 'dev-1');
    const firstTarget = await sessionManager.createHandoffSession(
      'emily-davis',
      'dev-1',
      firstRoot.id
    );
    await sessionManager.createSession('sarah-lee', 'dev-1');

    await threadManager.recordHandoff(firstRoot.id, firstTarget.id, {
      agentId: 'michael-brown',
      agentName: 'Michael Brown',
      sessionId: firstRoot.id,
    });

    const latest = await threadManager.resolveLatestActiveSession('dev-1');

    expect(latest?.id).toBe(firstTarget.id);
  });
});

// ---------------------------------------------------------------------------
// findAgentSessionInChain
// ---------------------------------------------------------------------------

describe('ThreadManager.findAgentSessionInChain', () => {
  let sessionManager: SessionManager;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    ({ sessionManager, threadManager } = await createManagersForTest());
  });

  it('returns the session when the root session belongs to the target agent', async () => {
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const found = await threadManager.findAgentSessionInChain(michaelS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('returns null when the target agent has no session in the chain', async () => {
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const found = await threadManager.findAgentSessionInChain(michaelS1.id, 'sarah-morgan');
    expect(found).toBeNull();
  });

  it('walks the chain and finds an earlier session for the target agent', async () => {
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);

    const found = await threadManager.findAgentSessionInChain(alexS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('finds a session two hops back in the chain', async () => {
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);
    const sarahS1 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', alexS1.id);

    const found = await threadManager.findAgentSessionInChain(sarahS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('finds an intermediate session, not a leaf or root', async () => {
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);
    const sarahS1 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', alexS1.id);

    const found = await threadManager.findAgentSessionInChain(sarahS1.id, 'alex-johnson');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(alexS1.id);
  });

  it('returns the starting session itself when it belongs to the target agent', async () => {
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);

    const found = await threadManager.findAgentSessionInChain(alexS1.id, 'alex-johnson');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(alexS1.id);
  });
});

// ---------------------------------------------------------------------------
// getSessionChain
// ---------------------------------------------------------------------------

describe('ThreadManager.getSessionChain', () => {
  let sessionManager: SessionManager;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    ({ sessionManager, threadManager } = await createManagersForTest());
  });

  it('returns a single-session chain for a root session', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const chain = await threadManager.getSessionChain(s1.id);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe(s1.id);
  });

  it('returns sessions ordered root → leaf for a two-session chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);

    const chain = await threadManager.getSessionChain(s2.id);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(s1.id);
    expect(chain[1].id).toBe(s2.id);
  });

  it('returns sessions ordered root → leaf for a three-session chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);
    const s3 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', s2.id);

    const chain = await threadManager.getSessionChain(s3.id);
    expect(chain).toHaveLength(3);
    expect(chain[0].id).toBe(s1.id);
    expect(chain[1].id).toBe(s2.id);
    expect(chain[2].id).toBe(s3.id);
  });

  it('can start the walk from any session in the chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);
    const s3 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', s2.id);

    const chainFromMiddle = await threadManager.getSessionChain(s2.id);
    expect(chainFromMiddle).toHaveLength(3);
    expect(chainFromMiddle[0].id).toBe(s1.id);
    expect(chainFromMiddle[1].id).toBe(s2.id);
    expect(chainFromMiddle[2].id).toBe(s3.id);
  });
});

// ---------------------------------------------------------------------------
// getThreadGraphData
// ---------------------------------------------------------------------------

describe('ThreadManager.getThreadGraphData', () => {
  let sessionManager: SessionManager;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    ({ sessionManager, threadManager } = await createManagersForTest());
  });

  it('filters handoff bridge messages and keeps timeline messages sorted', async () => {
    const sessionA = await sessionManager.createSession('michael-brown', 'dev-1');
    const sessionB = await sessionManager.createHandoffSession(
      'alex-johnson',
      'dev-1',
      sessionA.id
    );

    await sessionManager.appendMessage(sessionA.id, {
      timestamp: '2026-03-09T09:00:00.000Z',
      from: 'michael-brown',
      to: 'alex-johnson',
      isHuman: false,
      content: 'briefing duplicate',
      handoffId: 'handoff-1',
      handoffType: 'agent-briefing',
      handoffFromSessionId: sessionA.id,
      handoffToSessionId: sessionB.id,
    } as any);

    await sessionManager.appendMessage(sessionB.id, {
      timestamp: '2026-03-09T09:00:00.000Z',
      from: 'michael-brown',
      to: 'alex-johnson',
      isHuman: false,
      content: 'briefing duplicate',
      handoffId: 'handoff-1',
      handoffType: 'agent-briefing',
      handoffFromSessionId: sessionA.id,
      handoffToSessionId: sessionB.id,
    } as any);

    await sessionManager.appendMessage(sessionA.id, {
      timestamp: '2026-03-09T09:02:00.000Z',
      from: 'dev-1',
      to: 'michael-brown',
      isHuman: true,
      content: 'real session-a message',
    } as any);

    await sessionManager.appendMessage(sessionB.id, {
      timestamp: '2026-03-09T09:01:00.000Z',
      from: 'dev-1',
      to: 'alex-johnson',
      isHuman: true,
      content: 'real session-b message',
    } as any);

    const graph = await threadManager.getThreadGraphData(sessionB.id);
    const graphSessionA = graph.sessions.find((s) => s.sessionId === sessionA.id);
    const graphSessionB = graph.sessions.find((s) => s.sessionId === sessionB.id);
    const handoff = graph.handoffs[0];

    expect(graph.handoffs).toHaveLength(1);
    expect(handoff?.fromSessionId).toBe(sessionA.id);
    expect(handoff?.toSessionId).toBe(sessionB.id);
    expect(graphSessionA?.messageCount).toBe(1);
    expect(graphSessionB?.messageCount).toBe(1);
    expect(graphSessionA?.messages[0]?.content).toBe('real session-a message');
    expect(graphSessionB?.messages[0]?.content).toBe('real session-b message');
  });
});
