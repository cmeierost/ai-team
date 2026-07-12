import { describe, expect, it, vi } from 'vitest';
import type { IServiceContainer } from '@ai-team/core';
import type { ICommandDispatcher } from '@ai-team/api-contracts';

import { COMMAND_FACTORY_TOKENS } from '@ai-team/service';
import { CliChatV2TurnRunner } from './chat-runtime-v2-cli-adapter.js';

describe('CliChatV2TurnRunner', () => {
  it('dispatches chat command through command dispatcher', async () => {
    const sessionManager = {
      getSession: vi.fn(async () => null),
      listRecentSessions: vi.fn(async () => []),
    };
    const dispatchMock = vi.fn(async () => ({ status: 'ok' }));
    const dispatcher = { dispatch: dispatchMock } as unknown as ICommandDispatcher;

    const container = {
      resolve(token: unknown) {
        if (token === COMMAND_FACTORY_TOKENS.SessionManager) {
          return sessionManager;
        }
        throw new Error(`Unexpected token: ${String(token)}`);
      },
    } as unknown as IServiceContainer;

    const runner = new CliChatV2TurnRunner(container, dispatcher);
    await runner.runTurnAsync({ message: 'hello', skipPersist: true, agentId: 'alex-morgan' });

    expect(dispatchMock).toHaveBeenCalledWith(
      'chat',
      {
        employeeId: 'alex-morgan',
        options: {
          message: 'hello',
          oneShot: true,
          disableProcessExit: true,
          suppressAutoIntroduction: true,
          sessionId: undefined,
        },
      },
      { history: [] }
    );
  });

  it('derives agentId from explicit session when only sessionId is provided', async () => {
    const sessionManager = {
      getSession: vi.fn(async () => ({ id: 'session-1', agentId: 'emily-davis' })),
      listRecentSessions: vi.fn(async () => []),
    };
    const dispatchMock = vi.fn(async () => ({ status: 'ok' }));
    const dispatcher = { dispatch: dispatchMock } as unknown as ICommandDispatcher;

    const container = {
      resolve(token: unknown) {
        if (token === COMMAND_FACTORY_TOKENS.SessionManager) {
          return sessionManager;
        }
        throw new Error(`Unexpected token: ${String(token)}`);
      },
    } as unknown as IServiceContainer;

    const runner = new CliChatV2TurnRunner(container, dispatcher);
    await runner.runTurnAsync({ message: 'hello', skipPersist: false, sessionId: 'session-1' });

    expect(dispatchMock).toHaveBeenCalledWith(
      'chat',
      expect.objectContaining({
        employeeId: 'emily-davis',
        options: expect.objectContaining({ sessionId: 'session-1' }),
      }),
      { history: [] }
    );
  });
});
