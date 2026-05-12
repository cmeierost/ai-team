import { describe, expect, it, vi } from 'vitest';
import {
  ProviderAddICommand,
  ProviderConfigureICommand,
  ProviderSetICommand,
} from './provider.command.js';

function createDeps() {
  const configurationStorage = {
    loadTeamConfigAsync: vi.fn().mockResolvedValue({
      version: '0.1.0',
      randomAvatarUrls: [],
      providers: {
        existing: { kind: 'github-copilot', defaultModel: 'gpt-4o' },
      },
      defaultModel: { provider: 'existing', model: 'gpt-4o' },
    }),
    loadUserConfigAsync: vi.fn().mockResolvedValue({}),
    saveTeamConfigAsync: vi.fn().mockResolvedValue(undefined),
    saveUserConfigAsync: vi.fn().mockResolvedValue(undefined),
  };

  const environmentStorage = {
    loadEnvFileAsync: vi.fn().mockResolvedValue({}),
    saveEnvFileAsync: vi.fn().mockResolvedValue(undefined),
  };

  const llmProviderTester = {
    testConnectionAsync: vi.fn().mockResolvedValue(undefined),
  };

  const modelDiscoveryRegistry = {
    getForKind: vi.fn().mockReturnValue(undefined),
  };

  return {
    configurationStorage,
    environmentStorage,
    llmProviderTester,
    modelDiscoveryRegistry,
  };
}

const setupPayload = {
  setup: {
    providerRef: 'copilot',
    providerConfig: {
      kind: 'github-copilot',
      defaultModel: 'gpt-4o',
      models: [{ name: 'gpt-4o' }],
    },
    legacyLlm: {
      provider: 'github-copilot',
      model: 'gpt-4o',
    },
  },
};

describe('Provider * ICommand wrappers', () => {
  it('configure command keeps provider command metadata and executes', async () => {
    const deps = createDeps();
    const cmd = new ProviderConfigureICommand(
      deps.configurationStorage as any,
      deps.environmentStorage as any,
      deps.llmProviderTester as any,
      deps.modelDiscoveryRegistry as any
    );

    expect(cmd.key).toBe('providerConfigure');
    expect(cmd.cli).toEqual({ command: 'configure', parentKey: 'provider' });

    await cmd.execute(setupPayload, undefined, { workspaceRoot: 'C:/ws' } as any);

    expect(deps.configurationStorage.saveTeamConfigAsync).toHaveBeenCalled();
  });

  it('add/set commands execute via shared provider flow', async () => {
    const deps = createDeps();
    const addCmd = new ProviderAddICommand(
      deps.configurationStorage as any,
      deps.environmentStorage as any,
      deps.llmProviderTester as any,
      deps.modelDiscoveryRegistry as any
    );
    const setCmd = new ProviderSetICommand(
      deps.configurationStorage as any,
      deps.environmentStorage as any,
      deps.llmProviderTester as any,
      deps.modelDiscoveryRegistry as any
    );

    await addCmd.execute({ ...setupPayload, makeDefault: true }, undefined, {
      workspaceRoot: 'C:/ws',
    } as any);
    await setCmd.execute(setupPayload, undefined, { workspaceRoot: 'C:/ws' } as any);

    expect(deps.configurationStorage.saveTeamConfigAsync).toHaveBeenCalledTimes(2);
    expect(deps.llmProviderTester.testConnectionAsync).toHaveBeenCalled();
  });
});