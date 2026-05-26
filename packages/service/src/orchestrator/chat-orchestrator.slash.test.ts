import { describe, expect, it, vi } from 'vitest';
import { emitEvent } from './stream-events.js';

vi.mock('../workflow/send-turn-machine.js', () => ({
  runSendTurnMachineAsync: vi.fn(async () => ({
    chatResult: { text: 'llm-called', toolRoundNeeded: false },
    turnResult: { text: 'llm-called', done: false },
  })),
}));

import { ChatOrchestrator } from './chat-orchestrator.js';
import { runSendTurnMachineAsync } from '../workflow/send-turn-machine.js';
import type { ResolvedPlugins } from './pipeline.js';
import type { CommandResponse, ICommandDispatcher } from '@ai-team/api-contracts';
import { EmitService } from './services/emit-service.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import { setServiceContainer } from '../service-registry.js';
import { ExecutionContext } from '@ai-team/core';

type OrchestratorCtor = new (
  ctx: ExecutionContext,
  plugins: ResolvedPlugins
) => {
  run(options: { message: string; contextFiles?: string[]; maxHops?: number }): Promise<string>;
};

const ORCHESTRATOR_IMPLEMENTATIONS: Array<{ name: string; Orchestrator: OrchestratorCtor }> = [
  { name: 'xstate-drop-in', Orchestrator: ChatOrchestrator },
];

function makeContext(): { ctx: ExecutionContext; emitSpy: ReturnType<typeof vi.fn> } {
  const ctx = {
    agent: { id: 'hr-director', name: 'Robert Davis', role: 'hr-director' } as any,
    workspaceRoot: '/workspace',
    sessionId: 'sess-1',
    hooks: {} as any,
    toolManager: {} as any,
    sessionManager: {} as any,
    agentManager: { loadAllAgents: vi.fn(async () => {}) } as any,
    skillManager: {} as any,
    history: [],
  } as ExecutionContext;

  const emitSpy = vi.fn();
  const emitService = new EmitService(emitSpy);
  setServiceContainer({
    resolve: (token: { id?: string }) => {
      if (token?.id === COMMAND_FACTORY_TOKENS.EmitService.id) {
        return emitService;
      }
      throw new Error(`Unexpected token: ${String(token?.id)}`);
    },
  } as any);

  return { ctx, emitSpy };
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
    } as ICommandDispatcher,
    turnResultParsers: [],
  };
}

describe.each(ORCHESTRATOR_IMPLEMENTATIONS)(
  'ChatOrchestrator slash handling [$name]',
  ({ Orchestrator }) => {
    it('consumes unknown slash commands and does not forward to LLM turn execution', async () => {
      const { ctx, emitSpy } = makeContext();
      const plugins = makePlugins();
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: '/doesnotexist' });

      expect(result).toBe('');
      expect(runSendTurnMachineAsync).not.toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'log', level: 'warn' }));
    });

    it('persists executed slash commands as hidden tool-call messages', async () => {
      const appendMessage = vi.fn(async () => null);
      const { ctx } = makeContext();
      (ctx.sessionManager as any) = { appendMessage };

      const plugins = makePlugins();
      plugins.commandDispatcher = {
        dispatch: vi.fn(async (_key: string, _args: unknown, _dispatchCtx: any) => {
          emitEvent({ kind: 'log', level: 'info', message: 'whoami result' } as any);
          return { status: 'ok' as const, message: '' };
        }),
        getCommands: vi.fn(() => []),
        getCommand: vi.fn((key: string) =>
          key === 'who'
            ? ({ key: 'who', description: 'whoami', availableIn: { chat: true } } as any)
            : undefined
        ),
      };

      const orchestrator = new Orchestrator(ctx, plugins);
      const result = await orchestrator.run({ message: '/who' });

      expect(result).toBe('');
      expect(appendMessage).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          from: 'human',
          isHuman: true,
          content: '/who',
          hiddenFromLlm: true,
          tool_calls: [
            expect.objectContaining({
              tool: 'slash_who',
              result: expect.objectContaining({
                output: expect.stringContaining('whoami result'),
              }),
            }),
          ],
        })
      );
      expect(runSendTurnMachineAsync).not.toHaveBeenCalled();
    });

    it('continues to LLM with prompt text when a prompt slash command is invoked', async () => {
      const appendMessage = vi.fn(async () => null);
      const { ctx } = makeContext();
      (ctx.sessionManager as any) = { appendMessage };

      const promptText = 'You are a strict reviewer. Find edge cases.';
      const plugins = makePlugins();
      plugins.commandDispatcher = {
        dispatch: vi.fn(
          async (): Promise<CommandResponse> => ({
            status: 'ok',
            message: 'Loaded prompt "prompt-review".',
            data: { source: 'prompt', promptText },
          })
        ),
        getCommands: vi.fn(() => []),
        getCommand: vi.fn((key: string) =>
          key === 'prompt-review'
            ? ({
                key: 'prompt-review',
                description: 'load prompt',
                availableIn: { chat: true },
              } as any)
            : undefined
        ),
      };

      const orchestrator = new Orchestrator(ctx, plugins);
      const result = await orchestrator.run({ message: '/prompt-review' });

      expect(result).toBe('llm-called');
      expect(runSendTurnMachineAsync).toHaveBeenCalledWith(
        expect.objectContaining({ userMessage: promptText })
      );
      expect(appendMessage).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          content: '/prompt-review',
          hiddenFromLlm: true,
        })
      );
    });
  }
);
