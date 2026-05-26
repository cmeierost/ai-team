import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@ai-team/core';
import { SessionManager } from './session-manager.js';
import type { IMessagesRepository, ISessionsRepository, INotesRepository } from '@ai-team/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

type StoredMessage = ChatMessage & { _messageId: number; _hiddenFromLlm?: boolean; _archived?: boolean };

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    agentIds: [...(session.agentIds ?? [])],
    artifacts: [...(session.artifacts ?? [])],
    allowedFiles: [...(session.allowedFiles ?? [])],
    mergedFromSessionIds: session.mergedFromSessionIds ? [...session.mergedFromSessionIds] : null,
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
        ? messagesBySession.get(filter.sessionId) ?? []
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
      return result.map(({ _messageId, _hiddenFromLlm, _archived, ...message }) => ({ ...message }));
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
      const merged = cloneSession({ ...current, ...updates, id: current.id, messageCount: current.messageCount });
      sessions.set(sessionId, merged);
    },
    async listSessions(filter) {
      let result = [...sessions.values()].map(cloneSession);
      if (filter?.developerId) {
        result = result.filter((session) => session.developerId === filter.developerId);
      }
      if (filter?.agentId) {
        result = result.filter((session) =>
          ((session.agentIds ?? []) as string[]).includes(filter.agentId!) || session.agentId === filter.agentId
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
  return new SessionManager(workspaceRoot, repos.messages, repos.sessions, repos.notes);
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
// findAgentSessionInChain
// ---------------------------------------------------------------------------

describe('SessionManager.findAgentSessionInChain', () => {
  let sessionManager: SessionManager;

  beforeEach(async () => {
    sessionManager = await createSessionManagerForTest();
  });

  it('returns the session when the root session belongs to the target agent', async () => {
    // Single session: root belongs to michael
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const found = await sessionManager.findAgentSessionInChain(michaelS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('returns null when the target agent has no session in the chain', async () => {
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const found = await sessionManager.findAgentSessionInChain(michaelS1.id, 'sarah-morgan');
    expect(found).toBeNull();
  });

  it('walks the chain and finds an earlier session for the target agent', async () => {
    // Chain: michaelS1 → alexS1 → michaelS2 (hand back)
    // findAgentSessionInChain(alexS1.id, 'michael-brown') should return michaelS1
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);

    const found = await sessionManager.findAgentSessionInChain(alexS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('finds a session two hops back in the chain', async () => {
    // Chain: michaelS1 → alexS1 → sarahS1
    // findAgentSessionInChain(sarahS1.id, 'michael-brown') should return michaelS1
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);
    const sarahS1 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', alexS1.id);

    const found = await sessionManager.findAgentSessionInChain(sarahS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('finds an intermediate session, not a leaf or root', async () => {
    // Chain: michaelS1 → alexS1 → sarahS1
    // findAgentSessionInChain(sarahS1.id, 'alex-johnson') should return alexS1
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);
    const sarahS1 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', alexS1.id);

    const found = await sessionManager.findAgentSessionInChain(sarahS1.id, 'alex-johnson');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(alexS1.id);
  });

  it('returns the starting session itself when it belongs to the target agent', async () => {
    // Chain: michaelS1 → alexS1
    // findAgentSessionInChain(alexS1.id, 'alex-johnson') should return alexS1 itself
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);

    const found = await sessionManager.findAgentSessionInChain(alexS1.id, 'alex-johnson');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(alexS1.id);
  });
});

// ---------------------------------------------------------------------------
// getSessionChain
// ---------------------------------------------------------------------------

describe('SessionManager.getSessionChain', () => {
  let sessionManager: SessionManager;

  beforeEach(async () => {
    sessionManager = await createSessionManagerForTest();
  });

  it('returns a single-session chain for a root session', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const chain = await sessionManager.getSessionChain(s1.id);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe(s1.id);
  });

  it('returns sessions ordered root → leaf for a two-session chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);

    const chain = await sessionManager.getSessionChain(s2.id);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(s1.id); // root first
    expect(chain[1].id).toBe(s2.id); // leaf last
  });

  it('returns sessions ordered root → leaf for a three-session chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);
    const s3 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', s2.id);

    const chain = await sessionManager.getSessionChain(s3.id);
    expect(chain).toHaveLength(3);
    expect(chain[0].id).toBe(s1.id);
    expect(chain[1].id).toBe(s2.id);
    expect(chain[2].id).toBe(s3.id);
  });

  it('can start the walk from any session in the chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);
    const s3 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', s2.id);

    // Starting from the middle session s2 returns the full connected graph
    // (root → all descendants), not just the upward path.
    const chainFromMiddle = await sessionManager.getSessionChain(s2.id);
    expect(chainFromMiddle).toHaveLength(3);
    expect(chainFromMiddle[0].id).toBe(s1.id);
    expect(chainFromMiddle[1].id).toBe(s2.id);
    expect(chainFromMiddle[2].id).toBe(s3.id);
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

describe('SessionManager.getThreadGraphData', () => {
  let sessionManager: SessionManager;

  beforeEach(async () => {
    sessionManager = await createSessionManagerForTest();
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

    const graph = await sessionManager.getThreadGraphData(sessionB.id);
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
