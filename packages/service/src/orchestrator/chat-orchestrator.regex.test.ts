import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./send-turn.js', () => ({
  sendTurn: vi.fn(async () => ({ text: 'llm-called', done: false })),
}));

vi.mock('./tool-dispatch.js', () => ({
  dispatchToolCall: vi.fn(async () => ({
    toolCallId: 'regex-intent-test',
    toolName: 'fs_tree',
    result: { ok: true },
    isError: false,
  })),
}));

import { ChatOrchestrator } from './chat-orchestrator.js';
import { sendTurn } from './send-turn.js';
import { dispatchToolCall } from './tool-dispatch.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins } from './pipeline.js';

function makeContext(): OrchestratorContext {
  return {
    agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' } as any,
    workspaceRoot: '/workspace',
    sessionId: 'sess-1',
    hooks: { emit: vi.fn() } as any,
    toolManager: {} as any,
    sessionManager: {} as any,
    agentManager: { loadAllAgents: vi.fn(async () => {}) } as any,
    skillManager: {} as any,
    llmService: {} as any,
    contextManager: {} as any,
    history: [],
  };
}

function makePlugins(): ResolvedPlugins {
  return {
    compressor: { compress: vi.fn(async (h) => h) } as any,
    contextBuilder: { build: vi.fn(async () => []) } as any,
    enrichers: [],
    ragProvider: { retrieve: vi.fn(async () => null) } as any,
    toolResolver: { resolve: vi.fn(async () => []) } as any,
    mcpGateway: { discover: vi.fn(async () => []) } as any,
    llmSelector: { select: vi.fn(async () => {}) } as any,
    outputHandler: { handle: vi.fn(async () => {}) } as any,
    slashCommands: [],
  };
}

describe('ChatOrchestrator regex tool intents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs fs_tree before LLM for file-visibility requests', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'show your visible file tree' });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'fs_tree',
        args: { path: '.', maxDepth: 6, includeHidden: true },
      }),
      ctx,
      undefined,
    );
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it('runs tool_list before LLM for tool-capability requests', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'what tools can you use?' });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'tool_list',
        args: {},
      }),
      ctx,
      undefined,
    );
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it('falls through to LLM turn when no regex intent matches', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'help me refactor this module' });

    expect(result).toBe('llm-called');
    expect(sendTurn).toHaveBeenCalled();
  });

  it('runs team_list before LLM for employee-list questions', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'what employees do we have?' });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'team_list',
        args: {},
      }),
      ctx,
      undefined,
    );
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it('matches team roster phrasing variants', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'who is on the team?' });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'team_list',
        args: {},
      }),
      ctx,
      undefined,
    );
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it('runs com_ask select before LLM for random-number selection requests', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'let me select 5 random numbers' });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'com_ask',
        args: expect.objectContaining({
          questionType: 'select',
          choices: expect.any(Array),
        }),
      }),
      ctx,
      undefined,
    );

    const call = (dispatchToolCall as ReturnType<typeof vi.fn>).mock.calls
      .find((entry) => entry?.[0]?.toolName === 'com_ask');
    const choices = call?.[0]?.args?.choices as Array<{ name: string; value: string }>;
    expect(Array.isArray(choices)).toBe(true);
    expect(choices).toHaveLength(5);
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it('runs com_ask select for "choose one of 5 random numbers" phrasing', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'let me choose one of 5 random numbers' });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'com_ask',
        args: expect.objectContaining({
          questionType: 'select',
          choices: expect.any(Array),
        }),
      }),
      ctx,
      undefined,
    );

    const call = (dispatchToolCall as ReturnType<typeof vi.fn>).mock.calls
      .find((entry) => entry?.[0]?.toolName === 'com_ask');
    const choices = call?.[0]?.args?.choices as Array<{ name: string; value: string }>;
    expect(Array.isArray(choices)).toBe(true);
    expect(choices).toHaveLength(5);
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it('runs com_ask select for "choose one of 5 random names" phrasing', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'let me choose one of 5 random names' });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'com_ask',
        args: expect.objectContaining({
          questionType: 'select',
          choices: expect.any(Array),
        }),
      }),
      ctx,
      undefined,
    );

    const call = (dispatchToolCall as ReturnType<typeof vi.fn>).mock.calls
      .find((entry) => entry?.[0]?.toolName === 'com_ask');
    const choices = call?.[0]?.args?.choices as Array<{ name: string; value: string }>;
    expect(Array.isArray(choices)).toBe(true);
    expect(choices).toHaveLength(5);
    expect(choices.every((choice) => !/^\d+$/.test(choice.value))).toBe(true);
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it('runs com_ask select from explicit numbered options in message body', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const message = [
      'let me choose one of 5 random numbers',
      'Here are 5 random numbers between 1 and 100:',
      '',
      '1) 17',
      '2) 42',
      '3) 63',
      '4) 89',
      '5) 5',
      '',
      'Reply with the number of the option you choose (1-5), or the value itself.',
    ].join('\n');

    const result = await orchestrator.run({ message });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'com_ask',
        args: expect.objectContaining({
          questionType: 'select',
          choices: [
            { name: '17', value: '17' },
            { name: '42', value: '42' },
            { name: '63', value: '63' },
            { name: '89', value: '89' },
            { name: '5', value: '5' },
          ],
        }),
      }),
      ctx,
      undefined,
    );
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it('runs com_ask confirm before LLM for yes/no question requests', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: 'ask me a yes or no question' });

    expect(result).toBe('');
    expect(dispatchToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'com_ask',
        args: expect.objectContaining({
          questionType: 'confirm',
          question: expect.any(String),
          default: true,
        }),
      }),
      ctx,
      undefined,
    );
    expect(sendTurn).not.toHaveBeenCalled();
  });
});
