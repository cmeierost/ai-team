import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workflow/send-turn-machine.js', () => ({
  runSendTurnMachineAsync: vi.fn(async () => ({
    chatResult: { text: 'llm-called', toolRoundNeeded: false },
    turnResult: { text: 'llm-called', done: false },
  })),
}));

vi.mock('./tool-dispatch.js', () => ({
  dispatchToolCall: vi.fn(async () => ({
    toolCallId: 'regex-intent-test',
    toolName: 'fs_tree',
    result: { ok: true },
    isError: false,
  })),
}));

import { XStateChatOrchestrator } from './xstate-chat-orchestrator';
import { runSendTurnMachineAsync } from '../workflow/send-turn-machine.js';
import { dispatchToolCall } from './tool-dispatch.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins } from './pipeline.js';

type OrchestratorCtor = new (
  ctx: OrchestratorContext,
  plugins: ResolvedPlugins
) => {
  run(options: { message: string; contextFiles?: string[]; maxHops?: number }): Promise<string>;
};

const ORCHESTRATOR_IMPLEMENTATIONS: Array<{ name: string; Orchestrator: OrchestratorCtor }> = [
  { name: 'xstate-drop-in', Orchestrator: XStateChatOrchestrator },
];

function makeContext(): OrchestratorContext {
  const appendMessage = vi.fn(async () => null);
  const preLlmTools = [
    {
      key: 'tree',
      group: 'fs',
      scorePreLlmIntent: (message: string) =>
        /\b(file\s*tree|visible\s+file|visible\s+files|readable\s+file|readable\s+files)\b/i.test(
          message
        )
          ? {
              kind: 'tool' as const,
              toolName: 'fs_tree',
              args: { path: '.', maxDepth: 6, includeHidden: true },
              score: 100,
            }
          : undefined,
    },
    {
      key: 'list',
      group: 'tool',
      scorePreLlmIntent: (message: string) =>
        /\b(what\s+tools\s+can\s+you\s+use|available\s+tools)\b/i.test(message)
          ? { kind: 'tool' as const, toolName: 'tool_list', args: {}, score: 100 }
          : undefined,
    },
    {
      key: 'list',
      group: 'team',
      scorePreLlmIntent: (message: string) =>
        /\b(what\s+employees\s+do\s+we\s+have|who\s+is\s+on\s+the\s+team)\b/i.test(message)
          ? { kind: 'tool' as const, toolName: 'team_list', args: {}, score: 100 }
          : undefined,
    },
  ];

  return {
    agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' } as any,
    workspaceRoot: '/workspace',
    sessionId: 'sess-1',
    hooks: { emit: vi.fn() } as any,
    toolManager: { getForAgent: vi.fn(() => preLlmTools) } as any,
    sessionManager: { appendMessage } as any,
    agentManager: { loadAllAgents: vi.fn(async () => {}) } as any,
    skillManager: {} as any,
    llmService: {} as any,
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
    turnResultParsers: [],
  };
}

describe.each(ORCHESTRATOR_IMPLEMENTATIONS)(
  'ChatOrchestrator regex tool intents [$name]',
  ({ Orchestrator }) => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('runs fs_tree before LLM for file-visibility requests', async () => {
      const ctx = makeContext();
      const plugins = makePlugins();
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: 'show your visible file tree' });

      expect(result).toBe('llm-called');
      expect(dispatchToolCall).toHaveBeenCalledWith(
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
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({
        message: 'show your visible file tree',
        contextFiles: ['packages/service/src/orchestrator/xstate-chat-orchestrator.ts'],
      });

      expect(result).toBe('llm-called');
      expect(dispatchToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'fs_tree',
          args: { path: '.', maxDepth: 6, includeHidden: true },
        }),
        ctx,
        ['packages/service/src/orchestrator/xstate-chat-orchestrator.ts']
      );
      expect(runSendTurnMachineAsync).toHaveBeenCalled();
    });

    it('runs tool_list before LLM for tool-capability requests', async () => {
      const ctx = makeContext();
      const plugins = makePlugins();
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: 'what tools can you use?' });

      expect(result).toBe('llm-called');
      expect(dispatchToolCall).toHaveBeenCalledWith(
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
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: 'help me refactor this module' });

      expect(result).toBe('llm-called');
      expect(runSendTurnMachineAsync).toHaveBeenCalled();
    });

    it('runs team_list before LLM for employee-list questions', async () => {
      const ctx = makeContext();
      const plugins = makePlugins();
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: 'what employees do we have?' });

      expect(result).toBe('llm-called');
      expect(dispatchToolCall).toHaveBeenCalledWith(
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
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: 'who is on the team?' });

      expect(result).toBe('llm-called');
      expect(dispatchToolCall).toHaveBeenCalledWith(
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
      (ctx.toolManager as any).getForAgent = vi.fn(() => [
        {
          key: 'tree',
          group: 'fs',
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
        },
      ]);

      (dispatchToolCall as any)
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
      const orchestrator = new Orchestrator(ctx, plugins);
      const result = await orchestrator.run({ message: 'show structure please' });

      expect(result).toBe('llm-called');
      expect(dispatchToolCall).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ toolName: 'com_ask' }),
        ctx,
        undefined
      );
      expect(dispatchToolCall).toHaveBeenNthCalledWith(
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
  }
);
