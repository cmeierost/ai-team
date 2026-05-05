import { beforeEach, describe, expect, it, vi } from 'vitest';

const infraMocks = vi.hoisted(() => ({
  AgentManager: class {
    refreshAsync = vi.fn(async () => undefined);
    getAllAgentsAsync = vi.fn(async () => []);
    getAgentAsync = vi.fn(async () => undefined);
    updateAgentAsync = vi.fn(async () => undefined);
  },
  loadTeamConfig: vi.fn(),
  saveTeamConfig: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  loadEnvFile: vi.fn(),
  saveEnvFile: vi.fn(),
  testLlmConnection: vi.fn(),
}));

vi.mock('@ai-team/infrastructure', () => ({
  AgentManager: infraMocks.AgentManager,
  loadTeamConfig: infraMocks.loadTeamConfig,
  saveTeamConfig: infraMocks.saveTeamConfig,
  loadUserConfig: infraMocks.loadUserConfig,
  saveUserConfig: infraMocks.saveUserConfig,
  loadEnvFile: infraMocks.loadEnvFile,
  saveEnvFile: infraMocks.saveEnvFile,
  testLlmConnection: infraMocks.testLlmConnection,
}));

import { ConfigService } from './config-service.js';

describe('ConfigService.testProviderConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    infraMocks.loadUserConfig.mockResolvedValue({});
    infraMocks.loadTeamConfig.mockResolvedValue({});
    infraMocks.loadEnvFile.mockResolvedValue({});
    infraMocks.testLlmConnection.mockResolvedValue('Connection successful!');
  });

  it('returns success for configured openai-compatible provider in user config', async () => {
    infraMocks.loadUserConfig.mockResolvedValue({
      providers: {
        demo: {
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'qwen2.5-coder:7b',
          apiKeyEnvVar: 'DEMO_API_KEY',
        },
      },
    });
    infraMocks.loadEnvFile.mockResolvedValue({ DEMO_API_KEY: 'secret' });

    const service = new ConfigService('C:/workspace');
    const result = await service.testProviderConnection('demo');

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Connection successful!');
    expect(infraMocks.testLlmConnection).toHaveBeenCalledWith(
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
    const service = new ConfigService('C:/workspace');
    const result = await service.testProviderConnection('missing');

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unknown provider 'missing'.");
    expect(infraMocks.testLlmConnection).not.toHaveBeenCalled();
  });

  it('returns baseUrl error for openai-compatible provider without baseUrl', async () => {
    infraMocks.loadUserConfig.mockResolvedValue({
      providers: {
        broken: {
          kind: 'openai-compatible',
          defaultModel: 'qwen2.5-coder:7b',
        },
      },
    });

    const service = new ConfigService('C:/workspace');
    const result = await service.testProviderConnection('broken');

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Provider 'broken' is openai-compatible but has no baseUrl.");
    expect(infraMocks.testLlmConnection).not.toHaveBeenCalled();
  });

  it('returns provider test error when testLlmConnection throws', async () => {
    infraMocks.loadUserConfig.mockResolvedValue({
      providers: {
        demo: {
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'qwen2.5-coder:7b',
        },
      },
    });
    infraMocks.testLlmConnection.mockRejectedValue(new Error('boom'));

    const service = new ConfigService('C:/workspace');
    const result = await service.testProviderConnection('demo');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });
});
