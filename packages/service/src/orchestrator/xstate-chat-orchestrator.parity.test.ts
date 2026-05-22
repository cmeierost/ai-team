import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../workflow/xstate-chat-loop-engine.js', () => ({
  runChatLoopWorkflowAsync: vi.fn(),
}));

vi.mock('../workflow/send-turn-machine.js', () => ({
  runSendTurnMachineAsync: vi.fn(async () => ({
    chatResult: { text: 'llm-called', toolRoundNeeded: false },
    turnResult: { text: 'llm-called', done: false },
  })),
}));

import { XStateChatOrchestrator } from './xstate-chat-orchestrator.js';
import { runChatLoopWorkflowAsync } from '../workflow/xstate-chat-loop-engine.js';
import { runSendTurnMachineAsync } from '../workflow/send-turn-machine.js';
import type { ResolvedPlugins } from './pipeline.js';
import { ToolSerializationService } from './services/tool-serialization-service.js';

const serialization = new ToolSerializationService();

function buildHandoffOrchestrator() {
  return {
    tryNlForward: vi.fn(async () => null),
    executeHandoff: vi.fn(async () => true),
  } as any;
}

function buildOrchestrator(ctx: any, plugins: ResolvedPlugins, handoffOrchestrator: any) {
  const toolDispatcher = {
    dispatch: vi.fn(async () => ({
      toolCallId: 'mock',
      toolName: 'tool_list',
      result: { ok: true },
      isError: false,
    })),
  } as any;
  return new XStateChatOrchestrator(
    ctx,
    plugins,
    toolDispatcher,
    handoffOrchestrator,
    ctx.hooks,
    ctx.agentManager,
    ctx.sessionManager,
    ctx.llmService,
    serialization
  );
}

function makeContext() {
  return {
    agent: { id: 'emily-davis', name: 'Emily Davis', role: 'frontend-developer' } as any,
    workspaceRoot: '/workspace',
    sessionId: 'sess-1',
    hooks: { emit: vi.fn() } as any,
    sessionManager: {} as any,
    agentManager: {
      getAgentAsync: vi.fn(async () => null),
      resolveAgentAsync: vi.fn(async () => []),
    } as any,
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
    commandDispatcher: {
      dispatch: vi.fn(async () => ({ status: 'ok' as const, message: '' })),
      getCommands: vi.fn(() => []),
      getCommand: vi.fn(() => undefined),
    },
    turnResultParsers: [],
  };
}

describe('XStateChatOrchestrator parity guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // handled via per-test handoff stub
  });

  it('passes maxHops through to chat-loop workflow engine', async () => {
    vi.mocked(runChatLoopWorkflowAsync).mockResolvedValue({
      status: 'completed',
      text: 'ok',
      hopCount: 0,
    } as any);

    const handoffOrchestrator = buildHandoffOrchestrator();
    const orchestrator = buildOrchestrator(makeContext(), makePlugins(), handoffOrchestrator);

    const result = await orchestrator.run({ message: 'hello', maxHops: 7 });

    expect(result).toBe('ok');
    expect(runChatLoopWorkflowAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        maxHops: 7,
        autoReactMessage: expect.stringContaining('[Handoff received]'),
      }),
      expect.any(Object)
    );
  });

  it('preserves skipPersist semantics for initial, follow-up, and auto-react turns', async () => {
    vi.mocked(runChatLoopWorkflowAsync).mockImplementation(async (input: any, services: any) => {
      await services.runSendTurnAsync({ message: 'first-user-turn', hop: 0 });
      await services.runSendTurnAsync({ message: 'follow-up-hop', hop: 1 });
      await services.runSendTurnAsync({ message: input.autoReactMessage, hop: 0 });

      return {
        status: 'completed',
        text: 'done',
        hopCount: 1,
      } as any;
    });

    const handoffOrchestrator = buildHandoffOrchestrator();
    const orchestrator = buildOrchestrator(makeContext(), makePlugins(), handoffOrchestrator);

    const result = await orchestrator.run({ message: 'start' });

    expect(result).toBe('done');
    expect(runSendTurnMachineAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userMessage: 'first-user-turn',
        hop: 0,
        options: expect.objectContaining({ skipPersist: false }),
      })
    );
    expect(runSendTurnMachineAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userMessage: 'follow-up-hop',
        hop: 1,
        options: expect.objectContaining({ skipPersist: true }),
      })
    );
    expect(runSendTurnMachineAsync).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        userMessage: expect.stringContaining('[Handoff received]'),
        hop: 0,
        options: expect.objectContaining({ skipPersist: true }),
      })
    );
  });

  it('returns empty text for preturn forwarded flows (consumed by handoff path)', async () => {
    vi.mocked(runChatLoopWorkflowAsync).mockImplementation(async (_input: any, services: any) => {
      const preturn = await services.runPreturnInterceptorsAsync({
        message: 'forward me to michael',
      });

      expect(preturn).toEqual(
        expect.objectContaining({
          outcome: 'forwarded',
          autoMessage: expect.stringContaining('[Handoff received]'),
        })
      );

      return {
        status: 'completed',
        text: 'should-not-be-surfaced',
        hopCount: 0,
      } as any;
    });

    const handoffOrchestrator = buildHandoffOrchestrator();
    handoffOrchestrator.tryNlForward.mockResolvedValue('forwarded');
    const orchestrator = buildOrchestrator(makeContext(), makePlugins(), handoffOrchestrator);

    const result = await orchestrator.run({ message: 'forward me to michael' });

    expect(result).toBe('');
    expect(runSendTurnMachineAsync).not.toHaveBeenCalled();
  });

  it('throws when workflow engine reports failed status', async () => {
    vi.mocked(runChatLoopWorkflowAsync).mockResolvedValue({
      status: 'failed',
      text: '',
      hopCount: 0,
      error: 'engine exploded',
    } as any);

    const handoffOrchestrator = buildHandoffOrchestrator();
    const orchestrator = buildOrchestrator(makeContext(), makePlugins(), handoffOrchestrator);

    await expect(orchestrator.run({ message: 'hello' })).rejects.toThrow('engine exploded');
  });
});
