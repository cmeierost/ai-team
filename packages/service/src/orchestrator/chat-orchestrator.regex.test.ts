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
  return {
    agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' } as any,
    workspaceRoot: '/workspace',
    sessionId: 'sess-1',
    hooks: { emit: vi.fn() } as any,
    toolManager: {} as any,
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

      expect(result).toBe('');
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
      expect(runSendTurnMachineAsync).not.toHaveBeenCalled();
    });

    it('runs tool_list before LLM for tool-capability requests', async () => {
      const ctx = makeContext();
      const plugins = makePlugins();
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: 'what tools can you use?' });

      expect(result).toBe('');
      expect(dispatchToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'tool_list',
          args: {},
        }),
        ctx,
        undefined
      );
      expect(runSendTurnMachineAsync).not.toHaveBeenCalled();
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

      expect(result).toBe('');
      expect(dispatchToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'team_list',
          args: {},
        }),
        ctx,
        undefined
      );
      expect(runSendTurnMachineAsync).not.toHaveBeenCalled();
    });

    it('matches team roster phrasing variants', async () => {
      const ctx = makeContext();
      const plugins = makePlugins();
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: 'who is on the team?' });

      expect(result).toBe('');
      expect(dispatchToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'team_list',
          args: {},
        }),
        ctx,
        undefined
      );
      expect(runSendTurnMachineAsync).not.toHaveBeenCalled();
    });
  }
);
