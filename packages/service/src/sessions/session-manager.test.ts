import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession, IAgentManager, ITitleGenerator } from '@ai-team/core';
import { SessionManager } from './session-manager.js';
import type { IMessagesRepository, ISessionsRepository, INotesRepository } from '@ai-team/core';

// ---------------------------------------------------------------------------
// Helpers
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
    async archiveMessage(sessionId, messageTimestamp) {
      const message = (messagesBySession.get(sessionId) ?? []).find(
        (entry) => entry.timestamp === messageTimestamp
      );
      if (!message) return false;
      message._archived = true;
      return true;
    },
    async deleteMessage(sessionId, messageTimestamp) {
      const list = messagesBySession.get(sessionId) ?? [];
      const index = list.findIndex((entry) => entry.timestamp === messageTimestamp);
      if (index < 0) return false;
      list.splice(index, 1);
      return true;
    },
    async searchMessages(query, sessionId) {
      const haystack = await this.getSessionMessages(sessionId ?? '');
      return haystack.filter((message) => (message.content ?? '').includes(query));
    },
    async getMessageById(messageId) {
      for (const list of messagesBySession.values()) {
        const found = list.find((entry) => entry._messageId === messageId);
        if (found) {
          const { _messageId, _hiddenFromLlm, _archived, ...message } = found;
          return { ...message };
        }
      }
      return null;
    },
    async setMessageHiddenFromLlm(messageId, hidden) {
      for (const list of messagesBySession.values()) {
        const found = list.find((entry) => entry._messageId === messageId);
        if (found) {
          found._hiddenFromLlm = hidden;
          return true;
        }
      }
      return false;
    },
    async updateMessageContent(messageId, newContent) {
      for (const list of messagesBySession.values()) {
        const found = list.find((entry) => entry._messageId === messageId);
        if (found) {
          found.content = newContent;
          return true;
        }
      }
      return false;
    },
    async createMessageSessionLink() {
      throw new Error('Not implemented in session-manager test fake');
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
      throw new Error('Not implemented in session-manager test fake');
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

async function createSessionManagerForTest(): Promise<SessionManager> {
  const workspaceRoot = await createTempWorkspace();
  const repos = createInMemoryRepos();
  const agentManager = {
    getAgentAsync: async () => null,
    getAllAgentsAsync: async () => [],
    resolveAgentForOperationAsync: async (query: string) => ({ id: query }),
  } as any as IAgentManager;
  const sessionsRepo = repos.sessions;
  const messagesRepo = repos.messages;
  const titleGenerator = {
    generateTitle: async (sessionId: string, llmService: unknown) => {
      let generated: string | undefined;
      if (llmService && typeof (llmService as any).generateTitle === 'function') {
        try {
          generated = await (llmService as any).generateTitle([]);
        } catch {
          // fall through to fallback
        }
      }
      const normalized = (generated || '').trim();
      let title: string;
      if (normalized && !/^Let\b/i.test(normalized)) {
        title = normalized;
      } else {
        // Context-aware fallback: read messages for keywords
        const messages = await messagesRepo.getSessionMessages(sessionId, true);
        const allContent = messages.map((m: any) => m.content || '').join(' ');
        if (/retire|offboard|decommission|sunset/i.test(allContent)) {
          title = 'Plan Agent Retirement';
        } else if (/archive/i.test(allContent)) {
          title = 'Archive Old Data';
        } else {
          title = 'Fix Session Issue';
        }
      }
      await sessionsRepo.updateSession(sessionId, { title });
      // Propagate to all sessions in thread (walk up, then BFS down)
      let current: ChatSession | null = await sessionsRepo.getSession(sessionId);
      const chainIds = new Set<string>();
      while (current) {
        chainIds.add(current.id);
        if (!current.previousSessionId) break;
        current = await sessionsRepo.getSession(current.previousSessionId);
      }
      const allSessions = await sessionsRepo.listSessions();
      const childrenOf = new Map<string, string[]>();
      for (const s of allSessions) {
        if (s.previousSessionId) {
          const children = childrenOf.get(s.previousSessionId) || [];
          children.push(s.id);
          childrenOf.set(s.previousSessionId, children);
        }
      }
      // Find root
      let rootId = sessionId;
      current = await sessionsRepo.getSession(sessionId);
      while (current?.previousSessionId) {
        rootId = current.previousSessionId;
        current = await sessionsRepo.getSession(current.previousSessionId);
      }
      // BFS from root
      const queue = [rootId];
      const seen = new Set([rootId]);
      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        await sessionsRepo.updateSession(nodeId, { title });
        for (const childId of childrenOf.get(nodeId) || []) {
          if (!seen.has(childId)) {
            seen.add(childId);
            queue.push(childId);
          }
        }
      }
      return title;
    },
    setThreadTitle: async (sessionId: string, title: string) => {
      await sessionsRepo.updateSession(sessionId, { title });
    },
    summarizeForContextAsync: async (text: string, maxWords: number) => text.slice(0, maxWords * 5),
  } as any as ITitleGenerator;
  return new SessionManager(
    workspaceRoot,
    repos.messages,
    repos.sessions,
    agentManager,
    titleGenerator
  );
}

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-sm-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

// ---------------------------------------------------------------------------
// listRecentSessions
// ---------------------------------------------------------------------------

describe('SessionManager.listRecentSessions', () => {
  let sessionManager: SessionManager;

  beforeEach(async () => {
    sessionManager = await createSessionManagerForTest();
  });

  it('can scope recent sessions by developer id', async () => {
    const dev1Session = await sessionManager.createSession('clara-bishop', 'dev-1');
    const _dev2Session = await sessionManager.createSession('michael-brown', 'dev-2');

    const scoped = await sessionManager.listRecentSessions(10, 'dev-1');

    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.id).toBe(dev1Session.id);
    expect(scoped[0]?.developerId).toBe('dev-1');
  });

  it('resolves latest resumable session scoped-first then global', async () => {
    const dev1Session = await sessionManager.createSession('clara-bishop', 'dev-1');
    const dev2Session = await sessionManager.createSession('michael-brown', 'dev-2');

    await sessionManager.saveSession({
      ...dev1Session,
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    } as any);
    await sessionManager.saveSession({
      ...dev2Session,
      lastActivityAt: '2026-01-01T00:00:01.000Z',
    } as any);

    const scoped = await sessionManager.resolveLatestSessionForResume('dev-1');
    expect(scoped?.id).toBe(dev1Session.id);

    const fallbackGlobal = await sessionManager.resolveLatestSessionForResume('missing-dev');
    expect(fallbackGlobal?.id).toBe(dev2Session.id);
  });
});

// ---------------------------------------------------------------------------
// title generation + persistence
// ---------------------------------------------------------------------------

describe('SessionManager title generation', () => {
  let sessionManager: SessionManager;

  beforeEach(async () => {
    sessionManager = await createSessionManagerForTest();
  });

  it('persists a fallback title when llm returns whitespace', async () => {
    const session = await sessionManager.createSession('michael-brown', 'dev-1');

    await sessionManager.appendMessage(session.id, {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: 'michael-brown',
      isHuman: true,
      content: 'please fix session title generation behavior',
    } as any);

    const generatedTitle = await sessionManager.appendMessage(
      session.id,
      {
        timestamp: new Date().toISOString(),
        from: 'human',
        to: 'michael-brown',
        isHuman: true,
        content: 'set a better title and persist it',
      } as any,
      {
        generateTitle: async () => '   ',
      }
    );

    expect(generatedTitle).toBeTruthy();
    expect(generatedTitle!.trim().length).toBeGreaterThan(0);

    const persisted = await sessionManager.getSession(session.id);
    expect(persisted?.title).toBe(generatedTitle);
    expect(persisted?.title).toMatch(
      /^(Fix|Create|Add|Update|Improve|Refactor|Debug|Test|Write|Implement|Build|Generate|Set|Make)\b/
    );
  });

  it('persists a fallback title when llm throws', async () => {
    const session = await sessionManager.createSession('michael-brown', 'dev-1');

    await sessionManager.appendMessage(session.id, {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: 'michael-brown',
      isHuman: true,
      content: 'fix the failing title prompt',
    } as any);

    const generatedTitle = await sessionManager.appendMessage(
      session.id,
      {
        timestamp: new Date().toISOString(),
        from: 'human',
        to: 'michael-brown',
        isHuman: true,
        content: 'improve fallback behavior for bad responses',
      } as any,
      {
        generateTitle: async () => {
          throw new Error('LLM returned an empty title response');
        },
      }
    );

    expect(generatedTitle).toBeTruthy();
    expect(generatedTitle!.trim().length).toBeGreaterThan(0);

    const persisted = await sessionManager.getSession(session.id);
    expect(persisted?.title).toBe(generatedTitle);
  });

  it('keeps a good generated title when llm provides one', async () => {
    const session = await sessionManager.createSession('michael-brown', 'dev-1');

    await sessionManager.appendMessage(session.id, {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: 'michael-brown',
      isHuman: true,
      content: 'improve session title quality',
    } as any);

    const generatedTitle = await sessionManager.appendMessage(
      session.id,
      {
        timestamp: new Date().toISOString(),
        from: 'human',
        to: 'michael-brown',
        isHuman: true,
        content: 'make title generation more reliable',
      } as any,
      {
        generateTitle: async () => 'Improve Session Title Reliability',
      }
    );

    expect(generatedTitle).toBe('Improve Session Title Reliability');
    const persisted = await sessionManager.getSession(session.id);
    expect(persisted?.title).toBe('Improve Session Title Reliability');
  });

  it('replaces weak generated title text with a meaningful fallback', async () => {
    const session = await sessionManager.createSession('michael-brown', 'dev-1');

    await sessionManager.appendMessage(session.id, {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: 'michael-brown',
      isHuman: true,
      content: 'we want to plan how to retire agents',
    } as any);

    const generatedTitle = await sessionManager.appendMessage(
      session.id,
      {
        timestamp: new Date().toISOString(),
        from: 'human',
        to: 'michael-brown',
        isHuman: true,
        content: 'archive old agent profiles and close lifecycle docs',
      } as any,
      {
        generateTitle: async () => 'Let Plan Future Want',
      }
    );

    expect(generatedTitle).not.toBe('Let Plan Future Want');
    expect(generatedTitle).toBeTruthy();
    expect(generatedTitle!).toMatch(/(Plan|Retire|Archive|Offboard|Decommission|Sunset)/);

    const persisted = await sessionManager.getSession(session.id);
    expect(persisted?.title).toBe(generatedTitle);
  });

  it('rejects titles that start with Let and uses fallback', async () => {
    const session = await sessionManager.createSession('michael-brown', 'dev-1');

    await sessionManager.appendMessage(session.id, {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: 'michael-brown',
      isHuman: true,
      content: 'test title generation quality for planning work',
    } as any);

    const generatedTitle = await sessionManager.appendMessage(
      session.id,
      {
        timestamp: new Date().toISOString(),
        from: 'human',
        to: 'michael-brown',
        isHuman: true,
        content: 'plan a clean retirement strategy for agents',
      } as any,
      {
        generateTitle: async () => 'Let Test Title Generated',
      }
    );

    expect(generatedTitle).not.toBe('Let Test Title Generated');
    expect(generatedTitle).toBeTruthy();

    const persisted = await sessionManager.getSession(session.id);
    expect(persisted?.title).toBe(generatedTitle);
  });

  it('inherits thread title immediately when creating a handoff session', async () => {
    const root = await sessionManager.createSession('michael-brown', 'dev-1');
    await sessionManager.saveSession({ ...root, title: 'Unified Thread Title' } as any);

    const child = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', root.id);
    expect(child.title).toBe('Unified Thread Title');

    const persistedChild = await sessionManager.getSession(child.id);
    expect(persistedChild?.title).toBe('Unified Thread Title');
  });

  it('propagates generated title to all sessions in the same thread', async () => {
    const root = await sessionManager.createSession('michael-brown', 'dev-1');
    const child = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', root.id);

    await sessionManager.appendMessage(child.id, {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: 'alex-johnson',
      isHuman: true,
      content: 'help me align titles across this thread',
    } as any);

    const generatedTitle = await sessionManager.appendMessage(
      child.id,
      {
        timestamp: new Date().toISOString(),
        from: 'human',
        to: 'alex-johnson',
        isHuman: true,
        content: 'set one shared title for all linked sessions',
      } as any,
      {
        generateTitle: async () => 'Thread Unified Title',
      }
    );

    expect(generatedTitle).toBe('Thread Unified Title');

    const persistedRoot = await sessionManager.getSession(root.id);
    const persistedChild = await sessionManager.getSession(child.id);
    expect(persistedRoot?.title).toBe('Thread Unified Title');
    expect(persistedChild?.title).toBe('Thread Unified Title');
  });
});

// Note: getThreadGraphData tests moved to thread-manager.test.ts
