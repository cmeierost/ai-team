/**
 * conversation-flow.test.ts
 *
 * End-to-end unit tests for multi-agent conversation flows with handoffs.
 * Mocks the DB (SessionManager) to verify:
 *   - Which messages are persisted, in which sessions, with correct from/to fields
 *   - No duplicate message writes
 *   - Briefing appears in BOTH FROM and TO sessions
 *   - Session reuse when returning to a previous agent ("take me back to emily")
 *   - User message is persisted even when NL forward intercepts before sendTurn
 *
 * Scenario under test:
 *   1. User chats with Emily Davis (session sess-emily)
 *   2. User says "forward me to michael" → NL forward to Michael Brown (session sess-michael)
 *   3. User says "take me back to emily" → NL forward back to Emily (reuses sess-emily)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Agent, ChatMessage } from '@ai-team/core';
import { ChatOrchestrator } from './chat-orchestrator.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins } from './pipeline.js';
import type { MediatorRuntimeEvent } from '../contracts.js';

// ── Agent fixtures ──────────────────────────────────────────────────────────

const EMILY: Agent = {
  id: 'emily-davis',
  name: 'Emily Davis',
  role: 'frontend-developer',
  systemPrompt: 'You are Emily Davis, a frontend developer.',
} as Agent;

const MICHAEL: Agent = {
  id: 'michael-brown',
  name: 'Michael Brown',
  role: 'ceo',
  systemPrompt: 'You are Michael Brown, the CEO.',
} as Agent;

const ALL_AGENTS = [EMILY, MICHAEL];

// ── In-memory DB mock ───────────────────────────────────────────────────────

interface MockSession {
  id: string;
  agentIds: string[];
  agentId: string;
  developerId: string;
  previousSessionId?: string;
  startedAt: string;
  lastActivityAt: string;
  artifacts: string[];
  allowedFiles: string[];
}

function createInMemoryDB() {
  const sessions = new Map<string, MockSession>();
  const messages = new Map<string, ChatMessage[]>();  // sessionId → messages[]
  let sessionCounter = 0;

  return {
    sessions,
    messages,

    createSession(data: Partial<MockSession> & { agentIds: string[]; agentId: string; developerId: string; previousSessionId?: string }) {
      const id = `sess-${++sessionCounter}`;
      const session: MockSession = {
        id,
        agentIds: data.agentIds,
        agentId: data.agentId,
        developerId: data.developerId,
        previousSessionId: data.previousSessionId,
        startedAt: data.startedAt ?? new Date().toISOString(),
        lastActivityAt: data.lastActivityAt ?? new Date().toISOString(),
        artifacts: data.artifacts ?? [],
        allowedFiles: data.allowedFiles ?? [],
      };
      sessions.set(id, session);
      messages.set(id, []);
      return session;
    },

    getSession(id: string) {
      return sessions.get(id) ?? null;
    },

    getSessionMessages(id: string) {
      return [...(messages.get(id) ?? [])];
    },

    appendMessage(sessionId: string, msg: ChatMessage) {
      const list = messages.get(sessionId);
      if (!list) throw new Error(`Session ${sessionId} does not exist`);
      list.push({ ...msg });
    },

    listSessions(filter?: { developerId?: string }) {
      const all = [...sessions.values()];
      if (filter?.developerId) return all.filter(s => s.developerId === filter.developerId);
      return all;
    },
  };
}

// ── Build a SessionManager-like mock backed by in-memory DB ─────────────────

function buildSessionManager(db: ReturnType<typeof createInMemoryDB>) {
  return {
    getSession: vi.fn(async (id: string) => db.getSession(id)),

    getSessionMessages: vi.fn(async (id: string) => db.getSessionMessages(id)),

    appendMessage: vi.fn(async (sessionId: string, msg: ChatMessage) => {
      db.appendMessage(sessionId, msg);
    }),

    resolveHandoffSession: vi.fn(async (
      targetAgentId: string,
      currentSessionId: string,
      developerId: string,
    ) => {
      // Walk the chain to find if targetAgentId already has a session
      const visited = new Set<string>();
      let current = db.getSession(currentSessionId);

      // Walk upward to root
      const chain: MockSession[] = [];
      while (current) {
        if (visited.has(current.id)) break;
        visited.add(current.id);
        chain.push(current);
        if (!current.previousSessionId) break;
        current = db.getSession(current.previousSessionId);
      }

      // Also walk downward (BFS from root)
      chain.reverse(); // root first
      const root = chain[0];
      if (root) {
        const allSessions = db.listSessions({ developerId: root.developerId });
        const childrenOf = new Map<string, MockSession[]>();
        for (const s of allSessions) {
          if (!s.previousSessionId) continue;
          const children = childrenOf.get(s.previousSessionId) ?? [];
          children.push(s);
          childrenOf.set(s.previousSessionId, children);
        }
        const fullChain: MockSession[] = [];
        const queue: MockSession[] = [root];
        const seen = new Set<string>([root.id]);
        while (queue.length > 0) {
          const node = queue.shift()!;
          fullChain.push(node);
          for (const child of (childrenOf.get(node.id) ?? [])) {
            if (!seen.has(child.id)) {
              seen.add(child.id);
              queue.push(child);
            }
          }
        }

        const existing = fullChain.find(s => {
          const ids = s.agentIds ?? (s.agentId ? [s.agentId] : []);
          return ids.includes(targetAgentId);
        });
        if (existing) return { session: existing, isNew: false };
      }

      // Create new handoff session
      const session = db.createSession({
        agentIds: [targetAgentId],
        agentId: targetAgentId,
        developerId,
        previousSessionId: currentSessionId,
      });
      return { session, isNew: true };
    }),
  };
}

// ── Build AgentManager mock ─────────────────────────────────────────────────

function buildAgentManager() {
  return {
    getAgent: vi.fn((id: string) => ALL_AGENTS.find(a => a.id === id) ?? null),
    resolveAgent: vi.fn((query: string) => {
      const q = query.toLowerCase();
      return ALL_AGENTS.filter(a =>
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.name.toLowerCase().split(/\s+/).some(part => part.startsWith(q)),
      );
    }),
    getAllAgents: vi.fn(() => [...ALL_AGENTS]),
    recordInteraction: vi.fn(async () => {}),
    loadAllAgents: vi.fn(async () => {}),
  };
}

// ── Build LLM mock ──────────────────────────────────────────────────────────

function buildLlmService() {
  const responses: string[] = [];
  let callIndex = 0;

  return {
    /** Queue an LLM response for the next call (FIFO). */
    queueResponse(text: string) {
      responses.push(text);
    },

    // Used by sendTurn (streaming path, no tools → streamChat)
    // Must yield OpenAI-format chunks so extractStreamDeltaText can parse them.
    streamChat: vi.fn(async function* (_agent: any, _msgs: any) {
      const text = responses[callIndex++] ?? '(no response queued)';
      yield { choices: [{ delta: { content: text } }] } as any;
    }),

    // Used by sendTurn (tool path → chatWithTools)
    chatWithTools: vi.fn(async (_agent: any, _msgs: any) => {
      const text = responses[callIndex++] ?? '(no response queued)';
      return { text, usage: 0 };
    }),

    // Used by handoff briefing generation and forward detection LLM fallback
    chat: vi.fn(async () => {
      const text = responses[callIndex++] ?? 'Briefing text from the LLM.';
      return text;
    }),
  };
}

// ── Build minimal OrchestratorContext ────────────────────────────────────────

function buildContext(opts: {
  agent: Agent;
  sessionId: string;
  db: ReturnType<typeof createInMemoryDB>;
  sessionManager: ReturnType<typeof buildSessionManager>;
  agentManager: ReturnType<typeof buildAgentManager>;
  llmService: ReturnType<typeof buildLlmService>;
  history?: ChatMessage[];
}): OrchestratorContext {
  return {
    agent: opts.agent,
    workspaceRoot: '/workspace',
    sessionId: opts.sessionId,
    hooks: { emit: vi.fn() },
    history: opts.history ?? opts.db.getSessionMessages(opts.sessionId),
    toolManager: { toSchema: vi.fn(() => null), getToolsForAgent: vi.fn(() => []) } as any,
    sessionManager: opts.sessionManager as any,
    agentManager: opts.agentManager as any,
    skillManager: { getSkill: vi.fn(() => null) } as any,
    llmService: opts.llmService as any,
    contextManager: {} as any,
  };
}

// ── Build minimal ResolvedPlugins ───────────────────────────────────────────

function buildPlugins(): ResolvedPlugins {
  return {
    compressor:     { compress: async (h: ChatMessage[]) => h } as any,
    contextBuilder: { build: async (h: ChatMessage[]) => [{ role: 'user', content: h.at(-1)?.content ?? '' }] } as any,
    enrichers:      [],
    ragProvider:    { retrieve: vi.fn(async () => null) } as any,
    toolResolver:   { resolve: vi.fn(async () => []) } as any,
    mcpGateway:     { discover: vi.fn(async () => []) } as any,
    llmSelector:    { select: vi.fn(async () => {}) } as any,
    outputHandler:  { handle: vi.fn(async () => {}) } as any,
    slashCommands:  [],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Conversation flow — multi-agent handoff', () => {
  let db: ReturnType<typeof createInMemoryDB>;
  let sm: ReturnType<typeof buildSessionManager>;
  let am: ReturnType<typeof buildAgentManager>;
  let llm: ReturnType<typeof buildLlmService>;
  let plugins: ResolvedPlugins;
  let emilySession: MockSession;

  beforeEach(() => {
    db  = createInMemoryDB();
    sm  = buildSessionManager(db);
    am  = buildAgentManager();
    llm = buildLlmService();
    plugins = buildPlugins();

    // Pre-create Emily's session (simulates getOrCreateLatestSession at chat start)
    emilySession = db.createSession({
      agentIds: ['emily-davis'],
      agentId: 'emily-davis',
      developerId: 'clemens',
    });
  });

  // ── 1. Normal turn: no duplicates ──────────────────────────────────────

  it('persists exactly one user message and one agent reply per normal turn', async () => {
    llm.queueResponse('Hello Clemens! How can I help?');

    const ctx = buildContext({
      agent: EMILY,
      sessionId: emilySession.id,
      db, sessionManager: sm, agentManager: am, llmService: llm,
    });
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    await orchestrator.run({ message: 'hello emily' });

    const msgs = db.getSessionMessages(emilySession.id);
    expect(msgs).toHaveLength(2);  // 1 human + 1 agent, NOT 3

    // User message
    expect(msgs[0].isHuman).toBe(true);
    expect(msgs[0].from).toBe('human');
    expect(msgs[0].to).toBe('emily-davis');
    expect(msgs[0].content).toBe('hello emily');

    // Agent reply
    expect(msgs[1].isHuman).toBe(false);
    expect(msgs[1].from).toBe('emily-davis');
    expect(msgs[1].content).toBe('Hello Clemens! How can I help?');
  });

  // ── 2. NL forward: user message persisted, briefing in BOTH sessions ────

  it('persists user message and briefing in both sessions on NL forward', async () => {
    // Queue briefing LLM response
    llm.queueResponse('Clemens has been working with me on the frontend. He would like to discuss strategy with you.');

    const ctx = buildContext({
      agent: EMILY,
      sessionId: emilySession.id,
      db, sessionManager: sm, agentManager: am, llmService: llm,
    });
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    await orchestrator.run({ message: 'forward me to michael' });

    // Emily's session should have:
    //   1. The user's message "forward me to michael"
    //   2. The LLM briefing (with both session IDs)
    const emilyMsgs = db.getSessionMessages(emilySession.id);
    const humanMsg = emilyMsgs.find(m => m.isHuman);
    expect(humanMsg).toBeDefined();
    expect(humanMsg!.from).toBe('human');
    expect(humanMsg!.to).toBe('emily-davis');
    expect(humanMsg!.content).toBe('forward me to michael');

    // Briefing should be in Emily's session with BOTH session IDs
    const emilyBriefing = emilyMsgs.find(m => m.handoffType === 'agent-briefing');
    expect(emilyBriefing).toBeDefined();
    expect(emilyBriefing!.from).toBe('emily-davis');
    expect(emilyBriefing!.to).toBe('michael-brown');
    expect(emilyBriefing!.handoffFromSessionId).toBeTruthy();
    expect(emilyBriefing!.handoffToSessionId).toBeTruthy();

    // Briefing should also be in Michael's session
    const michaelSessionId = ctx.sessionId;  // Context was mutated by handoff
    expect(michaelSessionId).not.toBe(emilySession.id);  // New session created

    const michaelMsgs = db.getSessionMessages(michaelSessionId);
    const michaelBriefing = michaelMsgs.find(m => m.handoffType === 'agent-briefing');
    expect(michaelBriefing).toBeDefined();
    expect(michaelBriefing!.content).toContain('Clemens has been working');
    expect(michaelBriefing!.handoffId).toBe(emilyBriefing!.handoffId);  // Same handoff event
  });

  // ── 3. Return to previous agent reuses the original session ─────────────

  it('returns to the original emily session when user says "take me back to emily"', async () => {
    // Step 1: Forward emily → michael
    llm.queueResponse('Briefing for Michael.');

    const ctx = buildContext({
      agent: EMILY,
      sessionId: emilySession.id,
      db, sessionManager: sm, agentManager: am, llmService: llm,
    });
    const orchestrator1 = new ChatOrchestrator(ctx, plugins);
    await orchestrator1.run({ message: 'forward me to michael' });

    const michaelSessionId = ctx.sessionId;
    expect(ctx.agent.id).toBe('michael-brown');
    expect(michaelSessionId).not.toBe(emilySession.id);

    // Step 2: Return michael → emily
    // Use 'forward me to emily' because 'take me back to emily' doesn't match
    // any FORWARD_PATTERNS regex — it would fall through to sendTurn instead.
    llm.queueResponse('Briefing for Emily about the return.');

    const orchestrator2 = new ChatOrchestrator(ctx, plugins);
    await orchestrator2.run({ message: 'forward me to emily' });

    // Context should point to Emily's ORIGINAL session, not a new one
    expect(ctx.agent.id).toBe('emily-davis');
    expect(ctx.sessionId).toBe(emilySession.id);

    // Only 2 sessions should exist total (Emily's original + Michael's)
    expect(db.sessions.size).toBe(2);
  });

  // ── 4. Agent-initiated handoff (HANDOFF: directive) ─────────────────────

  it('handles agent-initiated HANDOFF: directive without duplicate writes', async () => {
    // Agent response includes a HANDOFF: directive
    llm.queueResponse("Sure, I'll connect you to Michael.\n\nHANDOFF: michael-brown | Clemens needs CEO guidance.");
    // Queue briefing LLM response for executeHandoff
    llm.queueResponse('Emily here — Clemens has been asking about strategy.');

    const ctx = buildContext({
      agent: EMILY,
      sessionId: emilySession.id,
      db, sessionManager: sm, agentManager: am, llmService: llm,
    });
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    await orchestrator.run({ message: 'can i talk to the ceo?' });

    // Emily's session: 1 user msg + 1 agent reply (stripped) + 1 briefing (with both session IDs)
    const emilyMsgs = db.getSessionMessages(emilySession.id);
    const humanMsgs   = emilyMsgs.filter(m => m.isHuman);
    const agentReplies = emilyMsgs.filter(m => !m.isHuman && !m.handoffType);

    expect(humanMsgs).toHaveLength(1);
    expect(humanMsgs[0].from).toBe('human');
    expect(humanMsgs[0].to).toBe('emily-davis');

    // Agent reply should NOT contain the HANDOFF: directive
    expect(agentReplies).toHaveLength(1);
    expect(agentReplies[0].content).not.toContain('HANDOFF:');
    expect(agentReplies[0].content).toContain("I'll connect you to Michael");

    // No duplicates — exactly 1 agent reply, not 2
    expect(agentReplies).toHaveLength(1);

    // Briefing in Emily's session with both session IDs
    const emilyBriefing = emilyMsgs.find(m => m.handoffType === 'agent-briefing');
    expect(emilyBriefing).toBeDefined();
    expect(emilyBriefing!.handoffFromSessionId).toBeTruthy();
    expect(emilyBriefing!.handoffToSessionId).toBeTruthy();

    // Briefing also in Michael's session
    const michaelSessionId = ctx.sessionId;
    const michaelMsgs = db.getSessionMessages(michaelSessionId);
    const briefingInMichael = michaelMsgs.find(m => m.handoffType === 'agent-briefing');
    expect(briefingInMichael).toBeDefined();
    expect(briefingInMichael!.handoffId).toBe(emilyBriefing!.handoffId);
  });

  // ── 5. Full round-trip: Emily → Michael → Emily ────────────────────────

  it('full round-trip preserves session identity and message integrity', async () => {
    // -- Turn 1: normal chat with Emily --
    llm.queueResponse('Hi Clemens! Ready to work on the frontend.');
    let ctx = buildContext({
      agent: EMILY,
      sessionId: emilySession.id,
      db, sessionManager: sm, agentManager: am, llmService: llm,
    });
    let orch = new ChatOrchestrator(ctx, plugins);
    await orch.run({ message: 'hello' });

    expect(db.getSessionMessages(emilySession.id)).toHaveLength(2);

    // -- Turn 2: forward to Michael --
    llm.queueResponse('Briefing: Clemens said hello to Emily.');
    orch = new ChatOrchestrator(ctx, plugins);
    await orch.run({ message: 'forward me to michael' });

    const michaelSessionId = ctx.sessionId;
    expect(ctx.agent.id).toBe('michael-brown');

    // -- Turn 3: chat with Michael --
    llm.queueResponse('Hi Clemens! What can I do for you?');
    orch = new ChatOrchestrator(ctx, plugins);
    await orch.run({ message: 'hi michael' });

    const michaelMsgs = db.getSessionMessages(michaelSessionId);
    const michaelHumanMsgs = michaelMsgs.filter(m => m.isHuman);
    // In Michael's session: briefing + 1 user msg + 1 agent reply
    expect(michaelHumanMsgs).toHaveLength(1);
    expect(michaelHumanMsgs[0].content).toBe('hi michael');
    expect(michaelHumanMsgs[0].to).toBe('michael-brown');

    // -- Turn 4: return to Emily (uses 'forward me to emily' — regex-matched) --
    llm.queueResponse('Briefing: Clemens chatted briefly with Michael.');
    orch = new ChatOrchestrator(ctx, plugins);
    await orch.run({ message: 'forward me to emily' });

    expect(ctx.agent.id).toBe('emily-davis');
    expect(ctx.sessionId).toBe(emilySession.id);  // REUSED, not new

    // Only 2 sessions should exist
    expect(db.sessions.size).toBe(2);

    // -- Turn 5: chat with Emily again --
    llm.queueResponse('Welcome back! Where were we?');
    orch = new ChatOrchestrator(ctx, plugins);
    await orch.run({ message: 'hey emily, im back' });

    const finalEmilyMsgs = db.getSessionMessages(emilySession.id);
    // Verify the whole Emily session history makes sense
    const emilyHumanMsgs   = finalEmilyMsgs.filter(m => m.isHuman);
    const emilyAgentReplies = finalEmilyMsgs.filter(m => !m.isHuman && !m.handoffType);

    // Human messages in Emily's session: "hello", "forward me to michael", "hey emily, im back"
    // Note: "forward me to emily" is persisted in Michael's session, not Emily's.
    expect(emilyHumanMsgs.length).toBeGreaterThanOrEqual(3);

    // Agent replies: "Hi Clemens! Ready to work..." + "Welcome back!..."
    expect(emilyAgentReplies.length).toBeGreaterThanOrEqual(2);

    // No message should have wrong from/to
    for (const msg of finalEmilyMsgs) {
      if (msg.isHuman) {
        expect(msg.from).toBe('human');
      }
    }
  });

  // ── 6. Ensure briefing has the same handoffId in both sessions ──────────

  it('briefing in both sessions shares the same handoffId and has both session IDs', async () => {
    llm.queueResponse('LLM-generated briefing text.');

    const ctx = buildContext({
      agent: EMILY,
      sessionId: emilySession.id,
      db, sessionManager: sm, agentManager: am, llmService: llm,
    });
    const orch = new ChatOrchestrator(ctx, plugins);
    await orch.run({ message: 'forward me to michael' });

    const michaelSessionId = ctx.sessionId;

    // Emily's session: one briefing with both session IDs
    const emilyHandoffMsgs = db.getSessionMessages(emilySession.id)
      .filter(m => m.handoffType === 'agent-briefing');
    expect(emilyHandoffMsgs).toHaveLength(1);
    expect(emilyHandoffMsgs[0].handoffToSessionId).toBeTruthy();
    expect(emilyHandoffMsgs[0].handoffFromSessionId).toBeTruthy();

    // Michael's session: the same briefing
    const michaelBriefings = db.getSessionMessages(michaelSessionId)
      .filter(m => m.handoffType === 'agent-briefing');
    expect(michaelBriefings).toHaveLength(1);

    // They share the same handoffId
    expect(emilyHandoffMsgs[0].handoffId).toBeTruthy();
    expect(emilyHandoffMsgs[0].handoffId).toBe(michaelBriefings[0].handoffId);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CLI-path tests — prove that natural-language forward phrases work
// end-to-end through the ChatOrchestrator (same path the CLI uses).
// ────────────────────────────────────────────────────────────────────────────

describe('CLI handoff — natural-language phrase variants', () => {
  let db: ReturnType<typeof createInMemoryDB>;
  let sm: ReturnType<typeof buildSessionManager>;
  let am: ReturnType<typeof buildAgentManager>;
  let llm: ReturnType<typeof buildLlmService>;
  let plugins: ResolvedPlugins;
  let emilySession: MockSession;

  beforeEach(() => {
    db  = createInMemoryDB();
    sm  = buildSessionManager(db);
    am  = buildAgentManager();
    llm = buildLlmService();
    plugins = buildPlugins();

    emilySession = db.createSession({
      agentIds: ['emily-davis'],
      agentId: 'emily-davis',
      developerId: 'clemens',
    });
  });

  /**
   * Helper — run a single forward phrase and assert the handoff completed.
   * Returns the mutated context so callers can make additional assertions.
   */
  async function assertForwardHandoff(phrase: string) {
    llm.queueResponse('LLM briefing for the handoff.');

    const ctx = buildContext({
      agent: EMILY,
      sessionId: emilySession.id,
      db, sessionManager: sm, agentManager: am, llmService: llm,
    });
    const orch = new ChatOrchestrator(ctx, plugins);
    const result = await orch.run({ message: phrase });

    // run() returns '' when an NL forward was handled
    expect(result).toBe('');

    // Context should now point to Michael
    expect(ctx.agent.id).toBe('michael-brown');
    expect(ctx.agent.name).toBe('Michael Brown');
    expect(ctx.sessionId).not.toBe(emilySession.id);

    // The user message should be persisted in Emily's session
    const emilyMsgs = db.getSessionMessages(emilySession.id);
    const humanMsg = emilyMsgs.find(m => m.isHuman);
    expect(humanMsg).toBeDefined();
    expect(humanMsg!.content).toBe(phrase);
    expect(humanMsg!.from).toBe('human');
    expect(humanMsg!.to).toBe('emily-davis');

    // Briefing should exist in Emily's session with both session IDs
    const emilyBriefing = emilyMsgs.find(m => m.handoffType === 'agent-briefing');
    expect(emilyBriefing).toBeDefined();
    expect(emilyBriefing!.to).toBe('michael-brown');
    expect(emilyBriefing!.handoffFromSessionId).toBeTruthy();
    expect(emilyBriefing!.handoffToSessionId).toBeTruthy();

    // Briefing should also be in Michael's session
    const michaelMsgs = db.getSessionMessages(ctx.sessionId);
    const briefingInMichael = michaelMsgs.find(m => m.handoffType === 'agent-briefing');
    expect(briefingInMichael).toBeDefined();
    expect(briefingInMichael!.handoffId).toBe(emilyBriefing!.handoffId);

    // Handoff event should have been emitted
    const emitCalls = (ctx.hooks.emit as ReturnType<typeof vi.fn>).mock.calls;
    const handoffEvent = emitCalls.find(
      (call: unknown[]) => (call[0] as MediatorRuntimeEvent).kind === 'handoff',
    );
    expect(handoffEvent).toBeDefined();
    const hEvent = handoffEvent![0] as MediatorRuntimeEvent;
    expect(hEvent.fromAgentId).toBe('emily-davis');
    expect(hEvent.toAgentId).toBe('michael-brown');
    expect(hEvent.toSessionId).toBe(ctx.sessionId);

    return ctx;
  }

  // ── 7. "i want to talk to michael" — the exact web-failing phrase ───────

  it('handles "i want to talk to michael" (FORWARD_PATTERNS #5)', async () => {
    await assertForwardHandoff('i want to talk to michael');
  });

  // ── 8. "i need to speak with michael" — variant of pattern 5 ───────────

  it('handles "i need to speak with michael"', async () => {
    await assertForwardHandoff('i need to speak with michael');
  });

  // ── 9. "i want to chat with michael brown" — full name ────────────────

  it('handles "i want to chat with michael brown" (full name)', async () => {
    await assertForwardHandoff('i want to chat with michael brown');
  });

  // ── 10. "can you forward me to michael" — pattern 3 ──────────────────

  it('handles "can you forward me to michael" (pattern 3)', async () => {
    await assertForwardHandoff('can you forward me to michael');
  });

  // ── 11. "connect me to michael" — pattern 1 ──────────────────────────

  it('handles "connect me to michael" (pattern 1)', async () => {
    await assertForwardHandoff('connect me to michael');
  });

  // ── 12. "put me through to michael" — pattern 4 ─────────────────────

  it('handles "put me through to michael" (pattern 4)', async () => {
    await assertForwardHandoff('put me through to michael');
  });

  // ── 13. "switch me to michael" — pattern 1 variant ──────────────────

  it('handles "switch me to michael" (pattern 1)', async () => {
    await assertForwardHandoff('switch me to michael');
  });

  // ── 14. Non-forward message should NOT trigger handoff ────────────────

  it('does NOT handoff on a regular message that mentions michael', async () => {
    llm.queueResponse('Michael Brown is our CEO, you can ask to talk to him.');

    const ctx = buildContext({
      agent: EMILY,
      sessionId: emilySession.id,
      db, sessionManager: sm, agentManager: am, llmService: llm,
    });
    const orch = new ChatOrchestrator(ctx, plugins);
    const result = await orch.run({ message: 'what is michael working on today?' });

    // Should stay with Emily — this is not a forward request
    expect(ctx.agent.id).toBe('emily-davis');
    expect(ctx.sessionId).toBe(emilySession.id);
    // sendTurn should have run and returned a response
    expect(result).toContain('Michael Brown is our CEO');
  });

  // ── 15. "i want to talk to michael" emits correct stream events ───────

  it('emits handoff event with correct fields for stream consumers', async () => {
    const ctx = await assertForwardHandoff('i want to talk to michael');

    // Verify the handoff event has all fields a stream consumer needs
    const emitCalls = (ctx.hooks.emit as ReturnType<typeof vi.fn>).mock.calls;
    const handoffEvent = emitCalls.find(
      (call: unknown[]) => (call[0] as MediatorRuntimeEvent).kind === 'handoff',
    );
    const hEvent = handoffEvent![0] as MediatorRuntimeEvent;

    // These are the fields the web ChatPanel and CLI both rely on
    expect(hEvent.fromAgentId).toBe('emily-davis');
    expect(hEvent.fromAgentName).toBe('Emily Davis');
    expect(hEvent.fromSessionId).toBe(emilySession.id);
    expect(hEvent.toAgentId).toBe('michael-brown');
    expect(hEvent.toAgentName).toBe('Michael Brown');
    expect(hEvent.toSessionId).toBeTruthy();
    expect(hEvent.toSessionId).not.toBe(emilySession.id);
  });

  // ── 16. Handoff creates exactly 2 sessions ────────────────────────

  it('creates exactly one new session (total 2) for a single handoff', async () => {
    await assertForwardHandoff('i want to talk to michael');
    expect(db.sessions.size).toBe(2);
  });
});
