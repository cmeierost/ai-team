import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTeamClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

import { initCommand } from './init.js';

const client = {
  stream: clientApi.stream,
} as unknown as AiTeamClient;

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.stream.mockReturnValue((async function* () {
      yield { kind: 'started', command: 'init', timestamp: new Date().toISOString() };
      yield { kind: 'done', command: 'init', timestamp: new Date().toISOString() };
    })());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires question responders through stream context', async () => {
    await initCommand(client, { force: true });

    expect(clientApi.stream).toHaveBeenCalledWith(
      {
        command: 'init',
        payload: { options: { force: true } },
      },
      expect.objectContaining({
        questionInput: expect.any(Function),
        questionConfirm: expect.any(Function),
        questionSelect: expect.any(Function),
        questionPassword: expect.any(Function),
      }),
    );
  });
});
