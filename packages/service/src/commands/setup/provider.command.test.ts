import { describe, expect, it, vi } from 'vitest';
import { ProviderICommand } from './provider.command.js';
import { ProviderCommand } from './provider.js';

function createDeps() {
  const configurationStorage = {
    get: vi.fn().mockReturnValue({
      version: '0.1.0',
      randomAvatarUrls: [],
      providers: {
        existing: { kind: 'github-copilot', defaultModel: 'gpt-4o' },
      },
      defaultModel: { provider: 'existing', model: 'gpt-4o' },
    }),
    set: vi.fn().mockResolvedValue(undefined),
    setSecret: vi.fn().mockResolvedValue(undefined),
  };

  const llmProviderTester = {
    testConnectionAsync: vi.fn().mockResolvedValue(undefined),
  };

  const modelDiscoveryRegistry = {
    getForKind: vi.fn().mockReturnValue(undefined),
  };

  const questionService = {
    confirm: vi.fn().mockResolvedValue(true),
    select: vi.fn().mockResolvedValue('gpt-4o'),
    input: vi.fn().mockResolvedValue('test'),
    password: vi.fn().mockResolvedValue('secret'),
    checklist: vi.fn().mockResolvedValue([]),
  };

  const providerConfigurationService = {
    resolveDefaultProvider: vi.fn().mockReturnValue(undefined),
  };

  return {
    configurationStorage,
    llmProviderTester,
    modelDiscoveryRegistry,
    questionService,
    providerConfigurationService,
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
  },
};

describe('ProviderICommand', () => {
  it('configure sub-command executes and persists config', async () => {
    const deps = createDeps();
    const providerCmd = new ProviderCommand(
      deps.configurationStorage,
      deps.llmProviderTester,
      deps.modelDiscoveryRegistry,
      deps.questionService,
      deps.providerConfigurationService
    );
    const cmd = new ProviderICommand(providerCmd);

    expect(cmd.key).toBe('provider');
    expect(cmd.cli).toEqual({ command: 'provider', parentKey: undefined });

    await cmd.execute({ ...setupPayload, subCommand: 'configure' }, undefined, {
      workspaceRoot: 'C:/ws',
    } as any);

    expect(deps.configurationStorage.set).toHaveBeenCalled();
  });

  it('add sub-command executes with makeDefault', async () => {
    const deps = createDeps();
    const providerCmd = new ProviderCommand(
      deps.configurationStorage,
      deps.llmProviderTester,
      deps.modelDiscoveryRegistry,
      deps.questionService,
      deps.providerConfigurationService
    );
    const cmd = new ProviderICommand(providerCmd);

    await cmd.execute({ ...setupPayload, subCommand: 'add', makeDefault: true }, undefined, {
      workspaceRoot: 'C:/ws',
    } as any);

    expect(deps.configurationStorage.set).toHaveBeenCalled();
    expect(deps.llmProviderTester.testConnectionAsync).toHaveBeenCalled();
  });

  it('set sub-command delegates to configure', async () => {
    const deps = createDeps();
    const providerCmd = new ProviderCommand(
      deps.configurationStorage,
      deps.llmProviderTester,
      deps.modelDiscoveryRegistry,
      deps.questionService,
      deps.providerConfigurationService
    );
    const cmd = new ProviderICommand(providerCmd);

    await cmd.execute({ ...setupPayload, subCommand: 'set' }, undefined, {
      workspaceRoot: 'C:/ws',
    } as any);

    expect(deps.configurationStorage.set).toHaveBeenCalled();
  });

  it('defaults to configure when no subCommand provided', async () => {
    const deps = createDeps();
    const providerCmd = new ProviderCommand(
      deps.configurationStorage,
      deps.llmProviderTester,
      deps.modelDiscoveryRegistry,
      deps.questionService,
      deps.providerConfigurationService
    );
    const cmd = new ProviderICommand(providerCmd);

    await cmd.execute(setupPayload, undefined, { workspaceRoot: 'C:/ws' } as any);

    expect(deps.configurationStorage.set).toHaveBeenCalled();
  });
});
