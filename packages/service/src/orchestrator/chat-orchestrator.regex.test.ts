import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPreLlmToolSource } from '../tools/pre-llm-intents.js';

vi.mock('../workflow/send-turn-machine.js', () => ({
  runSendTurnMachineAsync: vi.fn(async () => ({
    chatResult: { text: 'llm-called', toolRoundNeeded: false },
    turnResult: { text: 'llm-called', done: false },
  })),
}));

import { ChatOrchestrator } from './chat-orchestrator';
import { runSendTurnMachineAsync } from '../workflow/send-turn-machine.js';
import type { ResolvedPlugins } from './pipeline.js';
import { ToolSerializationService } from './services/tool-serialization-service.js';
import { EmitService } from './services/emit-service.js';
import type { ExecutionContext } from '@ai-team/core';

const serialization = new ToolSerializationService();

type TestContext = ExecutionContext & {
  workspaceRoot: string;
  hooks: Record<string, unknown>;
  emitService: EmitService;
  sessionManager: any;
  agentManager: any;
  skillManager: any;
  llmService: any;
};

const PRE_LLM_INTENT_PROVIDERS = [
  {
    resolveCandidates: (message: string) =>
      /\b(file\s*tree|visible\s+file|visible\s+files|readable\s+file|readable\s+files)\b/i.test(
        message
      )
        ? [
            {
              kind: 'tool' as const,
              toolName: 'fs_tree',
              args: { path: '.', maxDepth: 6, includeHidden: true },
              score: 100,
            },
          ]
        : [],
  },
  {
    resolveCandidates: (message: string) =>
      /\b(what\s+tools\s+can\s+you\s+use|available\s+tools)\b/i.test(message)
        ? [{ kind: 'tool' as const, toolName: 'tool_list', args: {}, score: 100 }]
        : [],
  },
  {
    resolveCandidates: (message: string) =>
      /\b(what\s+employees\s+do\s+we\s+have|who\s+is\s+on\s+the\s+team)\b/i.test(message)
        ? [{ kind: 'tool' as const, toolName: 'team_list', args: {}, score: 100 }]
        : [],
  },
];

function makeContext(): TestContext {
  const appendMessage = vi.fn(async () => null);
  const emit = vi.fn();
  const emitService = new EmitService(emit as any);

  const ctx = {
    agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' } as any,
    workspaceRoot: '/workspace',
    sessionId: 'sess-1',
    hooks: {} as any,
    emitService,
    sessionManager: { appendMessage } as any,
    agentManager: { loadAllAgents: vi.fn(async () => {}) } as any,
    skillManager: {} as any,
    llmService: {} as any,
    history: [],
  } as TestContext;

  return ctx;
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
    commandDispatcher: {
      dispatch: vi.fn(async () => ({ status: 'ok' as const, message: '' })),
      getCommands: vi.fn(() => []),
      getCommand: vi.fn(() => undefined),
    },
    turnResultParsers: [],
    preLlmIntentProviders: PRE_LLM_INTENT_PROVIDERS as any,
  };
}

describe('ChatOrchestrator regex tool intents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs fs_tree before LLM for file-visibility requests', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const toolDispatcher = {
      dispatch: vi.fn(async () => ({
        toolCallId: 'regex-intent-test',
        toolName: 'fs_tree',
        result: { ok: true },
        isError: false,
      })),
    } as any;
    const handoffOrchestrator = { tryNlForward: vi.fn(async () => null) } as any;
    const orchestrator = new ChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      ctx.hooks as any,
      ctx.agentManager as any,
      ctx.sessionManager as any,
      ctx.llmService as any,
      serialization,
      ctx.emitService,
      ctx.skillManager as any
    );

    const result = await orchestrator.run({ message: 'show your visible file tree' });

    expect(result).toBe('llm-called');
    expect(toolDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'fs_tree',
        args: { path: '.', maxDepth: 6, includeHidden: true },
      }),
      ctx,
      undefined
    );
    expect(ctx.sessionManager.appendMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        from: 'human',
        to: 'michael-brown',
        isHuman: true,
        content: 'show your visible file tree',
      }),
      ctx.llmService
    );
    expect(ctx.history).toContainEqual(
      expect.objectContaining({
        from: 'human',
        to: 'michael-brown',
        content: 'show your visible file tree',
      })
    );
    expect(runSendTurnMachineAsync).toHaveBeenCalled();
  });

  it('passes contextFiles to regex tool intents', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const toolDispatcher = {
      dispatch: vi.fn(async () => ({
        toolCallId: 'regex-intent-test',
        toolName: 'fs_tree',
        result: { ok: true },
        isError: false,
      })),
    } as any;
    const handoffOrchestrator = { tryNlForward: vi.fn(async () => null) } as any;
    const orchestrator = new ChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      ctx.hooks as any,
      ctx.agentManager as any,
      ctx.sessionManager as any,
      ctx.llmService as any,
      serialization,
      ctx.emitService,
      ctx.skillManager as any
    );

    const result = await orchestrator.run({
      message: 'show your visible file tree',
      contextFiles: ['packages/service/src/orchestrator/chat-orchestrator.ts'],
    });

    expect(result).toBe('llm-called');
    expect(toolDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'fs_tree',
        args: { path: '.', maxDepth: 6, includeHidden: true },
      }),
      ctx,
      ['packages/service/src/orchestrator/chat-orchestrator.ts']
    );
    expect(runSendTurnMachineAsync).toHaveBeenCalled();
  });

  it('runs tool_list before LLM for tool-capability requests', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const toolDispatcher = {
      dispatch: vi.fn(async () => ({
        toolCallId: 'regex-intent-test',
        toolName: 'tool_list',
        result: { ok: true },
        isError: false,
      })),
    } as any;
    const handoffOrchestrator = { tryNlForward: vi.fn(async () => null) } as any;
    const orchestrator = new ChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      ctx.hooks as any,
      ctx.agentManager as any,
      ctx.sessionManager as any,
      ctx.llmService as any,
      serialization,
      ctx.emitService,
      ctx.skillManager as any
    );

    const result = await orchestrator.run({ message: 'what tools can you use?' });

    expect(result).toBe('llm-called');
    expect(toolDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'tool_list',
        args: {},
      }),
      ctx,
      undefined
    );
    expect(runSendTurnMachineAsync).toHaveBeenCalled();
  });

  it('falls through to LLM turn when no regex intent matches', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const toolDispatcher = {
      dispatch: vi.fn(async () => ({
        toolCallId: 'regex-intent-test',
        toolName: 'tool_list',
        result: { ok: true },
        isError: false,
      })),
    } as any;
    const handoffOrchestrator = { tryNlForward: vi.fn(async () => null) } as any;
    const orchestrator = new ChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      ctx.hooks as any,
      ctx.agentManager as any,
      ctx.sessionManager as any,
      ctx.llmService as any,
      serialization,
      ctx.emitService,
      ctx.skillManager as any
    );

    const result = await orchestrator.run({ message: 'help me refactor this module' });

    expect(result).toBe('llm-called');
    expect(runSendTurnMachineAsync).toHaveBeenCalled();
  });

  it('runs team_list before LLM for employee-list questions', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const toolDispatcher = {
      dispatch: vi.fn(async () => ({
        toolCallId: 'regex-intent-test',
        toolName: 'team_list',
        result: { ok: true },
        isError: false,
      })),
    } as any;
    const handoffOrchestrator = { tryNlForward: vi.fn(async () => null) } as any;
    const orchestrator = new ChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      ctx.hooks as any,
      ctx.agentManager as any,
      ctx.sessionManager as any,
      ctx.llmService as any,
      serialization,
      ctx.emitService,
      ctx.skillManager as any
    );

    const result = await orchestrator.run({ message: 'what employees do we have?' });

    expect(result).toBe('llm-called');
    expect(toolDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'team_list',
        args: {},
      }),
      ctx,
      undefined
    );
    expect(runSendTurnMachineAsync).toHaveBeenCalled();
  });

  it('matches team roster phrasing variants', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const toolDispatcher = {
      dispatch: vi.fn(async () => ({
        toolCallId: 'regex-intent-test',
        toolName: 'team_list',
        result: { ok: true },
        isError: false,
      })),
    } as any;
    const handoffOrchestrator = { tryNlForward: vi.fn(async () => null) } as any;
    const orchestrator = new ChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      ctx.hooks as any,
      ctx.agentManager as any,
      ctx.sessionManager as any,
      ctx.llmService as any,
      serialization,
      ctx.emitService,
      ctx.skillManager as any
    );

    const result = await orchestrator.run({ message: 'who is on the team?' });

    expect(result).toBe('llm-called');
    expect(toolDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'team_list',
        args: {},
      }),
      ctx,
      undefined
    );
    expect(runSendTurnMachineAsync).toHaveBeenCalled();
  });

  it('asks for confirmation before pre-LLM tool execution when score is below 100%', async () => {
    const ctx = makeContext();
    const toolSource: IPreLlmToolSource = {
      getForAgent: () => [
        {
          metadata: { key: 'tree', group: 'fs' },
          scorePreLlmIntent: () => ({
            kind: 'tool',
            toolName: 'fs_tree',
            args: { path: '.', maxDepth: 6, includeHidden: false },
            score: 82,
            clarification: {
              ask: {
                kind: 'select',
                message: 'Choose depth',
                choices: [
                  { name: 'Quick', value: 'quick' },
                  { name: 'Deep', value: 'deep' },
                ],
                defaultText: 'quick',
              },
              resolveArgs(answer: unknown) {
                return {
                  path: '.',
                  maxDepth: answer === 'deep' ? 10 : 3,
                  includeHidden: false,
                };
              },
            },
          }),
        } as any,
      ],
    };

    const toolDispatcher = { dispatch: vi.fn() } as any;
    toolDispatcher.dispatch
      .mockImplementationOnce(async () => ({
        toolCallId: 'pre-llm-intent-ask-1',
        toolName: 'com_ask',
        result: { answer: true },
        isError: false,
      }))
      .mockImplementationOnce(async () => ({
        toolCallId: 'pre-llm-intent-2',
        toolName: 'fs_tree',
        result: { ok: true },
        isError: false,
      }));

    const plugins = makePlugins();
    const handoffOrchestrator = { tryNlForward: vi.fn(async () => null) } as any;
    const orchestrator = new ChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      ctx.hooks as any,
      ctx.agentManager as any,
      ctx.sessionManager as any,
      ctx.llmService as any,
      serialization,
      ctx.emitService,
      ctx.skillManager as any,
      toolSource
    );
    const result = await orchestrator.run({ message: 'show structure please' });

    expect(result).toBe('llm-called');
    expect(toolDispatcher.dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ toolName: 'com_ask' }),
      ctx,
      undefined
    );
    expect(toolDispatcher.dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        toolName: 'fs_tree',
        args: { path: '.', maxDepth: 6, includeHidden: false },
      }),
      ctx,
      undefined
    );
    expect(runSendTurnMachineAsync).toHaveBeenCalled();
  });
});
