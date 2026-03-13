import { describe, expect, it, vi } from 'vitest';

vi.mock('./send-turn.js', () => ({
  sendTurn: vi.fn(async () => ({ text: 'llm-called', done: false })),
}));

import { ChatOrchestrator } from './chat-orchestrator.js';
import { sendTurn } from './send-turn.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins } from './pipeline.js';

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
  };
}

describe('ChatOrchestrator slash handling', () => {
  it('consumes unknown slash commands and does not forward to LLM turn execution', async () => {
    const ctx = makeContext();
    const plugins = makePlugins();
    const orchestrator = new ChatOrchestrator(ctx, plugins);

    const result = await orchestrator.run({ message: '/doesnotexist' });

    expect(result).toBe('');
    expect(sendTurn).not.toHaveBeenCalled();
    expect((ctx.hooks.emit as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'log', level: 'warn' }),
    );
  });
});
