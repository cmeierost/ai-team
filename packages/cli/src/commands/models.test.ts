import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTeamClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

import { providerModelsCommand, providerModelsRefreshCommand } from './models.js';

const client = {
  stream: clientApi.stream,
} as unknown as AiTeamClient;

describe('provider models commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.stream.mockReturnValue((async function* () {
      yield { kind: 'started', command: 'providerModels', timestamp: new Date().toISOString() };
      yield { kind: 'done', command: 'providerModels', timestamp: new Date().toISOString() };
    })());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards provider models options to api client', async () => {
    await providerModelsCommand(client, { provider: 'local', json: true });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'providerModels',
      payload: { options: { provider: 'local', json: true } },
    });
  });

  it('forwards refresh options to api client', async () => {
    await providerModelsRefreshCommand(client, { provider: 'local' });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'providerModelsRefresh',
      payload: { options: { provider: 'local' } },
    });
  });
});
