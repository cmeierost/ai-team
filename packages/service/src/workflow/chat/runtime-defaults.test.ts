import { describe, expect, it, vi } from 'vitest';
import type { Agent, StructuredToolResult, ExecutionContext } from '@ai-team/core';
import {
  DefaultContextBuilder,
  DefaultToolResolver,
  HandoffToolResultParser,
  buildDefaultTurnResultParsers,
} from './runtime-defaults.js';
import { HANDOFF_AUTO_REACT_MESSAGE } from './handoff-auto-react.js';

function makeAgent(id: string, name = id): Agent {
  return { id, name, role: 'assistant', systemPrompt: '' } as unknown as Agent;
}

function makeAgentManager(currentAgentId = 'current-agent') {
  const currentAgent = makeAgent(currentAgentId);
  const targetAgent = makeAgent('target-agent', 'Target Agent');
  const roster = [currentAgent, targetAgent];
  return {
    agents: roster,
    getAgent: vi.fn((id: string) => roster.find((a) => a.id === id)),
    resolveAgent: vi.fn((query: string) =>
      roster.filter((a) => a.id === query || a.name === query)
    ),
  };
}

function makeCtx(currentAgentId = 'current-agent'): ExecutionContext {
  return {
    agent: makeAgent(currentAgentId),
    workspaceRoot: '',
    history: [],
  } as unknown as ExecutionContext;
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
  const agentManager = makeAgentManager(ctx.agent?.id);
  for (const parser of buildDefaultTurnResultParsers(agentManager as any)) {
    const override = parser.parse(structuredResults, fullResponse, persistedContent, ctx);
    if (override !== null) return override;
  }
  return null;
}

describe('HandoffToolResultParser', () => {
  const agentManager = makeAgentManager();
  const parser = new HandoffToolResultParser(agentManager as any);

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

describe('buildDefaultTurnResultParsers', () => {
  it('returns an array of one parser', () => {
    const parsers = buildDefaultTurnResultParsers(makeAgentManager() as any);
    expect(parsers).toHaveLength(1);
  });

  it('first parser is HandoffToolResultParser', () => {
    const [first] = buildDefaultTurnResultParsers(makeAgentManager() as any);
    expect(first).toBeInstanceOf(HandoffToolResultParser);
  });
});

describe('Parser chain priority', () => {
  it('tool handoff is parsed when structured handoff is present', () => {
    const ctx = makeCtx('current-agent');
    const result = runChain(
      [handoffResult('target-agent')],
      'HANDOFF: target-agent | also in text',
      'text',
      ctx
    );

    expect(result).toMatchObject({ handedOff: true, handoffTargetId: 'target-agent' });
  });

  it('returns null (no override) when no parser matches', () => {
    const ctx = makeCtx('current-agent');
    const result = runChain([], 'Just a normal reply.', 'Just a normal reply.', ctx);

    expect(result).toBeNull();
  });
});

describe('DefaultContextBuilder', () => {
  it('excludes legacy persisted handoff continuations from model context', async () => {
    const builder = new DefaultContextBuilder();

    const messages = await builder.build(
      [
        {
          from: 'human',
          to: 'michael-brown',
          isHuman: true,
          content: HANDOFF_AUTO_REACT_MESSAGE,
          timestamp: new Date().toISOString(),
        },
        {
          from: 'michael-brown',
          to: 'human',
          isHuman: false,
          content: 'Welcome back.',
          timestamp: new Date().toISOString(),
        },
      ],
      { history: [] } as any
    );

    expect(messages).toEqual([{ role: 'assistant', content: 'Welcome back.' }]);
  });
});

describe('DefaultToolResolver', () => {
  it('intersects agent tools with a workflow allow-list', async () => {
    const fsReadTool = {
      metadata: { key: 'read', group: 'fs', availableIn: { tool: true }, description: 'read' },
    } as any;
    const fsWriteTool = {
      metadata: { key: 'write', group: 'fs', availableIn: { tool: true }, description: 'write' },
    } as any;
    const resolver = new DefaultToolResolver({
      getForAgent: vi.fn(() => [fsReadTool, fsWriteTool]),
      get: vi.fn(() => undefined),
    } as any);

    const tools = await resolver.resolve({
      ...makeCtx(),
      workflowState: { workflowToolPolicy: { allow: ['fs_read'] } },
    } as ExecutionContext);

    expect(tools).toEqual([fsReadTool]);
  });

  it('keeps com_handoff available even when subworkflowDepth is greater than zero', async () => {
    const comHandoffTool = {
      metadata: {
        key: 'handoff',
        group: 'com',
        availableIn: { tool: true },
        description: 'handoff',
      },
    } as any;

    const toolManager = {
      getForAgent: vi.fn(() => [comHandoffTool]),
      get: vi.fn(() => comHandoffTool),
    } as any;

    const resolver = new DefaultToolResolver(toolManager);
    const ctx = {
      agent: makeAgent('current-agent'),
      history: [],
      subworkflowDepth: 2,
    } as unknown as ExecutionContext;

    const tools = await resolver.resolve(ctx);
    expect(tools).toEqual([comHandoffTool]);
  });

  it('restores the core handoff tool when an agent catalog omits it', async () => {
    const comHandoffTool = {
      metadata: { key: 'handoff', group: 'com', availableIn: { tool: true }, description: 'handoff' },
    } as any;
    const resolver = new DefaultToolResolver({
      getForAgent: vi.fn(() => []),
      get: vi.fn(() => comHandoffTool),
    } as any);

    await expect(resolver.resolve(makeCtx())).resolves.toEqual([comHandoffTool]);
  });

  it('hides com_handoff when workflow policy deny explicitly blocks it', async () => {
    const comHandoffTool = {
      metadata: {
        key: 'handoff',
        group: 'com',
        availableIn: { tool: true },
        description: 'handoff',
      },
    } as any;

    const toolManager = {
      getForAgent: vi.fn(() => [comHandoffTool]),
    } as any;

    const resolver = new DefaultToolResolver(toolManager);
    const ctx = {
      agent: makeAgent('current-agent'),
      history: [],
      workflowState: {
        workflowToolPolicy: {
          deny: ['com_handoff'],
        },
      },
    } as unknown as ExecutionContext;

    const tools = await resolver.resolve(ctx);
    expect(tools).toEqual([]);
  });

  it('hides com_handoff when workflow policy remove explicitly blocks it', async () => {
    const comHandoffTool = {
      metadata: {
        key: 'handoff',
        group: 'com',
        availableIn: { tool: true },
        description: 'handoff',
      },
    } as any;

    const toolManager = {
      getForAgent: vi.fn(() => [comHandoffTool]),
    } as any;

    const resolver = new DefaultToolResolver(toolManager);
    const ctx = {
      agent: makeAgent('current-agent'),
      history: [],
      workflowState: {
        toolPolicy: {
          remove: ['com_handoff'],
        },
      },
    } as unknown as ExecutionContext;

    const tools = await resolver.resolve(ctx);
    expect(tools).toEqual([]);
  });
});
