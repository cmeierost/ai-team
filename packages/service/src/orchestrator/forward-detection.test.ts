import { describe, expect, it, vi } from 'vitest';
import type { Agent, AgentManager } from '@ai-team/core';
import {
  detectForwardRequestWithFallbackAsync,
  extractForwardNote,
  REFERENCE_PRONOUNS,
} from './forward-detection.js';

// ---------------------------------------------------------------------------
// Helpers
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
    getAllAgentsAsync: async () => agents,
    resolveAgentAsync: async (query: string) => {
      const q = query.toLowerCase().trim();
      return agents.filter(
        a =>
          a.name.toLowerCase() === q ||
          a.id.toLowerCase() === q ||
          a.role.toLowerCase() === q ||
          a.name.toLowerCase().startsWith(q),
      );
    },
    getAgentAsync: async (id: string) => agents.find(a => a.id === id) ?? null,
  } as unknown as AgentManager;
}

const SARAH   = makeAgent('sarah-morgan',   'Sarah Morgan',   'frontend-developer');
const MICHAEL = makeAgent('michael-brown',  'Michael Brown',  'backend-developer');
const CHRIS   = makeAgent('chris-lane',     'Chris Lane',     'cto');
const currentAgentId = MICHAEL.id;

// ---------------------------------------------------------------------------
// REFERENCE_PRONOUNS
// ---------------------------------------------------------------------------

describe('REFERENCE_PRONOUNS', () => {
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

describe('detectForwardRequestWithFallback', () => {
  it('phase 1 — resolves an explicit agent name directly', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;

    const result = await detectForwardRequestWithFallbackAsync(
      'forward me to Sarah',
      agentManager, currentAgentId, llm, MICHAEL,
    );

    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('resolves title alias "ceo" to a cto-role agent', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL, CHRIS]);
    const llm = { chat: vi.fn() } as any;

    const result = await detectForwardRequestWithFallbackAsync(
      'forward me to the ceo',
      agentManager, currentAgentId, llm, MICHAEL,
    );

    expect(result.resolved).toBe(CHRIS);
    expect(result.looksLikeForward).toBe(true);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('phase 2 — resolves when the extracted string has trailing filler words', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn() } as any;

    const result = await detectForwardRequestWithFallbackAsync(
      'forward me to sarah i want to discuss this',
      agentManager, currentAgentId, llm, MICHAEL,
    );

    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('phase 3 — uses recent history to resolve a pronoun reference', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn().mockResolvedValue('Sarah Morgan') } as any;

    const history = [
      { from: MICHAEL.id, to: currentAgentId, isHuman: false, content: 'You should talk to Sarah about the UI.', timestamp: '' },
      { from: currentAgentId, to: MICHAEL.id, isHuman: true,  content: 'OK, sounds good.', timestamp: '' },
    ] as any[];

    const result = await detectForwardRequestWithFallbackAsync(
      'please forward me to her',
      agentManager, currentAgentId, llm, MICHAEL,
      history,
    );

    expect(result.resolved).toBe(SARAH);
    expect(result.looksLikeForward).toBe(true);
    // LLM must have been called with history injected into the prompt
    const promptArg: string = llm.chat.mock.calls[0][1][0].content;
    expect(promptArg).toContain('Recent conversation');
    expect(promptArg).toContain('Sarah Morgan');
  });

  it('phase 3 — returns looksLikeForward=true but no resolution when LLM says none', async () => {
    const agentManager = makeAgentManager([SARAH, MICHAEL]);
    const llm = { chat: vi.fn().mockResolvedValue('none') } as any;

    const result = await detectForwardRequestWithFallbackAsync(
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

    const result = await detectForwardRequestWithFallbackAsync(
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

    const result = await detectForwardRequestWithFallbackAsync(
      'forward me to Michael',
      agentManager, currentAgentId, llm, MICHAEL,
    );

    expect(result.resolved).toBeUndefined();
  });

  // -- natural language patterns --------------------------------------------

  const naturalPatterns: Array<[string, string]> = [
    ['brief Sarah about this',              '"brief <name> about"'],
    ['can you brief Sarah about this?',     '"can you brief <name> about"'],
    ['please brief Sarah on the project',   '"please brief <name> on"'],
    ['brief Sarah',                         '"brief <name>" (no trailing context)'],
    ['tell Sarah about the bug',            '"tell <name> about"'],
    ['let Sarah know about the deadline',   '"let <name> know about"'],
    ['loop in Sarah',                       '"loop in <name>"'],
    ['ping Sarah about the release',        '"ping <name> about"'],
    ['get me Sarah',                        '"get me <name>"'],
    ['connect me to Sarah',                 '"connect me to <name>"'],
    ['I\'d rather ask Sarah about this',    '"I\'d rather ask <name>"'],
    ['let me talk to Sarah',                '"let me talk to <name>"'],
  ];

  for (const [input, label] of naturalPatterns) {
    it(`detects forward from ${label}`, async () => {
      const agentManager = makeAgentManager([SARAH, MICHAEL]);
      const llm = { chat: vi.fn() } as any;

      const result = await detectForwardRequestWithFallbackAsync(
        input, agentManager, currentAgentId, llm, MICHAEL,
      );

      expect(result.resolved).toBe(SARAH);
      expect(result.looksLikeForward).toBe(true);
      expect(llm.chat).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// extractForwardNote — partial name matching
// ---------------------------------------------------------------------------

describe('extractForwardNote', () => {
  it('returns undefined for "connect me to michael" (no trailing context)', () => {
    // "michael" is a partial match for "Michael Brown"
    const result = extractForwardNote('connect me to michael', 'Michael Brown');
    expect(result).toBeUndefined();
  });

  it('returns undefined for "forward me to michael" (no trailing context)', () => {
    const result = extractForwardNote('forward me to michael', 'Michael Brown');
    expect(result).toBeUndefined();
  });

  it('returns undefined for "i want to talk to michael" (no trailing context)', () => {
    const result = extractForwardNote('i want to talk to michael', 'Michael Brown');
    expect(result).toBeUndefined();
  });

  it('extracts trailing context after partial name match', () => {
    const result = extractForwardNote('forward me to michael about the budget', 'Michael Brown');
    expect(result).toBe('about the budget');
  });

  it('extracts trailing context after full name match', () => {
    const result = extractForwardNote('forward me to Michael Brown about the budget', 'Michael Brown');
    expect(result).toBe('about the budget');
  });

  it('returns undefined when full name present with no trailing context', () => {
    const result = extractForwardNote('forward me to Michael Brown', 'Michael Brown');
    expect(result).toBeUndefined();
  });

  it('returns undefined when message has no name match at all', () => {
    const result = extractForwardNote('hello world', 'Michael Brown');
    expect(result).toBeUndefined();
  });

  it('strips leading punctuation from trailing context', () => {
    const result = extractForwardNote('connect me to michael, he needs to review this', 'Michael Brown');
    expect(result).toBe('he needs to review this');
  });

  it('handles last-name partial match', () => {
    const result = extractForwardNote('forward me to Brown about planning', 'Michael Brown');
    expect(result).toBe('about planning');
  });
});
