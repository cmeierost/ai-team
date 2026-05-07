import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  agentManager: {
    refreshAsync: vi.fn(async () => undefined),
    getAllAgentsAsync: vi.fn(async () => []),
    getAgentAsync: vi.fn(async () => undefined),
    updateAgentAsync: vi.fn(async () => undefined),
  },
  configurationStorage: {
    loadTeamConfigAsync: vi.fn(),
    saveTeamConfigAsync: vi.fn(),
    loadUserConfigAsync: vi.fn(),
    saveUserConfigAsync: vi.fn(),
  },
  environmentStorage: {
    loadEnvFileAsync: vi.fn(),
    saveEnvFileAsync: vi.fn(),
  },
  llmProviderTester: {
    testLlmConnectionAsync: vi.fn(),
  },
};

import { ConfigService } from './config-service.js';

describe('ConfigService.testProviderConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configurationStorage.loadUserConfigAsync.mockResolvedValue({});
    mocks.configurationStorage.loadTeamConfigAsync.mockResolvedValue({});
    mocks.environmentStorage.loadEnvFileAsync.mockResolvedValue({});
    mocks.llmProviderTester.testLlmConnectionAsync.mockResolvedValue('Connection successful!');
  });

  function createService() {
    return new ConfigService(
      'C:/workspace',
      mocks.agentManager as any,
      mocks.configurationStorage as any,
      mocks.environmentStorage as any,
      mocks.llmProviderTester as any
    );
  }

  it('returns success for configured openai-compatible provider in user config', async () => {
    mocks.configurationStorage.loadUserConfigAsync.mockResolvedValue({
      providers: {
        demo: {
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'qwen2.5-coder:7b',
          apiKeyEnvVar: 'DEMO_API_KEY',
        },
      },
    });
    mocks.environmentStorage.loadEnvFileAsync.mockResolvedValue({ DEMO_API_KEY: 'secret' });

    const service = createService();
    const result = await service.testProviderConnection('demo');

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Connection successful!');
    expect(mocks.llmProviderTester.testLlmConnectionAsync).toHaveBeenCalledWith(
      {
        provider: 'openai-compatible',
        model: 'qwen2.5-coder:7b',
        baseUrl: 'http://localhost:11434/v1',
        params: undefined,
      },
      'secret'
    );
  });

  it('returns missing-provider error when providerRef is unknown', async () => {
    const service = createService();
    const result = await service.testProviderConnection('missing');

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unknown provider 'missing'.");
    expect(mocks.llmProviderTester.testLlmConnectionAsync).not.toHaveBeenCalled();
  });

  it('returns baseUrl error for openai-compatible provider without baseUrl', async () => {
    mocks.configurationStorage.loadUserConfigAsync.mockResolvedValue({
      providers: {
        broken: {
          kind: 'openai-compatible',
          defaultModel: 'qwen2.5-coder:7b',
        },
      },
    });

    const service = createService();
    const result = await service.testProviderConnection('broken');

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Provider 'broken' is openai-compatible but has no baseUrl.");
    expect(mocks.llmProviderTester.testLlmConnectionAsync).not.toHaveBeenCalled();
  });

  it('returns provider test error when testLlmConnection throws', async () => {
    mocks.configurationStorage.loadUserConfigAsync.mockResolvedValue({
      providers: {
        demo: {
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'qwen2.5-coder:7b',
        },
      },
    });
    mocks.llmProviderTester.testLlmConnectionAsync.mockRejectedValue(new Error('boom'));

    const service = createService();
    const result = await service.testProviderConnection('demo');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });
});
