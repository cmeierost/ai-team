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
