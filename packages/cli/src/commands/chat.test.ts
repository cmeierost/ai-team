import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTeamClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

import { chatCommand } from './chat.js';

const client = {
  stream: clientApi.stream,
} as unknown as AiTeamClient;

describe('chat command', () => {
  const originalMediatorLog = process.env.AI_TEAM_MEDIATOR_LOG;
  const originalFrontendFileLog = process.env.AI_TEAM_FRONTEND_FILE_LOG;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_TEAM_MEDIATOR_LOG = '0';
    process.env.AI_TEAM_FRONTEND_FILE_LOG = '0';
    clientApi.stream.mockReturnValue((async function* () {
      yield {
        kind: 'started',
        command: 'chat',
        timestamp: new Date().toISOString(),
      };
      yield {
        kind: 'done',
        command: 'chat',
        timestamp: new Date().toISOString(),
      };
    })());
  });

  afterEach(() => {
    if (originalMediatorLog === undefined) {
      delete process.env.AI_TEAM_MEDIATOR_LOG;
    } else {
      process.env.AI_TEAM_MEDIATOR_LOG = originalMediatorLog;
    }
    if (originalFrontendFileLog === undefined) {
      delete process.env.AI_TEAM_FRONTEND_FILE_LOG;
    } else {
      process.env.AI_TEAM_FRONTEND_FILE_LOG = originalFrontendFileLog;
    }
    vi.restoreAllMocks();
  });

  it('forwards chat request to api client stream', async () => {
    await chatCommand(client, 'maya', { message: 'hello', oneShot: true });

    expect(clientApi.stream).toHaveBeenCalledWith(
      {
        command: 'chat',
        payload: {
          employeeId: 'maya',
          options: { message: 'hello', oneShot: true },
        },
      },
      expect.objectContaining({
        logger: undefined,
        questionInput: expect.any(Function),
        questionConfirm: expect.any(Function),
        questionSelect: expect.any(Function),
      }),
    );
  });

  it('enables mediator logger when mediatorLog flag is passed', async () => {
    await chatCommand(client, 'maya', { message: 'hello', oneShot: true }, true);

    expect(clientApi.stream).toHaveBeenCalledWith(
      {
        command: 'chat',
        payload: {
          employeeId: 'maya',
          options: { message: 'hello', oneShot: true },
        },
      },
      expect.objectContaining({
        logger: expect.any(Function),
        questionInput: expect.any(Function),
        questionConfirm: expect.any(Function),
        questionSelect: expect.any(Function),
      }),
    );
  });
});
