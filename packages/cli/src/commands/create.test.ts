import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTeamClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

import { createCommand } from './create.js';

const client = {
  stream: clientApi.stream,
} as unknown as AiTeamClient;

describe('create command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.stream.mockReturnValue((async function* () {
      yield { kind: 'started', command: 'create', timestamp: new Date().toISOString() };
      yield { kind: 'done', command: 'create', timestamp: new Date().toISOString() };
    })());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards create operation to api client', async () => {
    await createCommand(client, 'agent', { name: 'Maya', role: 'engineer', interactive: false });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'create',
      payload: {
        type: 'agent',
        options: {
          name: 'Maya',
          role: 'engineer',
          interactive: false,
        },
      },
    });
  });
});
