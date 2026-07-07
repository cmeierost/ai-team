import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICliCommandClient } from '../cli-command-client.js';

const clientApi = vi.hoisted(() => ({
  streamInteraction: vi.fn(),
}));

import { renderProviderAdd, renderProviderConfigure, renderProviderSet } from './provider.js';

const client = {
  streamInteraction: clientApi.streamInteraction,
} as unknown as ICliCommandClient;

describe('provider commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'started',
          command: 'providerConfigure',
          timestamp: new Date().toISOString(),
        };
        yield { kind: 'done', command: 'providerConfigure', timestamp: new Date().toISOString() };
      })()
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards configure options to api client', async () => {
    await renderProviderConfigure(client, { fromInit: true });

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'providerConfigure',
        payload: { options: { fromInit: true } },
      },
      expect.objectContaining({
        signal: expect.any(Object),
      })
    );
  });

  it('forwards add command to api client', async () => {
    await renderProviderAdd(client, {
      makeDefault: true,
      setup: {
        providerRef: 'local',
        providerConfig: {
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'llama3',
          models: [{ name: 'llama3' }],
        },
      },
    });

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'providerAdd',
        payload: {
          options: {
            makeDefault: true,
            setup: {
              providerRef: 'local',
              providerConfig: {
                kind: 'openai-compatible',
                baseUrl: 'http://localhost:11434/v1',
                defaultModel: 'llama3',
                models: [{ name: 'llama3' }],
              },
            },
          },
        },
      },
      expect.objectContaining({
        signal: expect.any(Object),
      })
    );
  });

  it('forwards set command to api client', async () => {
    await renderProviderSet(client, { fromInit: true });

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'providerSet',
        payload: { options: { fromInit: true } },
      },
      expect.objectContaining({
        signal: expect.any(Object),
      })
    );
  });
});
