/**
 * send-turn.test.ts
 *
 * Tests for spec paths 1, 2 and 4 (text-directive handoffs) plus
 * parseHandoffDirective / stripHandoffDirective behaviour.
 *
 * Spec reference: docs/implementation/handoff-system.md
 *   Path 1  — agent directive in LLM response (HANDOFF: line)
 *   Path 2  — agent stream contains FORWARD_TO: inline
 *   Path 4  — inline HANDOFF: directive from non-streaming response
 *
 * The regression that triggered this test: when an agent wrote
 *   HANDOFF: michael-brown | Clemens would like to talk with you directly.
 * the directive was stripped from the visible output (stripHandoffDirective) but
 * the TurnResult.handedOff flag was never set, so the orchestrator never acted
 * on the handoff. The fix adds parseHandoffDirective() and calls it in step 9
 * of send-turn.ts after fullResponse is known.
 */

import { describe, expect, it, vi } from 'vitest';
import { parseHandoffDirective, stripHandoffDirective } from '../commands/chat/index.js';
import { sendTurn } from './send-turn.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins } from './pipeline.js';
import type { Agent, ChatMessage } from '@ai-team/core';

// ────────────────────────────────────────────────────────────────────────────
// parseHandoffDirective — unit tests covering every directive variant
// ────────────────────────────────────────────────────────────────────────────

describe('parseHandoffDirective', () => {
  // Spec path 1 & 4: HANDOFF: agentId | note
  it('parses HANDOFF: with note', () => {
    const result = parseHandoffDirective('HANDOFF: michael-brown | Clemens wants to chat.');
    expect(result).toEqual({ targetAgentId: 'michael-brown', note: 'Clemens wants to chat.' });
  });

  it('parses HANDOFF: without note', () => {
    const result = parseHandoffDirective('HANDOFF: michael-brown');
    expect(result).toEqual({ targetAgentId: 'michael-brown', note: '' });
  });

  it('parses HANDOFF: with extra whitespace', () => {
    const result = parseHandoffDirective('  HANDOFF:  michael-brown  |  some note  ');
    expect(result).toEqual({ targetAgentId: 'michael-brown', note: 'some note' });
  });

  it('parses HANDOFF: at end of multi-line agent response', () => {
    const text = `Sure, I'll connect you to Michael.\n\nHANDOFF: michael-brown | Clemens would like to talk with you.`;
    const result = parseHandoffDirective(text);
    expect(result).toEqual({
      targetAgentId: 'michael-brown',
      note: 'Clemens would like to talk with you.',
    });
  });

  // Spec path 2: FORWARD_TO: variant
  it('parses FORWARD_TO: with note', () => {
    const result = parseHandoffDirective('FORWARD_TO: sarah-morgan | Please help Clemens with the UI.');
    expect(result).toEqual({ targetAgentId: 'sarah-morgan', note: 'Please help Clemens with the UI.' });
  });

  it('parses FORWARD_TO: without note', () => {
    const result = parseHandoffDirective('FORWARD_TO: sarah-morgan');
    expect(result).toEqual({ targetAgentId: 'sarah-morgan', note: '' });
  });

  it('is case-insensitive (handoff: lowercase)', () => {
    const result = parseHandoffDirective('handoff: michael-brown | note');
    expect(result).toEqual({ targetAgentId: 'michael-brown', note: 'note' });
  });

  it('returns null when no directive present', () => {
    expect(parseHandoffDirective('Sure, I can help with that!')).toBeNull();
    expect(parseHandoffDirective('')).toBeNull();
    expect(parseHandoffDirective('HANDOFFNOTE: something')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// stripHandoffDirective — must also strip FORWARD_TO:
// ────────────────────────────────────────────────────────────────────────────

describe('stripHandoffDirective', () => {
  it('removes HANDOFF: line, leaving the visible text', () => {
    const input = "Absolutely, I'll hand you over to Michael.\n\nHANDOFF: michael-brown | note";
    expect(stripHandoffDirective(input)).toBe("Absolutely, I'll hand you over to Michael.");
  });

  it('removes FORWARD_TO: line', () => {
    const input = "Let me connect you to Sarah.\n\nFORWARD_TO: sarah-morgan | note";
    expect(stripHandoffDirective(input)).toBe('Let me connect you to Sarah.');
  });

  it('leaves text unchanged when no directive present', () => {
    const input = 'Hello, how can I help?';
    expect(stripHandoffDirective(input)).toBe(input);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sendTurn — integration tests for text-directive handoffs (paths 1, 2, 4)
//
// The regression that was broken: returning TurnResult without handedOff:true
// ────────────────────────────────────────────────────────────────────────────

function makeAgent(id: string, name: string): Agent {
  return { id, name, role: 'assistant', systemPrompt: '' } as unknown as Agent;
}

function makeCtx(llmResponse: string): { ctx: OrchestratorContext; appendMessage: ReturnType<typeof vi.fn> } {
  const appendMessage = vi.fn().mockResolvedValue(undefined);
  const agent = makeAgent('emily-davis', 'Emily Davis');

  const ctx: OrchestratorContext = {
    agent,
    workspaceRoot: '/workspace',
    sessionId: 'sess-emily-1',
    hooks: { emit: vi.fn() },
    history: [],
    toolManager:    { getToolsForAgent: vi.fn().mockReturnValue([]) } as any,
    sessionManager: {
      appendMessage,
      getSession: vi.fn().mockResolvedValue({ id: 'sess-emily-1', developerId: 'clemens' }),
    } as any,
    agentManager:   { recordInteraction: vi.fn().mockResolvedValue(undefined) } as any,
    skillManager:   {} as any,
    contextManager: {} as any,
    llmService: {
      chat: vi.fn().mockResolvedValue(llmResponse),
      stream: vi.fn().mockImplementation(async (_agent: any, _msgs: any, _opts: any, cb: any) => {
        // stream emits one chunk then ends
        cb({ type: 'text', text: llmResponse });
        cb({ type: 'done', usage: 0 });
        return { usage: 0 };
      }),
    } as any,
  };

  return { ctx, appendMessage };
}

function makePlugins(): ResolvedPlugins {
  return {
    compressor:    { compress: (_h: ChatMessage[]) => Promise.resolve(_h) } as any,
    contextBuilder: {
      build: (_h: ChatMessage[]) => Promise.resolve([{ role: 'user', content: 'hi' }])
    } as any,
    enrichers:     [],
    ragProvider:   { retrieve: vi.fn().mockResolvedValue(null) } as any,
    toolResolver:  { resolve: vi.fn().mockReturnValue([]) } as any,
    mcpGateway:    { listTools: vi.fn().mockResolvedValue([]) } as any,
    llmSelector:   { select: (_ctx: OrchestratorContext) => _ctx.llmService } as any,
    outputHandler: {
      handle: async (_result: any, _ctx: any) => {},
    } as any,
    slashCommands: [],
  };
}

// Path 1 / 4 — HANDOFF: directive in text response
describe('sendTurn — spec path 1 / 4 (HANDOFF: text directive)', () => {
  it('sets handedOff:true and handoffTargetId when response contains HANDOFF: agentId | note', async () => {
    const llmResponse = "Absolutely, I'll hand you over to Michael.\n\nHANDOFF: michael-brown | Clemens would like to talk with you directly.";
    const { ctx } = makeCtx(llmResponse);
    const plugins = makePlugins();

    const result = await sendTurn('can i talk to michael?', plugins, ctx);

    expect(result.handedOff).toBe(true);
    expect(result.handoffTargetId).toBe('michael-brown');
    expect(result.handoffNote).toBe('Clemens would like to talk with you directly.');
  });

  it('sets handedOff:true when response contains HANDOFF: with no note', async () => {
    const llmResponse = "Sure!\n\nHANDOFF: michael-brown";
    const { ctx } = makeCtx(llmResponse);

    const result = await sendTurn('can i talk to michael?', makePlugins(), ctx);

    expect(result.handedOff).toBe(true);
    expect(result.handoffTargetId).toBe('michael-brown');
    expect(result.handoffNote).toBeUndefined();
  });

  it('strips the HANDOFF: directive from the persisted message (developer never sees it)', async () => {
    const llmResponse = "Absolutely, I'll hand you over to Michael.\n\nHANDOFF: michael-brown | note";
    const { ctx, appendMessage } = makeCtx(llmResponse);

    await sendTurn('can i talk to michael?', makePlugins(), ctx);

    const persistedMsg: ChatMessage = appendMessage.mock.calls.find(
      ([_sessionId, msg]: [string, ChatMessage]) => !msg.isHuman,
    )?.[1];
    expect(persistedMsg).toBeDefined();
    expect(persistedMsg!.content).not.toContain('HANDOFF:');
    expect(persistedMsg!.content).toContain("I'll hand you over to Michael");
  });
});

// Path 2 — FORWARD_TO: variant
describe('sendTurn — spec path 2 (FORWARD_TO: text directive)', () => {
  it('sets handedOff:true when response contains FORWARD_TO: agentId | note', async () => {
    const llmResponse = "Let me bring Sarah in.\n\nFORWARD_TO: sarah-morgan | Please help Clemens with the CSS design system.";
    const { ctx } = makeCtx(llmResponse);

    const result = await sendTurn('can sarah help?', makePlugins(), ctx);

    expect(result.handedOff).toBe(true);
    expect(result.handoffTargetId).toBe('sarah-morgan');
    expect(result.handoffNote).toBe('Please help Clemens with the CSS design system.');
  });

  it('strips FORWARD_TO: from persisted message', async () => {
    const llmResponse = "Let me bring Sarah in.\n\nFORWARD_TO: sarah-morgan | note";
    const { ctx, appendMessage } = makeCtx(llmResponse);

    await sendTurn('can sarah help?', makePlugins(), ctx);

    const persistedMsg: ChatMessage = appendMessage.mock.calls.find(
      ([_sessionId, msg]: [string, ChatMessage]) => !msg.isHuman,
    )?.[1];
    expect(persistedMsg!.content).not.toContain('FORWARD_TO:');
  });
});

// No directive — must not handoff
describe('sendTurn — no directive (normal turn)', () => {
  it('does not set handedOff when response has no directive', async () => {
    const llmResponse = 'Hi Clemens! How can I help you today?';
    const { ctx } = makeCtx(llmResponse);

    const result = await sendTurn('hello', makePlugins(), ctx);

    expect(result.handedOff).toBeFalsy();
    expect(result.handoffTargetId).toBeUndefined();
    expect(result.text).toBe(llmResponse);
  });
});
