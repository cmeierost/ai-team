import { describe, expect, it, vi } from 'vitest';

vi.mock('./send-turn.js', () => ({
  sendTurn: vi.fn(async () => ({ text: 'llm-called', done: false })),
}));

import { XStateChatOrchestrator } from './xstate-chat-orchestrator.js';
import { sendTurn } from './send-turn.js';
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
  return {
    agent: { id: 'hr-director', name: 'Robert Davis', role: 'hr-director' } as any,
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
    turnResultParsers: [],
  };
}

describe.each(ORCHESTRATOR_IMPLEMENTATIONS)(
  'ChatOrchestrator slash handling [$name]',
  ({ Orchestrator }) => {
    it('consumes unknown slash commands and does not forward to LLM turn execution', async () => {
      const ctx = makeContext();
      const plugins = makePlugins();
      const orchestrator = new Orchestrator(ctx, plugins);

      const result = await orchestrator.run({ message: '/doesnotexist' });

      expect(result).toBe('');
      expect(sendTurn).not.toHaveBeenCalled();
      expect(ctx.hooks.emit as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'log', level: 'warn' })
      );
    });

    it('persists executed slash commands as hidden tool-call messages', async () => {
      const appendMessage = vi.fn(async () => null);
      const ctx = makeContext();
      (ctx.sessionManager as any) = { appendMessage };

      const plugins = makePlugins();
      plugins.slashCommands = [
        {
          key: 'who',
          description: 'whoami',
          execute: vi.fn(async (_args: string, slashCtx: OrchestratorContext) => {
            slashCtx.hooks.emit?.({ kind: 'log', level: 'info', message: 'whoami result' } as any);
          }),
        } as any,
      ];

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
      expect(sendTurn).not.toHaveBeenCalled();
    });
  }
);
