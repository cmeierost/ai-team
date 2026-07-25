import { describe, expect, it, vi } from 'vitest';
import { HandoffWorkflowReturnCommand, ReturnChatCommand } from './return.command.js';

describe('ReturnChatCommand', () => {
  it('executes the return command declared by the active workflow', async () => {
    const commandDispatcher = {
      dispatch: vi.fn(async () => ({
        status: 'ok',
        message: 'Returned through workflow policy.',
        data: {
          agentId: 'emily-davis',
          agentName: 'Emily Davis',
          agentRole: 'HR Director',
          sessionId: 'session-emily',
        },
      })),
    };
    const command = new ReturnChatCommand(commandDispatcher as any);
    const ctx = {
      history: [],
      workflowId: 'delegated-chat',
      workflowReturn: {
        command: 'session-handoff-return',
        args: { includeOpenQuestions: true },
      },
    } as any;

    const result = await command.execute({}, ctx);

    expect(result.status).toBe('ok');
    expect(commandDispatcher.dispatch).toHaveBeenCalledWith(
      'session-handoff-return',
      { includeOpenQuestions: true },
      ctx
    );
  });

  it('routes return attempts to the active durable workflow child', async () => {
    const commandDispatcher = { dispatch: vi.fn() };
    const workflowInteractions = {
      resolveActiveInteraction: vi.fn(async () => ({
        runId: 'onboarding:1',
        sessionId: 'ceo-session',
        actorPath: 'workflowChatInvocation_business',
        cursor: 'onboarding:1:workflowChatInvocation_business',
      })),
      dispatch: vi.fn(async () => null),
    };
    const command = new ReturnChatCommand(commandDispatcher as any, workflowInteractions);

    const result = await command.execute({}, { history: [], sessionId: 'ceo-session' } as any);

    expect(workflowInteractions.dispatch).toHaveBeenCalledWith(
      'ceo-session',
      { type: 'RETURN_ATTEMPT' },
      'onboarding:1:workflowChatInvocation_business'
    );
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ok',
      message: 'Workflow completion is being checked.',
      data: {
        workflowRunId: 'onboarding:1',
        interactionCursor: 'onboarding:1:workflowChatInvocation_business',
      },
    });
  });

  it('re-resolves and retries /return once when the interaction cursor changed concurrently', async () => {
    const commandDispatcher = { dispatch: vi.fn() };
    const workflowInteractions = {
      resolveActiveInteraction: vi
        .fn()
        .mockResolvedValueOnce({
          runId: 'onboarding:1',
          sessionId: 'ceo-session',
          actorPath: 'workflowChatInvocation_business_v1',
          cursor: 'onboarding:1:workflowChatInvocation_business_v1',
        })
        .mockResolvedValueOnce({
          runId: 'onboarding:1',
          sessionId: 'ceo-session',
          actorPath: 'workflowChatInvocation_business_v2',
          cursor: 'onboarding:1:workflowChatInvocation_business_v2',
        }),
      dispatch: vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "Workflow interaction cursor mismatch for session 'ceo-session': expected 'onboarding:1:workflowChatInvocation_business_v1', current 'onboarding:1:workflowChatInvocation_business_v2'."
          )
        )
        .mockResolvedValueOnce(null),
    };
    const command = new ReturnChatCommand(commandDispatcher as any, workflowInteractions);

    const result = await command.execute({}, { history: [], sessionId: 'ceo-session' } as any);

    expect(workflowInteractions.dispatch).toHaveBeenNthCalledWith(
      1,
      'ceo-session',
      { type: 'RETURN_ATTEMPT' },
      'onboarding:1:workflowChatInvocation_business_v1'
    );
    expect(workflowInteractions.dispatch).toHaveBeenNthCalledWith(
      2,
      'ceo-session',
      { type: 'RETURN_ATTEMPT' },
      'onboarding:1:workflowChatInvocation_business_v2'
    );
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ok',
      message: 'Workflow completion is being checked.',
      data: {
        workflowRunId: 'onboarding:1',
        interactionCursor: 'onboarding:1:workflowChatInvocation_business_v2',
      },
    });
  });

  it('returns the last completed tool response when no custom return is defined', async () => {
    const commandDispatcher = { dispatch: vi.fn() };
    const command = new ReturnChatCommand(commandDispatcher as any);

    const lastResult = {
      status: 'ok',
      message: 'Requirements analysis completed.',
      data: { gaps: ['platform', 'quality'] },
    };
    const result = await command.execute({}, {
      history: [],
      workflowId: 'one-way-workflow',
      workflowLastResult: lastResult,
    } as any);

    expect(result).toEqual({
      status: 'ok',
      message: 'Requirements analysis completed.',
      data: lastResult,
    });
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('fails clearly when the workflow has neither a return command nor a tool result', async () => {
    const command = new ReturnChatCommand({ dispatch: vi.fn() } as any);

    const result = await command.execute({}, {
      history: [],
      workflowId: 'empty-workflow',
    } as any);

    expect(result).toMatchObject({
      status: 'error',
      message: expect.stringContaining('has no completed tool result to return'),
    });
  });

  it('requires agent tool calls to quote the latest developer return signal', async () => {
    const command = new ReturnChatCommand({ dispatch: vi.fn() } as any);
    const ctx = {
      history: [
        {
          from: 'human',
          isHuman: true,
          content: 'That covers it. Please return to Emily.',
          timestamp: new Date().toISOString(),
        },
      ],
      invocationSurface: 'tool',
      callerType: 'agent',
      workflowLastResult: { status: 'ok', data: 'done' },
    } as any;

    await expect(command.execute({}, ctx)).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('requires the developer’s exact'),
    });
    await expect(
      command.execute(
        { developerSignal: 'Please return to Emily.' },
        ctx
      )
    ).resolves.toMatchObject({
      status: 'ok',
      data: { status: 'ok', data: 'done' },
    });
  });

  it('rejects a developer signal that is not from the latest visible human message', async () => {
    const command = new ReturnChatCommand({ dispatch: vi.fn() } as any);

    const result = await command.execute(
      { developerSignal: 'Please return now.' },
      {
        history: [
          {
            from: 'human',
            isHuman: true,
            content: 'Keep working on the requirements.',
            timestamp: new Date().toISOString(),
          },
        ],
        invocationSurface: 'tool',
        callerType: 'agent',
        workflowLastResult: { status: 'ok', data: 'done' },
      } as any
    );

    expect(result).toMatchObject({
      status: 'error',
      message: expect.stringContaining('latest visible developer message'),
    });
  });

  it.each(['session-return', 'return'])(
    'rejects recursive return command %s',
    async (returnCommand) => {
      const commandDispatcher = { dispatch: vi.fn() };
      const command = new ReturnChatCommand(commandDispatcher as any);

      const result = await command.execute({}, {
        history: [],
        workflowId: 'recursive-workflow',
        workflowReturn: { command: returnCommand },
      } as any);

      expect(result).toEqual({
        status: 'error',
        message: 'Workflow return command cannot invoke /return recursively.',
      });
      expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    }
  );
});

describe('HandoffWorkflowReturnCommand', () => {
  it('runs com-handoff in back mode against the persisted parent workflow frame', async () => {
    const threadManager = {
      resolveActiveSession: vi.fn(async () => ({
        session: { id: 'session-sarah' },
        state: {
          rootSessionId: 'session-emily',
          activeSessionId: 'session-sarah',
          navigationStack: [
            {
              agentId: 'emily-davis',
              agentName: 'Emily Davis',
              sessionId: 'session-emily',
            },
          ],
          updatedAt: new Date().toISOString(),
        },
      })),
    };
    const agentManager = {
      getAgentAsync: vi.fn(async () => ({
        id: 'emily-davis',
        name: 'Emily Davis',
        role: 'HR Director',
      })),
    };
    const commandDispatcher = {
      dispatch: vi.fn(async (_key: string, _params: unknown, ctx: any) => {
        ctx.agentId = 'emily-davis';
        ctx.sessionId = 'session-emily';
        return {
          status: 'ok',
          message: 'handoff complete',
          data: {
            type: 'handoff',
            targetAgentId: 'emily-davis',
            targetSessionId: 'session-emily',
            briefingNote: 'Sarah completed the requirements analysis.',
            targetWorkflowId: 'chat',
            timestamp: new Date().toISOString(),
          },
        };
      }),
    };
    const command = new HandoffWorkflowReturnCommand(
      threadManager as any,
      agentManager as any,
      commandDispatcher as any
    );
    const ctx = {
      history: [],
      agentId: 'sarah-lee',
      sessionId: 'session-sarah',
    } as any;

    const result = await command.execute({}, ctx);

    expect(commandDispatcher.dispatch).toHaveBeenCalledWith(
      'com-handoff',
      {
        targetAgentId: 'emily-davis',
        targetWorkflowId: 'chat',
        navigationIntent: 'back',
      },
      ctx
    );
    expect(result).toMatchObject({
      status: 'ok',
      data: {
        type: 'handoff',
        targetAgentId: 'emily-davis',
        targetSessionId: 'session-emily',
      },
    });
  });
});
