/**
 * turn-result-parsers.test.ts
 *
 * Unit tests for the ITurnResultParser implementations in turn-result-parsers.ts.
 *
 * Each parser is tested in isolation so that failures point directly at the
 * responsible class, not at the full sendTurn pipeline.
 *
 * Coverage:
 *   HandoffToolResultParser — structured result from com_handoff tool
 *   TextHandoffParser       — HANDOFF:/FORWARD_TO: directive in response text
 *   buildDefaultTurnResultParsers — priority order of the default set
 *   Parser chain integration — first-non-null-wins semantics
 */

import { describe, expect, it, vi } from 'vitest';
import type { Agent, StructuredToolResult } from '@ai-team/core';
import {
  HandoffToolResultParser,
  TextHandoffParser,
  buildDefaultTurnResultParsers,
} from './turn-result-parsers.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeAgent(id: string, name = id): Agent {
  return { id, name, role: 'assistant', systemPrompt: '' } as unknown as Agent;
}

/** Minimal ExecutionContext with a two-agent roster. */
function makeCtx(currentAgentId = 'current-agent'): ExecutionContext {
  const currentAgent = makeAgent(currentAgentId);
  const targetAgent = makeAgent('target-agent', 'Target Agent');
  const roster = [currentAgent, targetAgent];

  return {
    agent: currentAgent,
    agentManager: {
      getAgent: vi.fn((id: string) => roster.find((a) => a.id === id)),
      resolveAgent: vi.fn((query: string) =>
        roster.filter((a) => a.id === query || a.name === query)
      ),
    },
  };
}

function handoffResult(
  targetAgentId: string,
  extra?: Partial<StructuredToolResult>
): StructuredToolResult {
  return {
    type: 'handoff',
    targetAgentId,
    briefingNote: 'Briefing note',
    timestamp: new Date().toISOString(),
    ...extra,
  } as StructuredToolResult;
}

function runChain(
  structuredResults: StructuredToolResult[],
  fullResponse: string,
  persistedContent: string,
  ctx: ExecutionContext
) {
  for (const parser of buildDefaultTurnResultParsers()) {
    const override = parser.parse(structuredResults, fullResponse, persistedContent, ctx);
    if (override !== null) return override;
  }
  return null;
}

// ── HandoffToolResultParser ───────────────────────────────────────────────────

describe('HandoffToolResultParser', () => {
  const parser = new HandoffToolResultParser();

  it('returns null when structuredResults contains no handoff entry', () => {
    const result = parser.parse([], 'some response', 'some response', makeCtx());
    expect(result).toBeNull();
  });

  it('returns null when structuredResults contains only non-handoff entries', () => {
    const result = parser.parse(
      [{ type: 'tool_list_result' } as StructuredToolResult],
      'text',
      'text',
      makeCtx()
    );
    expect(result).toBeNull();
  });

  it('returns handedOff:true when target is found and is not self', () => {
    const ctx = makeCtx('current-agent');
    const result = parser.parse([handoffResult('target-agent')], 'response', 'persisted', ctx);

    expect(result).toMatchObject({
      text: 'persisted',
      done: false,
      handedOff: true,
      handoffTargetId: 'target-agent',
    });
  });

  it('carries briefingNote into handoffNote', () => {
    const structured = {
      type: 'handoff',
      targetAgentId: 'target-agent',
      briefingNote: 'Briefing for the handoff',
      timestamp: '',
    } as StructuredToolResult;

    const result = parser.parse([structured], '', 'text', makeCtx());

    expect(result).toMatchObject({ handoffNote: 'Briefing for the handoff' });
  });

  it('carries targetSessionId when provided', () => {
    const structured = {
      type: 'handoff',
      targetAgentId: 'target-agent',
      briefingNote: '',
      targetSessionId: 'sess-999',
      timestamp: '',
    } as StructuredToolResult;

    const result = parser.parse([structured], '', 'text', makeCtx());

    expect(result).toMatchObject({ handoffTargetSessionId: 'sess-999' });
  });

  it('returns { done:false } (no handoff) when target agent is not found', () => {
    const ctx = makeCtx('current-agent');
    const result = parser.parse([handoffResult('unknown-agent')], '', 'persisted', ctx);

    expect(result).toEqual({ text: 'persisted', done: false });
    expect(result).not.toHaveProperty('handedOff');
  });

  it('returns { done:false } (no handoff) when target resolves to the current agent (self-handoff)', () => {
    const ctx = makeCtx('current-agent');
    const result = parser.parse([handoffResult('current-agent')], '', 'persisted', ctx);

    expect(result).toEqual({ text: 'persisted', done: false });
    expect(result).not.toHaveProperty('handedOff');
  });
});

// ── TextHandoffParser ─────────────────────────────────────────────────────────

describe('TextHandoffParser', () => {
  const parser = new TextHandoffParser();

  it('returns null when response text contains no directive', () => {
    const result = parser.parse([], 'Just a normal response.', 'normal', makeCtx());
    expect(result).toBeNull();
  });

  it('returns null for HANDOFFNOTE: (not a real directive)', () => {
    const result = parser.parse([], 'HANDOFFNOTE: something', 'text', makeCtx());
    expect(result).toBeNull();
  });

  it('returns handedOff:true for a valid HANDOFF: directive', () => {
    const ctx = makeCtx('current-agent');
    const fullResponse = 'Connecting you.\n\nHANDOFF: target-agent | Take over please.';

    const result = parser.parse([], fullResponse, 'Connecting you.', ctx);

    expect(result).toMatchObject({
      text: 'Connecting you.',
      done: false,
      handedOff: true,
      handoffTargetId: 'target-agent',
      handoffNote: 'Take over please.',
    });
  });

  it('returns handedOff:true for a FORWARD_TO: variant', () => {
    const ctx = makeCtx('current-agent');
    const fullResponse = 'Forwarding now.\n\nFORWARD_TO: target-agent | Here you go.';

    const result = parser.parse([], fullResponse, 'Forwarding now.', ctx);

    expect(result).toMatchObject({
      handedOff: true,
      handoffTargetId: 'target-agent',
      handoffNote: 'Here you go.',
    });
  });

  it('sets handoffNote to undefined when directive has no note', () => {
    const ctx = makeCtx('current-agent');
    const result = parser.parse([], 'HANDOFF: target-agent', 'text', ctx);

    expect(result).toMatchObject({ handedOff: true, handoffTargetId: 'target-agent' });
    expect(result?.handoffNote).toBeUndefined();
  });

  it('returns { done:false } (no handoff) when target agent cannot be resolved', () => {
    const ctx = makeCtx('current-agent');
    const result = parser.parse([], 'HANDOFF: nobody-exists | note', 'text', ctx);

    expect(result).toEqual({ text: 'text', done: false });
    expect(result).not.toHaveProperty('handedOff');
  });

  it('returns { done:false } (no handoff) when directive targets the current agent', () => {
    const ctx = makeCtx('current-agent');
    const result = parser.parse([], 'HANDOFF: current-agent | self-loop', 'text', ctx);

    expect(result).toEqual({ text: 'text', done: false });
    expect(result).not.toHaveProperty('handedOff');
  });
});

// ── buildDefaultTurnResultParsers ─────────────────────────────────────────────

describe('buildDefaultTurnResultParsers', () => {
  it('returns an array of two parsers', () => {
    const parsers = buildDefaultTurnResultParsers();
    expect(parsers).toHaveLength(2);
  });

  it('first parser is HandoffToolResultParser', () => {
    const [first] = buildDefaultTurnResultParsers();
    expect(first).toBeInstanceOf(HandoffToolResultParser);
  });

  it('second parser is TextHandoffParser', () => {
    const [, second] = buildDefaultTurnResultParsers();
    expect(second).toBeInstanceOf(TextHandoffParser);
  });
});

// ── Parser chain — first-non-null-wins ────────────────────────────────────────

describe('Parser chain priority', () => {
  it('tool handoff takes priority over a text handoff directive when both present', () => {
    const ctx = makeCtx('current-agent');
    const result = runChain(
      [handoffResult('target-agent')],
      'HANDOFF: target-agent | also in text',
      'text',
      ctx
    );

    // HandoffToolResultParser fires first, TextHandoffParser never runs
    expect(result).toMatchObject({ handedOff: true, handoffTargetId: 'target-agent' });
  });

  it('falls through to TextHandoffParser when no structured handoff is present', () => {
    const ctx = makeCtx('current-agent');
    const result = runChain([], 'HANDOFF: target-agent | via text', 'text', ctx);

    expect(result).toMatchObject({ handedOff: true, handoffTargetId: 'target-agent' });
  });

  it('returns null (no override) when no parser matches', () => {
    const ctx = makeCtx('current-agent');
    const result = runChain([], 'Just a normal reply.', 'Just a normal reply.', ctx);

    expect(result).toBeNull();
  });
});
