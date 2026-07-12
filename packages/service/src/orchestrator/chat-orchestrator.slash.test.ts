import { describe, expect, it, vi } from 'vitest';

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
import { ExecutionContext } from '@ai-team/core';
import { ToolSerializationService } from './services/tool-serialization-service.js';

type OrchestratorCtor = new (
  ctx: ExecutionContext,
  plugins: ResolvedPlugins,
  deps: ReturnType<typeof makeDeps>
) => {
  run(options: { message: string; contextFiles?: string[]; maxHops?: number }): Promise<string>;
};

const ORCHESTRATOR_IMPLEMENTATIONS: Array<{ name: string; Orchestrator: OrchestratorCtor }> = [
  {
    name: 'xstate-drop-in',
    Orchestrator: class {
      private readonly impl: ChatOrchestrator;

      constructor(
        ctx: ExecutionContext,
        plugins: ResolvedPlugins,
        deps: ReturnType<typeof makeDeps>
      ) {
        this.impl = new ChatOrchestrator(
          ctx,
          plugins,
          deps.toolDispatcher,
          deps.handoffOrchestrator,
          deps.hooks,
          deps.agentManager,
          deps.sessionManager,
          deps.llmService,
          deps.serialization,
          deps.emitService,
          deps.skillManager
        );
      }

      run(options: {
        message: string;
        contextFiles?: string[];
        maxHops?: number;
      }): Promise<string> {
        return this.impl.run(options);
      }
    },
  },
];

function makeDeps() {
  const emitSpy = vi.fn();
  const emitService = new EmitService(emitSpy);
  const sessionManager = {
    appendMessage: vi.fn(async () => null),
    getSession: vi.fn(async () => ({ developerId: 'dev-1' })),
    resolveHandoffSession: vi.fn(async () => ({ session: { id: 'sess-2' } })),
    getSessionMessages: vi.fn(async () => []),
  } as any;
  const agentManager = {
    getAgentAsync: vi.fn(async () => null),
    resolveAgentAsync: vi.fn(async () => []),
    getAllAgentsAsync: vi.fn(async () => []),
    recordInteractionAsync: vi.fn(async () => undefined),
  } as any;
  const llmService = {
    chat: vi.fn(async () => 'briefing'),
  } as any;

  return {
    emitSpy,
    emitService,
    sessionManager,
    agentManager,
    llmService,
    hooks: {} as any,
    toolDispatcher: { dispatch: vi.fn(async () => ({ isError: false, result: {} })) } as any,
    handoffOrchestrator: {
      tryNlForward: vi.fn(async () => null),
      executeHandoff: vi.fn(async () => true),
    } as any,
    serialization: new ToolSerializationService(),
    skillManager: {} as any,
  };
}

function makeContext(): { ctx: ExecutionContext; emitSpy: ReturnType<typeof vi.fn> } {
  const ctx = {
    agent: { id: 'hr-director', name: 'Robert Davis', role: 'hr-director' } as any,
    workspaceRoot: '/workspace',
    sessionId: 'sess-1',
    history: [],
  } as ExecutionContext;

  return { ctx, emitSpy: vi.fn() };
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
      const { ctx } = makeContext();
      const deps = makeDeps();
      const plugins = makePlugins();
      const orchestrator = new Orchestrator(ctx, plugins, deps);

      const result = await orchestrator.run({ message: '/doesnotexist' });

      expect(result).toBe('');
      expect(runSendTurnMachineAsync).not.toHaveBeenCalled();
      expect(deps.emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'log', level: 'warn' })
      );
    });

    it('persists executed slash commands as hidden tool-call messages', async () => {
      const { ctx } = makeContext();
      const deps = makeDeps();

      const plugins = makePlugins();
      plugins.commandDispatcher = {
        dispatch: vi.fn(async (_key: string, _args: unknown, _dispatchCtx: any) => {
          return { status: 'ok' as const, message: 'whoami result' };
        }),
        getCommands: vi.fn(() => []),
        getCommand: vi.fn((key: string) =>
          key === 'who'
            ? ({ key: 'who', description: 'whoami', availableIn: { chat: true } } as any)
            : undefined
        ),
      };

      const orchestrator = new Orchestrator(ctx, plugins, deps);
      const result = await orchestrator.run({ message: '/who' });

      expect(result).toBe('');
      expect(deps.sessionManager.appendMessage).toHaveBeenCalledWith(
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
      const { ctx } = makeContext();
      const deps = makeDeps();

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

      const orchestrator = new Orchestrator(ctx, plugins, deps);
      const result = await orchestrator.run({ message: '/prompt-review' });

      expect(result).toBe('llm-called');
      expect(runSendTurnMachineAsync).toHaveBeenCalledWith(
        expect.objectContaining({ userMessage: promptText })
      );
      expect(deps.sessionManager.appendMessage).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          content: '/prompt-review',
          hiddenFromLlm: true,
        })
      );
    });

    it('resolves grouped slash commands by unqualified key (e.g. /help -> system-help)', async () => {
      const { ctx } = makeContext();
      const deps = makeDeps();

      const plugins = makePlugins();
      plugins.commandDispatcher = {
        dispatch: vi.fn(async () => ({ status: 'ok' as const, message: 'help text' })),
        getCommands: vi.fn(() => [
          {
            key: 'help',
            group: 'system',
            description: 'Show help',
            availableIn: { chat: true },
          } as any,
        ]),
        getCommand: vi.fn(() => undefined),
      };

      const orchestrator = new Orchestrator(ctx, plugins, deps);
      const result = await orchestrator.run({ message: '/help' });

      expect(result).toBe('');
      expect(plugins.commandDispatcher.dispatch).toHaveBeenCalledWith('system-help', '', ctx);
    });
  }
);
