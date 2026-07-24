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
  for (const parser of buildDefaultTurnResultParsers()) {
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

  it('accepts the canonical target ID returned by the handoff tool', () => {
    const ctx = makeCtx('current-agent');
    const result = parser.parse([handoffResult('unknown-agent')], '', 'persisted', ctx);

    expect(result).toMatchObject({
      text: 'persisted',
      done: false,
      handedOff: true,
      handoffTargetId: 'unknown-agent',
    });
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
    const parsers = buildDefaultTurnResultParsers();
    expect(parsers).toHaveLength(1);
  });

  it('first parser is HandoffToolResultParser', () => {
    const [first] = buildDefaultTurnResultParsers();
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
  it('replays persisted tool calls and results with a linked Chat Completions tool sequence', async () => {
    const builder = new DefaultContextBuilder();

    const messages = await builder.build(
      [
        {
          id: 42,
          from: 'emily-davis',
          isHuman: false,
          content: '',
          timestamp: '2026-07-24T09:00:00.000Z',
          tool_calls: [
            {
              id: 7,
              tool: 'com_handoff',
              params: { targetAgentId: 'sarah-lee' },
              result: { status: 'ok', message: 'Handoff requested.' },
            },
          ],
        },
      ],
      { history: [] } as any
    );

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'persisted-tool-42-7',
            type: 'function',
            function: {
              name: 'com_handoff',
              arguments: JSON.stringify({ targetAgentId: 'sarah-lee' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'persisted-tool-42-7',
        content: JSON.stringify({ status: 'ok', message: 'Handoff requested.' }),
      },
    ]);
  });

  it('sends a mirrored handoff briefing once as an attributed input that prompts a reply', async () => {
    const builder = new DefaultContextBuilder();

    const messages = await builder.build(
      [
        {
          from: 'emily-davis',
          to: 'michael-brown',
          isHuman: false,
          handoffType: 'agent-briefing',
          handoffId: 'handoff-1',
          content: 'Clemens wants to discuss what the team needs.',
          timestamp: new Date().toISOString(),
        },
      ],
      { history: [] } as any
    );

    expect(messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('[Internal handoff — Emily Davis → Michael Brown]'),
      },
    ]);
    expect(messages[0]?.content).toContain('Emily Davis wrote:');
    expect(messages[0]?.content).toContain(
      'The human developer is now your conversational counterpart.'
    );
    expect(messages[0]?.content).toContain('Respond to the developer, not Emily Davis.');
    expect(messages[0]?.content).toContain(
      'A return path to Emily Davis is available through session_return'
    );
    expect(messages[0]?.content).toContain(
      'Call it only after the developer clearly asks to return/report back'
    );
    expect(messages[0]?.content).toContain('Do not return merely because you have produced an answer');
    expect(messages[0]?.content).toContain(
      'Do not ask the developer to repeat information already included here.'
    );
    expect(messages[0]?.content).toContain('Clemens wants to discuss what the team needs.');
    expect(messages[0]?.content).not.toContain('Handoff received');
  });

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

  it('exposes session_return only when the workflow has a custom return or completed result', async () => {
    const sessionReturnTool = {
      metadata: {
        key: 'return',
        group: 'session',
        availableIn: { tool: true },
        description: 'return',
      },
    } as any;
    const toolManager = {
      getForAgent: vi.fn(() => []),
      get: vi.fn((name: string) => name === 'session_return' ? sessionReturnTool : undefined),
    } as any;
    const resolver = new DefaultToolResolver(toolManager);

    await expect(resolver.resolve(makeCtx())).resolves.toEqual([]);
    await expect(
      resolver.resolve({
        ...makeCtx(),
        workflowReturn: { command: 'session-handoff-return' },
      })
    ).resolves.toEqual([]);
    await expect(
      resolver.resolve({
        ...makeCtx(),
        workflowReturn: { command: 'session-handoff-return' },
        workflowStack: [{ workflowId: 'parent-workflow' }],
      })
    ).resolves.toEqual([sessionReturnTool]);
    await expect(
      resolver.resolve({
        ...makeCtx(),
        workflowLastResult: { status: 'ok', data: 'done' },
      })
    ).resolves.toEqual([sessionReturnTool]);
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
