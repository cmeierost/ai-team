import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICliCommandClient } from '../cli-command-client.js';

const clientApi = vi.hoisted(() => ({
  streamInteraction: vi.fn(),
  withQuestionService: vi.fn(),
}));

import { renderInit } from './init.js';

const client = {
  streamInteraction: clientApi.streamInteraction,
  withQuestionService: clientApi.withQuestionService,
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
    clientApi.withQuestionService.mockReturnValue({ streamInteraction: clientApi.streamInteraction });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires question responders through withQuestionService', async () => {
    await renderInit(client, { force: true });

    expect(clientApi.withQuestionService).toHaveBeenCalledWith(expect.any(Object));
    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'init',
        payload: { options: { force: true } },
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });
});
