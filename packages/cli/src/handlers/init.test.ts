import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICliCommandClient } from '../cli-command-client.js';

const clientApi = vi.hoisted(() => ({
  streamInteraction: vi.fn(),
}));

import { renderInit } from './init.js';

const client = {
  streamInteraction: clientApi.streamInteraction,
} as unknown as ICliCommandClient;

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield { kind: 'started', command: 'init', timestamp: new Date().toISOString() };
        yield { kind: 'done', command: 'init', timestamp: new Date().toISOString() };
      })()
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires question responders through stream context', async () => {
    await renderInit(client, { force: true });

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'init',
        payload: { options: { force: true } },
      },
      expect.objectContaining({
        questionInput: expect.any(Function),
        questionConfirm: expect.any(Function),
        questionSelect: expect.any(Function),
        questionPassword: expect.any(Function),
      })
    );
  });
});
