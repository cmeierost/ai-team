import { z } from 'zod';
import type {
  ICommand,
  UserConfig,
  LlmProviderConfig,
  TeamConfig,
  IConfigurationStorage,
  ILlmProviderTester,
  IModelDiscoveryRegistry,
  IProviderConfigurationService,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type {
  AddProviderOptions,
  ConfigureProviderOptions,
  ProviderSetupInput,
} from '@ai-team/api-contracts';
import type { IQuestionService } from '../../interaction/question-service.js';

type ProviderSubCommand = 'configure' | 'add' | 'set';
type ProviderSetupResult = ProviderSetupInput;

const _providerCommandSchema = z.object({
  subCommand: z.enum(['configure', 'add', 'set']).optional(),
  fromInit: z.boolean().optional(),
  keepCurrentDefault: z.boolean().optional(),
  makeDefault: z.boolean().optional(),
  setup: z.any().optional(),
});

export const ProviderCommandMetadata = {
  key: 'provider',
  description: 'Manage LLM provider configuration (configure, add, set)',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  aliases: [
    'provider-configure',
    'provider_configure',
    'provider-add',
    'provider_add',
    'provider-set',
    'provider_set',
  ],
  parameters: _providerCommandSchema,
} satisfies ICommandDescriptor;

export class ProviderICommand implements ICommand<z.infer<typeof _providerCommandSchema>, void> {
  static readonly schema = _providerCommandSchema;
  readonly key = 'provider';
  readonly cli = { command: 'provider', parentKey: undefined } as const;
  readonly metadata = ProviderCommandMetadata;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly providerTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly questionService: IQuestionService,
    private readonly providerConfigurationService: IProviderConfigurationService
  ) {}

  async execute(
    payload: z.infer<typeof _providerCommandSchema>,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<void>> {
    const sub = (payload.subCommand as ProviderSubCommand) ?? 'configure';
    switch (sub) {
      case 'configure':
        await this.configureAsync({
          fromInit: payload.fromInit,
          keepCurrentDefault: payload.keepCurrentDefault,
          setup: payload.setup,
        });
        break;
      case 'add':
        await this.addAsync({
          makeDefault: payload.makeDefault,
          setup: payload.setup,
        });
        break;
      case 'set':
        await this.configureAsync({
          fromInit: payload.fromInit,
          keepCurrentDefault: payload.keepCurrentDefault,
          setup: payload.setup,
        });
        break;
    }
    return { status: 'ok' };
  }

  private async configureAsync(options: ConfigureProviderOptions = {}) {
    const existing = this.configurationStorage.get();
    const currentDefault = this.providerConfigurationService.resolveDefaultProvider();

    if (
      !options.fromInit &&
      currentDefault &&
      !options.keepCurrentDefault &&
      options.setup === undefined
    ) {
      const keep = await this.questionService.confirm({
        message: `Current default provider is '${currentDefault.ref}' (${currentDefault.config.kind}). Keep it?`,
      });
      if (keep) {
        if (existing) {
          await this.providerTester.testConnectionAsync(existing, currentDefault.ref);
        }
        return;
      }
    }

    if (currentDefault && options.keepCurrentDefault) {
      if (!options.fromInit && existing) {
        await this.providerTester.testConnectionAsync(existing, currentDefault.ref);
      }
      return;
    }

    const setup =
      options.setup ??
      (await this.askProviderSetupAsync(existing, {
        mode: 'configure',
      }));

    const next = this.applyProviderConfiguration(existing, setup, true);
    const nextUserConfig = this.applyProviderConfigurationToUserConfig(undefined, setup, true);
    if (next.providers) {
      await this.configurationStorage.set('providers', next.providers);
    }
    if (next.defaultModel) {
      await this.configurationStorage.set('defaultModel', next.defaultModel);
    }
    if (nextUserConfig.providers) {
      await this.configurationStorage.set('providers', nextUserConfig.providers, 'user');
    }
    if (nextUserConfig.defaultModel) {
      await this.configurationStorage.set('defaultModel', nextUserConfig.defaultModel, 'user');
    }
    await this.persistApiKeyIfProvidedAsync(setup);
    if (existing) {
      await this.providerTester.testConnectionAsync(next, setup.providerRef);
    }
  }

  private async addAsync(options: AddProviderOptions = {}) {
    const existing = this.configurationStorage.get();

    const setup =
      options.setup ??
      (await this.askProviderSetupAsync(existing, {
        mode: 'add',
      }));

    let makeDefault = Boolean(options.makeDefault);
    if (options.setup === undefined && options.makeDefault === undefined) {
      makeDefault = await this.questionService.confirm({
        message: `Make '${setup.providerRef}' the default provider?`,
      });
    }

    const next = this.applyProviderConfiguration(existing, setup, makeDefault);
    const nextUserConfig = this.applyProviderConfigurationToUserConfig(
      undefined,
      setup,
      makeDefault
    );
    if (next.providers) {
      await this.configurationStorage.set('providers', next.providers);
    }
    if (next.defaultModel) {
      await this.configurationStorage.set('defaultModel', next.defaultModel);
    }
    if (nextUserConfig.providers) {
      await this.configurationStorage.set('providers', nextUserConfig.providers, 'user');
    }
    if (nextUserConfig.defaultModel) {
      await this.configurationStorage.set('defaultModel', nextUserConfig.defaultModel, 'user');
    }
    await this.persistApiKeyIfProvidedAsync(setup);
    await this.providerTester.testConnectionAsync(next, setup.providerRef);
  }

  private applyProviderConfiguration(
    existing: TeamConfig | undefined,
    setup: ProviderSetupResult,
    makeDefault: boolean
  ): TeamConfig {
    const base: TeamConfig = existing
      ? { ...existing }
      : {
          version: '0.1.0',
          log: {
            backend: {
              file: 'off',
              console: 'off',
              targets: {
                console: { file: 'off', console: 'off' },
                api: { file: 'off', console: 'off' },
              },
            },
            frontend: { file: 'off', console: 'off' },
            chat: {
              sessionStartupLoad: {
                enabled: false,
                file: 'off',
                console: 'off',
              },
            },
          },
          randomAvatarUrls: [],
        };
    const registry: Record<string, LlmProviderConfig> = {};
    const existingRegistry = base.providers;
    if (existingRegistry) {
      Object.assign(registry, existingRegistry);
    }

    registry[setup.providerRef] = {
      ...registry[setup.providerRef],
      ...setup.providerConfig,
    };

    const defaultModel =
      makeDefault && setup.providerConfig.defaultModel
        ? { provider: setup.providerRef, model: setup.providerConfig.defaultModel }
        : base.defaultModel;

    const next: TeamConfig = {
      ...base,
      providers: registry,
      ...(defaultModel ? { defaultModel } : {}),
    };

    return next;
  }

  private applyProviderConfigurationToUserConfig(
    existing: UserConfig | undefined,
    setup: ProviderSetupResult,
    makeDefault: boolean
  ): UserConfig {
    const base = existing ? { ...existing } : {};
    const existingRegistry = base.providers;
    const registry = existingRegistry ? { ...existingRegistry } : {};

    registry[setup.providerRef] = {
      ...registry[setup.providerRef],
      ...setup.providerConfig,
    };

    const defaultModel =
      makeDefault && setup.providerConfig.defaultModel
        ? { provider: setup.providerRef, model: setup.providerConfig.defaultModel }
        : base.defaultModel;

    return {
      ...base,
      providers: registry,
      ...(defaultModel ? { defaultModel } : {}),
    };
  }

  private async persistApiKeyIfProvidedAsync(setup: ProviderSetupResult): Promise<void> {
    if (!setup.apiKey) {
      return;
    }
    const envVar = `${setup.providerRef.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
    await this.configurationStorage.setSecret(envVar, setup.apiKey);
  }

  private async askProviderSetupAsync(
    existing: TeamConfig | undefined,
    options: { mode: 'configure' | 'add' }
  ): Promise<ProviderSetupResult> {
    const providerKind = await this.questionService.select({
      message:
        options.mode === 'configure'
          ? 'Which provider should be configured as default?'
          : 'Which provider do you want to add?',
      choices: PROVIDER_KIND_CHOICES,
    });

    if (providerKind === 'github-copilot') {
      return this.askGitHubCopilotSetupAsync(existing);
    }

    return this.askOpenAiCompatibleSetupAsync(existing);
  }

  private async askGitHubCopilotSetupAsync(
    existing: TeamConfig | undefined
  ): Promise<ProviderSetupResult> {
    const discoveryService = this.modelDiscoveryRegistry.getForKind('github-copilot');
    const models = discoveryService ? await discoveryService.fetchModelsAsync() : [];
    const modelChoices =
      models.length > 0
        ? models.map((model) => ({ name: model.name, value: model.name }))
        : [
            { name: 'GPT-4o', value: 'gpt-4o' },
            { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
            { name: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
          ];

    const model = await this.questionService.select({
      message: 'Which model?',
      choices: modelChoices,
    });

    const suggestedRef = buildProviderRef('github-copilot', undefined, existing);
    const providerRef = await this.questionService.input({
      message: 'Provider reference key (used in config.providers):',
      validate: validateProviderRef,
    });

    const providerConfig: LlmProviderConfig = {
      kind: 'github-copilot',
      models: [{ name: model }],
    };

    return {
      providerRef: providerRef || suggestedRef,
      providerConfig,
    };
  }

  private async askOpenAiCompatibleSetupAsync(
    existing: TeamConfig | undefined
  ): Promise<ProviderSetupResult> {
    const preset = await this.questionService.select({
      message: 'Which service?',
      choices: PRESET_CHOICES,
    });
    const presetInfo = PRESETS[preset];

    let baseUrl: string;
    if (preset === 'custom' || preset === 'azure') {
      baseUrl = await this.questionService.input({
        message: preset === 'azure' ? 'Azure endpoint URL:' : 'Base URL:',
        validate: (value: string) => {
          try {
            new URL(value);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      });
    } else {
      baseUrl = presetInfo.baseUrl;
    }

    const modelChoices = (presetInfo?.models || ['gpt-4o']).map((modelId) => ({
      name: modelId,
      value: modelId,
    }));
    if (preset !== 'lmstudio') {
      modelChoices.push({ name: 'Other (type manually)', value: '__custom__' });
    }

    const modelChoice = await this.questionService.select({
      message: 'Which model?',
      choices: modelChoices,
    });

    const model =
      modelChoice === '__custom__'
        ? await this.questionService.input({ message: 'Model name:' })
        : modelChoice === '(uses loaded model)'
          ? ''
          : modelChoice;

    const suggestedRef = buildProviderRef('openai-compatible', baseUrl, existing);

    const providerRef = await this.questionService.input({
      message: 'Provider reference key (used in config.providers):',
      validate: validateProviderRef,
    });

    const needsKey = presetInfo ? presetInfo.needsKey : true;
    let apiKey: string | undefined;

    if (needsKey) {
      const defaultEnvVar = `${(providerRef || suggestedRef).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

      const envVar = await this.questionService.input({
        message:
          'API key environment variable name (stored in config, value stays in .ai-team/.env):',
        validate: (value: string) =>
          /^[A-Z_][A-Z0-9_]*$/.test(value.trim()) ||
          'Use uppercase letters, numbers, and underscores only.',
      });
      const resolvedEnvVar = envVar || defaultEnvVar;

      const saveNow = await this.questionService.confirm({
        message: `Set/update value for ${resolvedEnvVar} now?`,
        default: true,
      });

      if (saveNow) {
        apiKey = await this.questionService.password({
          message: `Value for ${resolvedEnvVar}:`,
        });
      }
    }

    const providerConfig: LlmProviderConfig = {
      kind: 'openai-compatible',
      baseUrl,
      ...(model ? { defaultModel: model, models: [{ name: model }] } : {}),
    };

    return {
      providerRef: providerRef || suggestedRef,
      providerConfig,
      apiKey,
    };
  }
}

const PROVIDER_KIND_CHOICES = [
  { name: 'GitHub Copilot', value: 'github-copilot' },
  { name: 'OpenAI-compatible (OpenAI, Ollama, Azure, etc.)', value: 'openai-compatible' },
];

const PRESET_CHOICES = [
  { name: 'OpenAI (api.openai.com)', value: 'openai' },
  { name: 'Ollama — local', value: 'ollama' },
  { name: 'LM Studio — local', value: 'lmstudio' },
  { name: 'Azure OpenAI', value: 'azure' },
  { name: 'Custom URL', value: 'custom' },
];

const PRESETS: Record<string, { baseUrl: string; needsKey: boolean; models: string[] }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    models: ['llama3', 'mistral', 'codellama', 'deepseek-coder'],
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    models: ['(uses loaded model)'],
  },
  azure: { baseUrl: '', needsKey: true, models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
};

function buildProviderRef(provider: string, baseUrl?: string, existing?: TeamConfig): string {
  if (provider === 'github-copilot') {
    return 'github-copilot';
  }

  if (!baseUrl) {
    return 'openai-compatible';
  }

  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    const sanitized = host.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const baseRef = sanitized || 'openai-compatible';

    const existingRefs = new Set(Object.keys(existing?.providers || {}));
    if (!existingRefs.has(baseRef)) {
      return baseRef;
    }

    let index = 2;
    while (existingRefs.has(`${baseRef}-${index}`)) {
      index += 1;
    }
    return `${baseRef}-${index}`;
  } catch {
    return 'openai-compatible';
  }
}

function validateProviderRef(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Provider reference is required';
  }
  if (!/^[a-z0-9][a-z0-9-_.]*$/i.test(trimmed)) {
    return 'Use letters, numbers, and -_. only';
  }
  return true;
}
