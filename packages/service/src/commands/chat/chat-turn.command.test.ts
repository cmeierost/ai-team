import { describe, expect, it, vi } from 'vitest';
import { ChatTurnCommand } from './chat-turn.command.js';

describe('ChatTurnCommand', () => {
  it('delegates one-shot execution to chat runtime bridge', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'completed',
        text: 'ok',
        hopCount: 0,
      })),
    };
    const command = new ChatTurnCommand(runtime as any);

    const response = await command.execute(
      {
        employeeId: 'alex-morgan',
        options: {
          message: 'hello',
          sessionId: 'session-1',
          createNewSession: false,
          suppressAutoIntroduction: true,
        },
      },
      {
        invocationSurface: 'cli',
        history: [],
      } as any
    );

    expect(runtime.runAsync).toHaveBeenCalledWith({
      agentId: 'alex-morgan',
      sessionId: 'session-1',
      createNewSession: false,
      introduction: false,
      contextFiles: undefined,
      message: 'hello',
      maxHops: 0,
      invocationSurface: 'cli',
      calledByHuman: undefined,
      callerType: undefined,
    });

    expect(response).toEqual({ status: 'ok', data: 'ok', message: 'completed' });
  });

  it('forwards execution context signal to runtime', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'completed',
        text: 'ok',
        hopCount: 0,
      })),
    };
    const command = new ChatTurnCommand(runtime as any);
    const signal = new AbortController().signal;

    await command.execute(
      {
        employeeId: 'alex-morgan',
        options: {
          message: 'hello',
        },
      },
      {
        invocationSurface: 'cli',
        history: [],
        signal,
      } as any
    );

    expect(runtime.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        signal,
      })
    );
  });
});
