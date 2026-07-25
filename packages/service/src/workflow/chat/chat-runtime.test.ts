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
import { workflowCommand } from '../workflow-command.js';

const noOpBackendLogService: IBackendLogService = {
  write: () => {},
};

function createResolver(
  tools?: Record<string, unknown>,
  workflowOperationRepository?: { get: (runId: string, operationKey: string) => Promise<any>; save: (record: any) => Promise<void> }
): IServiceContainer {
  const toolManager = {
    get: (name: string) => tools?.[name],
  };

  const resolver = {
    resolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.ToolManager) return toolManager;
      if (token === CORE_SERVICE_TOKENS.BackendLogService) return noOpBackendLogService;
      if (token === CORE_SERVICE_TOKENS.WorkflowOperationRepository && workflowOperationRepository) {
        return workflowOperationRepository;
      }
      throw new Error(`Unexpected token: ${String(token)}`);
    },
    tryResolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.ToolManager) return toolManager;
      if (token === CORE_SERVICE_TOKENS.BackendLogService) return noOpBackendLogService;
      if (token === CORE_SERVICE_TOKENS.WorkflowOperationRepository) {
        return workflowOperationRepository;
      }
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

  it('routes known workflow tools through guarded workflow-command substates', async () => {
    const execute = vi.fn(async () => ({ status: 'ok', data: { shouldNotRun: true } }));
    const workflowTool = {
      metadata: {
        key: 'onboarding',
        group: 'workflow',
        description: 'Onboarding workflow',
        availableIn: { cli: false, chat: true, tool: true },
      },
      [workflowCommand]: true as const,
      definitionId: 'workflow-onboarding',
      definitionVersion: '1',
      getWorkflowDefinition: () => ({
        id: 'workflow-onboarding',
        version: '1',
        description: 'Workflow tool actor',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [
          {
            id: 'complete',
            execute: async () => ({ finished: true }),
          },
        ],
      }),
      execute,
    };
    const sendTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'Running onboarding workflow tool.',
        toolRoundNeeded: true as const,
        pendingToolCall: { toolCallId: 'tc-100', toolName: 'workflow_onboarding', args: {} },
      })
      .mockResolvedValueOnce({
        text: 'Workflow output integrated.',
        toolRoundNeeded: false as const,
      });
    const savedOperations: any[] = [];
    const operationRecords = new Map<string, any>();
    const workflowOperationRepository = {
      get: vi.fn(async (_runId: string, operationKey: string) => operationRecords.get(operationKey) ?? null),
      save: vi.fn(async (record: any) => {
        savedOperations.push(record);
        operationRecords.set(record.operationKey, record);
      }),
    };
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
      new WorkflowRunner(
        createResolver({ workflow_onboarding: workflowTool }, workflowOperationRepository),
        noOpBackendLogService
      ),
      { knownWorkflowToolTargets: ['workflow_onboarding'] }
    );

    const result = await runtime.runAsync({
      message: 'Please run onboarding.',
      agentId: 'michael',
      sessionId: 'session-michael',
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Workflow output integrated.',
      hopCount: 1,
    });
    expect(sendTurn).toHaveBeenCalledTimes(2);
    expect(sendTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userMessage: expect.stringContaining('tool_call_id: tc-100'),
        options: { messageOrigin: 'internal' },
      }),
      expect.any(Object)
    );
    expect(execute).not.toHaveBeenCalled();
    expect(workflowOperationRepository.save).toHaveBeenCalledTimes(3);
    expect(savedOperations[0]).toMatchObject({
      operationKey: 'workflow-tool-start:tc-100',
      status: 'started',
      input: {
        kind: 'workflow-tool-start',
        toolName: 'workflow_onboarding',
        toolCallId: 'tc-100',
        childInvocationId: 'workflowCommand_workflowTool_workflow_onboarding',
        depth: 0,
        ancestry: [
          {
            workflowId: 'chat-runtime',
            workflowInstanceId: 'chat-runtime',
          },
        ],
        definitionVersion: '1',
      },
    });
    expect(savedOperations[1]).toMatchObject({
      operationKey: 'workflow-tool-result:tc-100',
      status: 'completed',
      input: {
        kind: 'workflow-tool-result',
        toolName: 'workflow_onboarding',
        toolCallId: 'tc-100',
      },
      output: {
        outcome: 'resume_llm',
        toolCallId: 'tc-100',
        toolName: 'workflow_onboarding',
      },
    });
    expect(savedOperations[2]).toMatchObject({
      operationKey: 'workflow-tool-start:tc-100',
      status: 'completed',
      output: {
        outcome: 'resume_llm',
        toolCallId: 'tc-100',
        toolName: 'workflow_onboarding',
      },
    });
  });

  it('routes workflow child failures into structured retryable continuation messages', async () => {
    const failingWorkflowTool = {
      metadata: {
        key: 'onboarding',
        group: 'workflow',
        description: 'Onboarding workflow',
        availableIn: { cli: false, chat: true, tool: true },
      },
      execute: vi.fn(async () => ({
        status: 'error',
        message: 'Child workflow failed.',
        error: { code: 'workflow_child_failed' },
      })),
    };
    const sendTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'Starting onboarding.',
        toolRoundNeeded: true as const,
        pendingToolCall: { toolCallId: 'tc-failed', toolName: 'workflow_onboarding', args: {} },
      })
      .mockResolvedValueOnce({
        text: 'Retried with adjusted inputs.',
        toolRoundNeeded: false as const,
      });
    const steps = new Map<ChatRuntimeStepName, ReturnType<typeof createChatRuntimeStepCommand>>([
      [
        'preturn',
        createChatRuntimeStepCommand('preturn', async () => ({ outcome: 'continue' as const })),
      ],
      ['sendTurn', createChatRuntimeStepCommand('sendTurn', sendTurn)],
      [
        'postTurnResolution',
        createChatRuntimeStepCommand('postTurnResolution', async () => ({ outcome: 'normal_complete' as const })),
      ],
      ['handoffTransition', createChatRuntimeStepCommand('handoffTransition', async () => ({}))],
    ]);
    const runtime = new ChatRuntime(
      ((step) => steps.get(step)) as ChatRuntimeStepResolver,
      new WorkflowRunner(createResolver({ workflow_onboarding: failingWorkflowTool }), noOpBackendLogService),
      { knownWorkflowToolTargets: ['workflow_onboarding'] }
    );

    const result = await runtime.runAsync({
      message: 'Run onboarding.',
      agentId: 'michael',
      sessionId: 'session-michael',
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Retried with adjusted inputs.',
      hopCount: 1,
    });
    expect(sendTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userMessage: expect.stringContaining('status: failed'),
        options: { messageOrigin: 'internal' },
      }),
      expect.any(Object)
    );
    expect(sendTurn.mock.calls[1]?.[0]?.userMessage).toContain('retry_allowed: true');
    expect(sendTurn.mock.calls[1]?.[0]?.userMessage).toContain('error_code: workflow_child_failed');
  });

  it('routes workflow child cancellations into structured retryable continuation messages', async () => {
    const cancelledWorkflowTool = {
      metadata: {
        key: 'onboarding',
        group: 'workflow',
        description: 'Onboarding workflow',
        availableIn: { cli: false, chat: true, tool: true },
      },
      execute: vi.fn(async () => ({
        status: 'cancelled',
        message: 'Child workflow cancelled by user.',
      })),
    };
    const sendTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'Starting onboarding.',
        toolRoundNeeded: true as const,
        pendingToolCall: { toolCallId: 'tc-cancelled', toolName: 'workflow_onboarding', args: {} },
      })
      .mockResolvedValueOnce({
        text: 'Proceeding after cancellation.',
        toolRoundNeeded: false as const,
      });
    const steps = new Map<ChatRuntimeStepName, ReturnType<typeof createChatRuntimeStepCommand>>([
      [
        'preturn',
        createChatRuntimeStepCommand('preturn', async () => ({ outcome: 'continue' as const })),
      ],
      ['sendTurn', createChatRuntimeStepCommand('sendTurn', sendTurn)],
      [
        'postTurnResolution',
        createChatRuntimeStepCommand('postTurnResolution', async () => ({ outcome: 'normal_complete' as const })),
      ],
      ['handoffTransition', createChatRuntimeStepCommand('handoffTransition', async () => ({}))],
    ]);
    const runtime = new ChatRuntime(
      ((step) => steps.get(step)) as ChatRuntimeStepResolver,
      new WorkflowRunner(createResolver({ workflow_onboarding: cancelledWorkflowTool }), noOpBackendLogService),
      { knownWorkflowToolTargets: ['workflow_onboarding'] }
    );

    const result = await runtime.runAsync({
      message: 'Run onboarding.',
      agentId: 'michael',
      sessionId: 'session-michael',
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Proceeding after cancellation.',
      hopCount: 1,
    });
    expect(sendTurn.mock.calls[1]?.[0]?.userMessage).toContain('status: cancelled');
    expect(sendTurn.mock.calls[1]?.[0]?.userMessage).toContain('retry_allowed: true');
  });

  it('rejects workflow-tool invocation when depth policy is exceeded', async () => {
    const execute = vi.fn(async () => ({ status: 'ok', data: { shouldNotRun: true } }));
    const sendTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'Attempting deep workflow call.',
        toolRoundNeeded: true as const,
        pendingToolCall: { toolCallId: 'tc-depth', toolName: 'workflow_onboarding', args: {} },
      })
      .mockResolvedValueOnce({
        text: 'Handled depth rejection.',
        toolRoundNeeded: false as const,
      });
    const steps = new Map<ChatRuntimeStepName, ReturnType<typeof createChatRuntimeStepCommand>>([
      [
        'preturn',
        createChatRuntimeStepCommand('preturn', async () => ({ outcome: 'continue' as const })),
      ],
      ['sendTurn', createChatRuntimeStepCommand('sendTurn', sendTurn)],
      [
        'postTurnResolution',
        createChatRuntimeStepCommand('postTurnResolution', async () => ({ outcome: 'normal_complete' as const })),
      ],
      ['handoffTransition', createChatRuntimeStepCommand('handoffTransition', async () => ({}))],
    ]);
    const runtime = new ChatRuntime(
      ((step) => steps.get(step)) as ChatRuntimeStepResolver,
      new WorkflowRunner(createResolver({ workflow_onboarding: { metadata: { key: 'onboarding', group: 'workflow', description: 'Onboarding', availableIn: { cli: false, chat: true, tool: true } }, execute } }), noOpBackendLogService),
      { knownWorkflowToolTargets: ['workflow_onboarding'] }
    );

    const result = await runtime.runAsync({
      message: 'Run onboarding.',
      agentId: 'michael',
      sessionId: 'session-michael',
      subworkflowDepth: 4,
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Handled depth rejection.',
      hopCount: 1,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(sendTurn.mock.calls[1]?.[0]?.userMessage).toContain('error_code: workflow_tool_max_depth_exceeded');
  });

  it('rejects workflow-tool invocation when it would create a cycle', async () => {
    const childStepExecute = vi.fn(async () => ({ done: true }));
    const workflowTool = {
      metadata: {
        key: 'onboarding',
        group: 'workflow',
        description: 'Onboarding workflow',
        availableIn: { cli: false, chat: true, tool: true },
      },
      [workflowCommand]: true as const,
      definitionId: 'workflow-onboarding',
      definitionVersion: '1',
      getWorkflowDefinition: () => ({
        id: 'workflow-onboarding',
        version: '1',
        description: 'Workflow tool actor',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [
          {
            id: 'should-not-run',
            execute: childStepExecute,
          },
        ],
      }),
      execute: vi.fn(async () => ({ status: 'ok' })),
    };
    const sendTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'Attempting cyclic workflow call.',
        toolRoundNeeded: true as const,
        pendingToolCall: { toolCallId: 'tc-cycle', toolName: 'workflow_onboarding', args: {} },
      })
      .mockResolvedValueOnce({
        text: 'Handled cycle rejection.',
        toolRoundNeeded: false as const,
      });
    const steps = new Map<ChatRuntimeStepName, ReturnType<typeof createChatRuntimeStepCommand>>([
      [
        'preturn',
        createChatRuntimeStepCommand('preturn', async () => ({ outcome: 'continue' as const })),
      ],
      ['sendTurn', createChatRuntimeStepCommand('sendTurn', sendTurn)],
      [
        'postTurnResolution',
        createChatRuntimeStepCommand('postTurnResolution', async () => ({ outcome: 'normal_complete' as const })),
      ],
      ['handoffTransition', createChatRuntimeStepCommand('handoffTransition', async () => ({}))],
    ]);
    const runtime = new ChatRuntime(
      ((step) => steps.get(step)) as ChatRuntimeStepResolver,
      new WorkflowRunner(createResolver({ workflow_onboarding: workflowTool }), noOpBackendLogService),
      { knownWorkflowToolTargets: ['workflow_onboarding'] }
    );

    const result = await runtime.runAsync({
      message: 'Run onboarding.',
      agentId: 'michael',
      sessionId: 'session-michael',
      workflowStack: [{ workflowId: 'workflow-onboarding' }],
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Handled cycle rejection.',
      hopCount: 1,
    });
    expect(childStepExecute).not.toHaveBeenCalled();
    expect(sendTurn.mock.calls[1]?.[0]?.userMessage).toContain('error_code: workflow_tool_cycle_detected');
  });

  it('supports sequential foreground workflow-tool children without fan-out', async () => {
    const workflowTool = {
      metadata: {
        key: 'onboarding',
        group: 'workflow',
        description: 'Onboarding workflow',
        availableIn: { cli: false, chat: true, tool: true },
      },
      [workflowCommand]: true as const,
      definitionId: 'workflow-onboarding',
      definitionVersion: '1',
      getWorkflowDefinition: () => ({
        id: 'workflow-onboarding',
        version: '1',
        description: 'Workflow tool actor',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [{ id: 'complete', execute: async () => ({ finished: true }) }],
      }),
      execute: vi.fn(async () => ({ status: 'ok', data: { shouldNotRun: true } })),
    };
    const sendTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'Start first workflow.',
        toolRoundNeeded: true as const,
        pendingToolCall: { toolCallId: 'tc-one', toolName: 'workflow_onboarding', args: {} },
      })
      .mockResolvedValueOnce({
        text: 'Start second workflow.',
        toolRoundNeeded: true as const,
        pendingToolCall: { toolCallId: 'tc-two', toolName: 'workflow_onboarding', args: {} },
      })
      .mockResolvedValueOnce({
        text: 'All workflow calls integrated.',
        toolRoundNeeded: false as const,
      });
    const savedOperations: any[] = [];
    const operationRecords = new Map<string, any>();
    const workflowOperationRepository = {
      get: vi.fn(async (_runId: string, operationKey: string) => operationRecords.get(operationKey) ?? null),
      save: vi.fn(async (record: any) => {
        savedOperations.push(record);
        operationRecords.set(record.operationKey, record);
      }),
    };
    const steps = new Map<ChatRuntimeStepName, ReturnType<typeof createChatRuntimeStepCommand>>([
      [
        'preturn',
        createChatRuntimeStepCommand('preturn', async () => ({ outcome: 'continue' as const })),
      ],
      ['sendTurn', createChatRuntimeStepCommand('sendTurn', sendTurn)],
      [
        'postTurnResolution',
        createChatRuntimeStepCommand('postTurnResolution', async () => ({ outcome: 'normal_complete' as const })),
      ],
      ['handoffTransition', createChatRuntimeStepCommand('handoffTransition', async () => ({}))],
    ]);
    const runtime = new ChatRuntime(
      ((step) => steps.get(step)) as ChatRuntimeStepResolver,
      new WorkflowRunner(createResolver({ workflow_onboarding: workflowTool }, workflowOperationRepository), noOpBackendLogService),
      { knownWorkflowToolTargets: ['workflow_onboarding'] }
    );

    const result = await runtime.runAsync({
      message: 'Run workflow tools sequentially.',
      agentId: 'michael',
      sessionId: 'session-michael',
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'All workflow calls integrated.',
      hopCount: 2,
    });
    expect(sendTurn).toHaveBeenCalledTimes(3);
    expect(sendTurn.mock.calls[1]?.[0]?.options).toEqual({ messageOrigin: 'internal' });
    expect(sendTurn.mock.calls[2]?.[0]?.options).toEqual({ messageOrigin: 'internal' });
    expect(savedOperations.filter((record) => record.operationKey === 'workflow-tool-start:tc-one')).toHaveLength(2);
    expect(savedOperations.filter((record) => record.operationKey === 'workflow-tool-start:tc-two')).toHaveLength(2);
    expect(savedOperations.filter((record) => record.operationKey.startsWith('workflow-tool-result:'))).toHaveLength(2);
  });
});
