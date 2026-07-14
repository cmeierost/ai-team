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
      message: 'hello',
      maxHops: 0,
    });

    expect(response).toEqual({ status: 'ok', data: 'ok', message: 'completed' });
  });
});
