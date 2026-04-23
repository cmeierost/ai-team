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

vi.mock('./handoff.js', () => ({
  executeHandoff: vi.fn(async () => true),
  tryNlForward: vi.fn(async () => null),
}));

import { XStateChatOrchestrator } from './xstate-chat-orchestrator.js';
import { runChatLoopWorkflowAsync } from '../workflow/xstate-chat-loop-engine.js';
import { runSendTurnMachineAsync } from '../workflow/send-turn-machine.js';
import { tryNlForward } from './handoff.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins } from './pipeline.js';

function makeContext(): OrchestratorContext {
  return {
    agent: { id: 'emily-davis', name: 'Emily Davis', role: 'frontend-developer' } as any,
    workspaceRoot: '/workspace',
    sessionId: 'sess-1',
    hooks: { emit: vi.fn() } as any,
    toolManager: {} as any,
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
    slashCommands: [],
    turnResultParsers: [],
  };
}

describe('XStateChatOrchestrator parity guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tryNlForward).mockResolvedValue(null);
  });

  it('passes maxHops through to chat-loop workflow engine', async () => {
    vi.mocked(runChatLoopWorkflowAsync).mockResolvedValue({
      status: 'completed',
      text: 'ok',
      hopCount: 0,
    } as any);

    const orchestrator = new XStateChatOrchestrator(makeContext(), makePlugins());

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

    const orchestrator = new XStateChatOrchestrator(makeContext(), makePlugins());

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
    vi.mocked(tryNlForward).mockResolvedValue('forwarded');
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

    const orchestrator = new XStateChatOrchestrator(makeContext(), makePlugins());

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

    const orchestrator = new XStateChatOrchestrator(makeContext(), makePlugins());

    await expect(orchestrator.run({ message: 'hello' })).rejects.toThrow('engine exploded');
  });
});
