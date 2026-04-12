import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICommandClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

import { hhRefreshCommand } from './hh.js';

const client = {
  stream: clientApi.stream,
} as unknown as ICommandClient;

describe('hh command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.stream.mockReturnValue(
      (async function* () {
        yield { kind: 'started', command: 'hhRefresh', timestamp: new Date().toISOString() };
        yield { kind: 'done', command: 'hhRefresh', timestamp: new Date().toISOString() };
      })()
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards refresh command to api client', async () => {
    await hhRefreshCommand(client);

    expect(clientApi.stream).toHaveBeenCalledWith(
      {
        command: 'hhRefresh',
        payload: {},
      },
      expect.objectContaining({
        signal: expect.any(Object),
      })
    );
  });
});
