import { describe, expect, it, vi } from 'vitest';
import {
  CORE_SERVICE_TOKENS,
  type IBackendLogService,
  type IServiceContainer,
} from '@ai-team/core';
import { WorkflowRunner } from '../xstate-workflow-runner.js';
import {
  ChatRuntime,
  createChatRuntimeStepCommand,
  type ChatRuntimeStepName,
  type ChatRuntimeStepResolver,
  type ChatRuntimeTurnInput,
} from './chat-runtime.js';

const noOpBackendLogService: IBackendLogService = {
  write: () => {},
};

function createResolver(): IServiceContainer {
  const toolManager = {
    get: () => undefined,
  };

  const resolver = {
    resolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.ToolManager) return toolManager;
      if (token === CORE_SERVICE_TOKENS.BackendLogService) return noOpBackendLogService;
      throw new Error(`Unexpected token: ${String(token)}`);
    },
    tryResolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.ToolManager) return toolManager;
      if (token === CORE_SERVICE_TOKENS.BackendLogService) return noOpBackendLogService;
      return undefined;
    },
    has: () => false,
    child: function () {
      return this;
    },
    register: function () {
      return this;
    },
    registerSingleton: function () {
      return this;
    },
    registerTransient: function () {
      return this;
    },
    registerScoped: function () {
      return this;
    },
    registerInstance: function () {
      return this;
    },
  };

  return resolver as unknown as IServiceContainer;
}

describe('ChatRuntime handoff routing', () => {
  it('finishes cleanly when a slash command starts an unrelated new session', async () => {
    const sendTurn = vi.fn(async () => ({
      text: 'New session started.',
      toolRoundNeeded: false as const,
      agentId: 'sarah',
      sessionId: 'session-new',
    }));
    const steps = new Map<ChatRuntimeStepName, ReturnType<typeof createChatRuntimeStepCommand>>([
      [
        'preturn',
        createChatRuntimeStepCommand('preturn', async () => ({ outcome: 'continue' as const })),
      ],
      ['sendTurn', createChatRuntimeStepCommand('sendTurn', sendTurn)],
      [
        'postTurnResolution',
        createChatRuntimeStepCommand(
          'postTurnResolution',
          async () => ({ outcome: 'normal_complete' as const })
        ),
      ],
      ['handoffTransition', createChatRuntimeStepCommand('handoffTransition', async () => ({}))],
    ]);

    const runtime = new ChatRuntime(
      ((step) => steps.get(step)) as ChatRuntimeStepResolver,
      new WorkflowRunner(createResolver(), noOpBackendLogService)
    );

    const result = await runtime.runAsync({
      message: '/session new',
      agentId: 'sarah',
      sessionId: 'session-old',
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'New session started.',
      hopCount: 0,
    });
    expect(sendTurn).toHaveBeenCalledOnce();
  });

  it('dispatches the acknowledgement turn to the session returned by the handoff transition', async () => {
    const sendTurn = vi
      .fn<
        (input: ChatRuntimeTurnInput) => Promise<{
          text: string;
          toolRoundNeeded: false;
          handoffTargetId?: string;
          agentId?: string;
          sessionId?: string;
        }>
      >()
      .mockResolvedValueOnce({
        text: 'I will hand this over.',
        toolRoundNeeded: false,
        handoffTargetId: 'emily',
        agentId: 'michael',
        sessionId: 'session-michael',
      })
      .mockResolvedValueOnce({
        text: 'Hello, I am Emily.',
        toolRoundNeeded: false,
        agentId: 'emily',
        sessionId: 'session-emily',
      });

    const steps = new Map<ChatRuntimeStepName, ReturnType<typeof createChatRuntimeStepCommand>>([
      [
        'preturn',
        createChatRuntimeStepCommand('preturn', async () => ({ outcome: 'continue' as const })),
      ],
      [
        'sendTurn',
        createChatRuntimeStepCommand('sendTurn', async (input: ChatRuntimeTurnInput) =>
          sendTurn(input)
        ),
      ],
      [
        'postTurnResolution',
        createChatRuntimeStepCommand(
          'postTurnResolution',
          async (input: { handoffTargetId?: string }) =>
            input.handoffTargetId
              ? {
                  outcome: 'handoff_required' as const,
                  handoffTargetId: input.handoffTargetId,
                }
              : { outcome: 'normal_complete' as const }
        ),
      ],
      [
        'handoffTransition',
        createChatRuntimeStepCommand('handoffTransition', async () => ({
          autoMessage: 'Please introduce yourself to the developer.',
          agentId: 'emily',
          sessionId: 'session-emily',
        })),
      ],
    ]);

    const workflowRunner = new WorkflowRunner(createResolver(), noOpBackendLogService);
    const runtime = new ChatRuntime(
      ((step) => steps.get(step)) as ChatRuntimeStepResolver,
      workflowRunner
    );

    const result = await runtime.runAsync({
      message: 'Please hand this to Emily.',
      agentId: 'michael',
      sessionId: 'session-michael',
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Hello, I am Emily.',
      hopCount: 1,
    });
    expect(sendTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userMessage: 'Please introduce yourself to the developer.',
        agentId: 'emily',
        sessionId: 'session-emily',
      })
    );
  });

  it('runs the acknowledgement in a session already switched by a slash command', async () => {
    const sendTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'Returned to Michael.',
        toolRoundNeeded: false,
        followUpMessage: 'Continue naturally after the return.',
        agentId: 'michael',
        sessionId: 'session-michael',
      })
      .mockResolvedValueOnce({
        text: 'Welcome back. I have the summary.',
        toolRoundNeeded: false,
        agentId: 'michael',
        sessionId: 'session-michael',
      });
    const postTurn = vi.fn(async () => ({ outcome: 'normal_complete' as const }));
    const handoffTransition = vi.fn(async () => ({}));
    const steps = new Map<ChatRuntimeStepName, ReturnType<typeof createChatRuntimeStepCommand>>([
      [
        'preturn',
        createChatRuntimeStepCommand('preturn', async () => ({ outcome: 'continue' as const })),
      ],
      ['sendTurn', createChatRuntimeStepCommand('sendTurn', sendTurn)],
      ['postTurnResolution', createChatRuntimeStepCommand('postTurnResolution', postTurn)],
      ['handoffTransition', createChatRuntimeStepCommand('handoffTransition', handoffTransition)],
    ]);
    const runtime = new ChatRuntime(
      ((step) => steps.get(step)) as ChatRuntimeStepResolver,
      new WorkflowRunner(createResolver(), noOpBackendLogService)
    );

    const result = await runtime.runAsync({
      message: '/return',
      agentId: 'emily',
      sessionId: 'session-emily',
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Welcome back. I have the summary.',
      hopCount: 1,
    });
    expect(sendTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userMessage: 'Continue naturally after the return.',
        agentId: 'michael',
        sessionId: 'session-michael',
        options: {
          messageOrigin: 'internal',
        },
      }),
      expect.objectContaining({
        workflowReturn: { command: 'session-handoff-return' },
      })
    );
    expect(postTurn).toHaveBeenCalledOnce();
    expect(handoffTransition).not.toHaveBeenCalled();
  });
});
