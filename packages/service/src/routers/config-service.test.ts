import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from './config-service.js';

describe('ConfigService', () => {
  const agentManager = {
    refreshAsync: vi.fn(async () => undefined),
    getAllAgentsAsync: vi.fn(async () => []),
    getAgentAsync: vi.fn(async () => undefined),
    updateAgentAsync: vi.fn(async () => undefined),
  };

  const configurationStorage = {
    get: vi.fn(),
    set: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new ConfigService('C:/workspace', agentManager as any, configurationStorage as any);
  }

  it('returns full config from storage', async () => {
    const config = { version: '0.1.0', providers: { demo: { kind: 'openai-compatible' } } };
    configurationStorage.get.mockReturnValue(config);

    const service = createService();
    await expect(service.getConfig()).resolves.toBe(config as any);
  });

  it('updates config keys and returns latest config', async () => {
    configurationStorage.get.mockReturnValue({ version: '0.1.0', projectName: 'AI-Team' });
    const service = createService();

    const updated = await service.updateConfig({ projectName: 'AI Team X' } as any);

    expect(configurationStorage.set).toHaveBeenCalledWith('projectName', 'AI Team X');
    expect(updated).toEqual({ version: '0.1.0', projectName: 'AI-Team' });
  });

  it('returns user config projection', async () => {
    configurationStorage.get.mockReturnValue({
      version: '0.1.0',
      developer: { name: 'Clemens' },
      providers: { demo: { kind: 'openai-compatible' } },
      defaultModel: { provider: 'demo', model: 'best-chat' },
      modelKeys: { best: { provider: 'demo', model: 'best-chat' } },
      systemModels: { title: { provider: 'demo', model: 'best-chat' } },
    });

    const service = createService();
    const result = await service.getUserConfig();

    expect(result).toEqual({
      developer: { name: 'Clemens' },
      providers: { demo: { kind: 'openai-compatible' } },
      defaultModel: { provider: 'demo', model: 'best-chat' },
      modelKeys: { best: { provider: 'demo', model: 'best-chat' } },
      systemModels: { title: { provider: 'demo', model: 'best-chat' } },
    });
  });

  it('saves user config values to user scope', async () => {
    configurationStorage.get.mockReturnValue({ version: '0.1.0' });

    const service = createService();
    await service.saveUserConfig({
      defaultModel: { provider: 'demo', model: 'best-chat' },
      providers: { demo: { kind: 'openai-compatible' } as any },
    });

    expect(configurationStorage.set).toHaveBeenCalledWith(
      'defaultModel',
      { provider: 'demo', model: 'best-chat' },
      'user'
    );
    expect(configurationStorage.set).toHaveBeenCalledWith(
      'providers',
      { demo: { kind: 'openai-compatible' } },
      'user'
    );
  });
});
