import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTeamClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

import { testConnectionCommand } from './test-connection.js';

const client = {
  stream: clientApi.stream,
} as unknown as AiTeamClient;

describe('test-connection command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.stream.mockReturnValue((async function* () {
      yield { kind: 'started', command: 'testConnection', timestamp: new Date().toISOString() };
      yield { kind: 'done', command: 'testConnection', timestamp: new Date().toISOString() };
    })());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards model/model-key options to api client', async () => {
    await testConnectionCommand(client, { model: 'gpt-4o', modelKey: 'gpt-4o-mini' });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'testConnection',
      payload: { options: { model: 'gpt-4o', modelKey: 'gpt-4o-mini' } },
    }, expect.objectContaining({
      signal: expect.any(Object),
    }));
  });

  it('forwards employee-specific test options to api client', async () => {
    await testConnectionCommand(client, { employee: 'maya' });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'testConnection',
      payload: { options: { employee: 'maya' } },
    }, expect.objectContaining({
      signal: expect.any(Object),
    }));
  });

  it('forwards all-mode options to api client', async () => {
    await testConnectionCommand(client, { all: true, provider: 'local' });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'testConnection',
      payload: { options: { all: true, provider: 'local' } },
    }, expect.objectContaining({
      signal: expect.any(Object),
    }));
  });
});
