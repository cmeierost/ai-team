import { describe, expect, it, vi } from 'vitest';
import {
  ProviderListICommand,
  ProviderModelsICommand,
  ProviderModelsRefreshICommand,
} from './models.command.js';

function createDeps() {
  const configurationStorage = {
    loadTeamConfigAsync: vi.fn().mockResolvedValue({
      version: '0.1.0',
      randomAvatarUrls: [],
      providers: {
        copilot: { kind: 'github-copilot', defaultModel: 'gpt-4o', models: [{ name: 'gpt-4o' }] },
      },
      defaultModel: { provider: 'copilot', model: 'gpt-4o' },
    }),
    loadUserConfigAsync: vi.fn().mockResolvedValue(undefined),
    saveTeamConfigAsync: vi.fn().mockResolvedValue(undefined),
    saveUserConfigAsync: vi.fn().mockResolvedValue(undefined),
  };

  const environmentStorage = {
    loadEnvFileAsync: vi.fn().mockResolvedValue({}),
  };

  const discoveryService = {
    fetchModelsAsync: vi.fn().mockResolvedValue([{ name: 'gpt-4o' }]),
  };
  const modelDiscoveryRegistry = {
    getForKind: vi.fn().mockReturnValue(discoveryService),
  };

  return {
    configurationStorage,
    environmentStorage,
    modelDiscoveryRegistry,
  };
}

describe('Provider models ICommand wrappers', () => {
  it('list/models wrappers keep provider routing metadata and execute', async () => {
    const deps = createDeps();
    const listCmd = new ProviderListICommand(
      deps.configurationStorage as any,
      deps.environmentStorage as any,
      deps.modelDiscoveryRegistry as any
    );
    const modelsCmd = new ProviderModelsICommand(
      deps.configurationStorage as any,
      deps.environmentStorage as any,
      deps.modelDiscoveryRegistry as any
    );

    expect(listCmd.cli).toEqual({ command: 'list', parentKey: 'provider' });
    expect(modelsCmd.cli).toEqual({ command: 'models', parentKey: 'provider' });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await listCmd.execute({ json: true }, undefined, { workspaceRoot: 'C:/ws' } as any);
    await modelsCmd.execute({ provider: 'copilot', json: true }, undefined, {
      workspaceRoot: 'C:/ws',
    } as any);
    logSpy.mockRestore();

    expect(deps.configurationStorage.loadTeamConfigAsync).toHaveBeenCalled();
  });

  it('refresh wrapper triggers model discovery and persists models', async () => {
    const deps = createDeps();
    const refreshCmd = new ProviderModelsRefreshICommand(
      deps.configurationStorage as any,
      deps.environmentStorage as any,
      deps.modelDiscoveryRegistry as any
    );

    await refreshCmd.execute({ provider: 'copilot' }, undefined, { workspaceRoot: 'C:/ws' } as any);

    expect(deps.modelDiscoveryRegistry.getForKind).toHaveBeenCalledWith('github-copilot');
    expect(deps.configurationStorage.saveUserConfigAsync).toHaveBeenCalled();
  });
});