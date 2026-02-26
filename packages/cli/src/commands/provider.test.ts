import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTeamClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

import { providerAddCommand, providerConfigureCommand, providerSetCommand } from './provider.js';

const client = {
  stream: clientApi.stream,
} as unknown as AiTeamClient;

describe('provider commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.stream.mockReturnValue((async function* () {
      yield { kind: 'started', command: 'providerConfigure', timestamp: new Date().toISOString() };
      yield { kind: 'done', command: 'providerConfigure', timestamp: new Date().toISOString() };
    })());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards configure options to api client', async () => {
    await providerConfigureCommand(client, { fromInit: true });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'providerConfigure',
      payload: { options: { fromInit: true } },
    });
  });

  it('forwards add command to api client', async () => {
    await providerAddCommand(client, {
      makeDefault: true,
      setup: {
        providerRef: 'local',
        providerConfig: {
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3',
        },
        legacyLlm: {
          provider: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3',
        },
      },
    });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'providerAdd',
      payload: {
        options: {
          makeDefault: true,
          setup: {
            providerRef: 'local',
            providerConfig: {
              kind: 'openai-compatible',
              baseUrl: 'http://localhost:11434/v1',
              model: 'llama3',
            },
            legacyLlm: {
              provider: 'openai-compatible',
              baseUrl: 'http://localhost:11434/v1',
              model: 'llama3',
            },
          },
        },
      },
    });
  });

  it('forwards set command to api client', async () => {
    await providerSetCommand(client, { fromInit: true });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'providerSet',
      payload: { options: { fromInit: true } },
    });
  });
});
