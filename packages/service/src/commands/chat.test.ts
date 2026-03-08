import { describe, expect, it } from 'vitest';

import {
  requestInput,
  requestConfirm,
  stripHandoffDirective,
} from './chat/index.js';
import type { ChatRuntimeHooks } from './chat/index.js';
import { REFERENCE_PRONOUNS } from '../orchestrator/forward-detection.js';

// ---------------------------------------------------------------------------
// requestInput / requestConfirm — event ordering
// ---------------------------------------------------------------------------
// Regression guard: log events emitted to hooks.emit must be observable
// *before* hooks.questionInput is called (i.e. before readline writes the
// prompt). This broke when only Promise.resolve() (one microtask) was used;
// fixed by switching to setImmediate (full event-loop tick).
// ---------------------------------------------------------------------------

function makeHooks(answer: string): {
  hooks: ChatRuntimeHooks;
  order: string[];
} {
  const order: string[] = [];

  const hooks: ChatRuntimeHooks = {
    emit(event: Parameters<NonNullable<ChatRuntimeHooks['emit']>>[0]) {
      order.push(`emit:${event.kind}`);
    },
    async questionInput(_req: Parameters<NonNullable<ChatRuntimeHooks['questionInput']>>[0]) {
      order.push('questionInput');
      return answer;
    },
    async questionConfirm(_req: Parameters<NonNullable<ChatRuntimeHooks['questionConfirm']>>[0]) {
      order.push('questionConfirm');
      return true;
    },
  };

  return { hooks, order };
}

describe('requestInput — event-ordering (setImmediate fix)', () => {
  it('emits question event before calling questionInput', async () => {
    const { hooks, order } = makeHooks('hello');

    await requestInput(hooks, { message: 'Prompt:' });

    const emitIdx = order.indexOf('emit:question');
    const inputIdx = order.indexOf('questionInput');
    expect(emitIdx).toBeGreaterThanOrEqual(0);
    expect(inputIdx).toBeGreaterThan(emitIdx);
  });

  it('any setImmediate-scheduled work runs before questionInput', async () => {
    const { hooks, order } = makeHooks('hi');

    // Simulate a pending log event scheduled via setImmediate (as the CLI
    // for-await loop does when draining runtimeQueue).
    setImmediate(() => order.push('consumer:drained'));

    await requestInput(hooks, { message: 'Prompt:' });

    const drainIdx = order.indexOf('consumer:drained');
    const inputIdx = order.indexOf('questionInput');
    expect(drainIdx).toBeGreaterThanOrEqual(0);
    expect(inputIdx).toBeGreaterThan(drainIdx);
  });

  it('returns the value from questionInput', async () => {
    const { hooks } = makeHooks('my answer');
    const result = await requestInput(hooks, { message: 'Q:' });
    expect(result).toBe('my answer');
  });

  it('throws when no questionInput handler is provided', async () => {
    const hooks: ChatRuntimeHooks = { emit: () => {} };
    await expect(requestInput(hooks, { message: 'Q:' })).rejects.toThrow(
      'Input question requested but no client questionInput responder is available.',
    );
  });
});

describe('requestConfirm — event-ordering (setImmediate fix)', () => {
  it('emits question event before calling questionConfirm', async () => {
    const { hooks, order } = makeHooks('');

    await requestConfirm(hooks, { message: 'Continue?' });

    const emitIdx = order.indexOf('emit:question');
    const confirmIdx = order.indexOf('questionConfirm');
    expect(emitIdx).toBeGreaterThanOrEqual(0);
    expect(confirmIdx).toBeGreaterThan(emitIdx);
  });

  it('any setImmediate-scheduled work runs before questionConfirm', async () => {
    const { hooks, order } = makeHooks('');

    setImmediate(() => order.push('consumer:drained'));

    await requestConfirm(hooks, { message: 'Continue?' });

    const drainIdx = order.indexOf('consumer:drained');
    const confirmIdx = order.indexOf('questionConfirm');
    expect(drainIdx).toBeGreaterThanOrEqual(0);
    expect(confirmIdx).toBeGreaterThan(drainIdx);
  });

  it('returns the boolean from questionConfirm', async () => {
    const { hooks } = makeHooks('');
    const result = await requestConfirm(hooks, { message: 'Q?' });
    expect(result).toBe(true);
  });
});



describe('stripHandoffDirective', () => {
  it('removes a bare HANDOFF: line', () => {
    const input = 'Sure thing!\nHANDOFF: engineer | pass to dev team\nLet me know.';
    const result = stripHandoffDirective(input);
    expect(result).toContain('Sure thing!');
    expect(result).toContain('Let me know.');
    expect(result).not.toMatch(/HANDOFF/i);
  });

  it('removes multiple HANDOFF: lines', () => {
    const input = 'HANDOFF: hr | go here\nSome text.\nHANDOFF:CEO| also here\nDone.';
    const result = stripHandoffDirective(input);
    expect(result).toContain('Some text.');
    expect(result).toContain('Done.');
    expect(result).not.toMatch(/HANDOFF/i);
  });

  it('is case-insensitive', () => {
    const input = 'Hello.\nhandoff: engineer | route it\nBye.';
    // Removing the directive line leaves one blank line; that is acceptable
    const result = stripHandoffDirective(input);
    expect(result).toContain('Hello.');
    expect(result).toContain('Bye.');
    expect(result).not.toMatch(/handoff/i);
  });

  it('handles leading/trailing whitespace on the directive line', () => {
    const input = 'Hi.\n   HANDOFF:CEO| urgent   \nThanks.';
    const result = stripHandoffDirective(input);
    expect(result).toContain('Hi.');
    expect(result).toContain('Thanks.');
    expect(result).not.toMatch(/HANDOFF/i);
  });

  it('collapses more than two consecutive blank lines left by removal', () => {
    const input = 'Start.\n\n\nHANDOFF: x | y\n\n\n\nEnd.';
    const result = stripHandoffDirective(input);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('Start.');
    expect(result).toContain('End.');
  });

  it('leaves text without a directive unchanged', () => {
    const input = 'This is a normal message.';
    expect(stripHandoffDirective(input)).toBe('This is a normal message.');
  });

  it('does not strip lines that merely mention handoff in a sentence', () => {
    const input = 'The handoff process is important.\nHANDOFF:CEO| do it\nProceed.';
    const result = stripHandoffDirective(input);
    expect(result).toContain('The handoff process is important.');
    expect(result).not.toContain('HANDOFF: cto');
  });

  it('returns empty string when input is only a HANDOFF directive', () => {
    expect(stripHandoffDirective('HANDOFF: engineer | go')).toBe('');
  });

  it('returns trimmed result', () => {
    const input = '\n\nHANDOFF: x | y\n\n';
    expect(stripHandoffDirective(input)).toBe('');
  });
});

// detectForwardRequestWithFallback and REFERENCE_PRONOUNS tests live in
// packages/service/src/orchestrator/forward-detection.test.ts

  it('contains common English third-person pronouns', () => {
    expect(REFERENCE_PRONOUNS.has('him')).toBe(true);
    expect(REFERENCE_PRONOUNS.has('her')).toBe(true);
    expect(REFERENCE_PRONOUNS.has('them')).toBe(true);
    expect(REFERENCE_PRONOUNS.has('they')).toBe(true);
    expect(REFERENCE_PRONOUNS.has('he')).toBe(true);
    expect(REFERENCE_PRONOUNS.has('she')).toBe(true);
  });

  it('does not match ordinary names or empty string', () => {
    expect(REFERENCE_PRONOUNS.has('sarah')).toBe(false);
    expect(REFERENCE_PRONOUNS.has('')).toBe(false);
    expect(REFERENCE_PRONOUNS.has('the developer')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectForwardRequestWithFallback
// ---------------------------------------------------------------------------

function makeAgent(id: string, name: string, role: string): Agent {
  return {
    id,
    name,
    role,
    filePath: `/agents/${id}.md`,
    skillPath: `/skills/${role}.md`,
    createdAt: new Date().toISOString(),
    agentIds: [id],
    agentId: id,
  } as unknown as Agent;
}

function makeAgentManager(agents: Agent[]): AgentManager {
  return {
    getAllAgents: () => agents,
    resolveAgent: (query: string) => {
      const q = query.toLowerCase().trim();
      return agents.filter(
        a => a.name.toLowerCase() === q || a.id.toLowerCase() === q || a.name.toLowerCase().startsWith(q),
      );
    },
    getAgent: (id: string) => agents.find(a => a.id === id),
  } as unknown as AgentManager;
}

const SARAH = makeAgent('sarah-morgan', 'Sarah Morgan', 'frontend-developer');
const MICHAEL = makeAgent('michael-brown', 'Michael Brown', 'backend-developer');

describe('detectForwardRequestWithFallback', () => {
  const currentAgentId = MICHAEL.id;

  it('phase 1 — resolves an explicit agent name directly', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;

    const result = await detectForwardRequestWithFallback(
      'forward me to Sarah',
      agentManager, currentAgentId, llm, MICHAEL,
    );

    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('phase 2 — resolves when the extracted string has trailing filler words', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;

    // extractForwardTargetName returns "sarah i want to discuss this"
    // Phase 1: resolveAgent("sarah i want to discuss this") → []
    // Phase 2: slices until "sarah" → match
    const result = await detectForwardRequestWithFallback(
      'forward me to sarah i want to discuss this',
      agentManager, currentAgentId, llm, MICHAEL,
    );

    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('phase 3 pronoun — uses recent history to identify the referent', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn().mockResolvedValue('Sarah Morgan') } as any;

    const history = [
      { from: MICHAEL.id, to: currentAgentId, isHuman: false, content: 'You should talk to Sarah about the UI.', timestamp: '' },
      { from: currentAgentId, to: MICHAEL.id, isHuman: true, content: 'OK, sounds good.', timestamp: '' },
    ] as any[];

    const result = await detectForwardRequestWithFallback(
      'please forward me to him',
      agentManager, currentAgentId, llm, MICHAEL,
      history,
    );

    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
    // LLM must have been called with the history snippet injected
    const promptArg: string = llm.chat.mock.calls[0][1][0].content;
    expect(promptArg).toContain('Recent conversation');
    expect(promptArg).toContain('Sarah Morgan');
  });

  it('phase 3 pronoun — returns looksLikeForward=true but no resolution when LLM says none', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn().mockResolvedValue('none') } as any;

    const result = await detectForwardRequestWithFallback(
      'forward me to her',
      agentManager, currentAgentId, llm, MICHAEL,
      [],
    );

    expect(result.resolved).toBeUndefined();
    expect(result.looksLikeForward).toBe(true);
  });

  it('non-forward message — returns looksLikeForward=false', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;

    const result = await detectForwardRequestWithFallback(
      'how is the project going?',
      agentManager, currentAgentId, llm, MICHAEL,
    );

    expect(result.resolved).toBeUndefined();
    expect(result.looksLikeForward).toBe(false);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('does not resolve the current agent as a forward target', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn().mockResolvedValue('Michael Brown') } as any;

    // Even if "forward me to michael" is said while already talking to michael,
    // it should not cycle back to the same agent.
    const result = await detectForwardRequestWithFallback(
      'forward me to Michael',
      agentManager, currentAgentId, llm, MICHAEL,
    );

    // Michael is filtered out; no other match from phase 1
    // Phase 2 also filtered → phase 3 LLM returns Michael again → still filtered → undefined
    expect(result.resolved).toBeUndefined();
  });

  // -- new intent patterns ---------------------------------------------------

  const directBriefCases: Array<[string, string]> = [
    ['brief Sarah about this',            'brief <name> about'],
    ['can you brief Sarah about this?',   'can you brief <name> about'],
    ['please brief Sarah on the project', 'please brief <name> on'],
    ['brief Sarah',                       'brief <name> (no trailing context)'],
  ];

  for (const [input, label] of directBriefCases) {
    it(`detects forward from "${label}"`, async () => {
      const agentManager = makeAgentManager([SARAH, MICHAEL]);
      const llm = { chat: vi.fn() } as any;

      const result = await detectForwardRequestWithFallback(
        input, agentManager, currentAgentId, llm, MICHAEL,
      );

      expect(result.resolved).toBe(SARAH);
      expect(result.looksLikeForward).toBe(true);
      expect(llm.chat).not.toHaveBeenCalled();
    });
  }

  it('detects forward from "tell Sarah about the bug"', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;
    const result = await detectForwardRequestWithFallback(
      'tell Sarah about the bug', agentManager, currentAgentId, llm, MICHAEL,
    );
    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
  });

  it('detects forward from "let Sarah know about the deadline"', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;
    const result = await detectForwardRequestWithFallback(
      'let Sarah know about the deadline', agentManager, currentAgentId, llm, MICHAEL,
    );
    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
  });

  it('detects forward from "loop in Sarah"', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;
    const result = await detectForwardRequestWithFallback(
      'loop in Sarah', agentManager, currentAgentId, llm, MICHAEL,
    );
    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
  });

  it('detects forward from "ping Sarah about the release"', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;
    const result = await detectForwardRequestWithFallback(
      'ping Sarah about the release', agentManager, currentAgentId, llm, MICHAEL,
    );
    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
  });
});