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
});
