import type {
  UserConfig,
  LlmProviderConfig,
  TeamConfig,
  IConfigurationStorage,
  ILlmProviderTester,
  IModelDiscoveryRegistry,
  IProviderConfigurationService,
} from '@ai-team/core';
import type {
  AddProviderOptions,
  ConfigureProviderOptions,
  ProviderSetupInput,
  SetProviderOptions,
} from '@ai-team/api-contracts';
import type { IQuestionService } from '../../questions/question-service.js';

type ProviderSetupResult = ProviderSetupInput;

export class ProviderCommand {
  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly providerTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly questionService: IQuestionService,
    private readonly providerConfigurationService: IProviderConfigurationService
  ) {}

  async configureAsync(options: ConfigureProviderOptions = {}) {
    return providerConfigureCommandAsync(
      options,
      this.questionService,
      this.configurationStorage,
      this.providerTester,
      this.modelDiscoveryRegistry,
      this.providerConfigurationService
    );
  }

  async addAsync(options: AddProviderOptions = {}) {
    return providerAddCommandAsync(
      options,
      this.questionService,
      this.configurationStorage,
      this.providerTester,
      this.modelDiscoveryRegistry,
      this.providerConfigurationService
    );
  }

  async setAsync(options: SetProviderOptions = {}) {
    return this.configureAsync(options);
  }
}

async function providerConfigureCommandAsync(
  options: ConfigureProviderOptions = {},
  questionService: IQuestionService,
  configurationStorage: IConfigurationStorage,
  providerTester: ILlmProviderTester,
  modelDiscoveryRegistry: IModelDiscoveryRegistry,
  providerConfigurationService: IProviderConfigurationService
) {
  const existing = configurationStorage.get();
  const currentDefault = providerConfigurationService.resolveDefaultProvider(existing);

  if (
    !options.fromInit &&
    currentDefault &&
    !options.keepCurrentDefault &&
    options.setup === undefined
  ) {
    const keep = await questionService.confirm({
      message: `Current default provider is '${currentDefault.ref}' (${currentDefault.config.kind}). Keep it?`,
    });
    if (keep) {
      if (existing) {
        await providerTester.testConnectionAsync(existing, currentDefault.ref);
      }
      return;
    }
  }

  if (currentDefault && options.keepCurrentDefault) {
    if (!options.fromInit && existing) {
      await providerTester.testConnectionAsync(existing, currentDefault.ref);
    }
    return;
  }

  const setup =
    options.setup ??
    (await askProviderSetupAsync(
      existing,
      { mode: 'configure' },
      questionService,
      modelDiscoveryRegistry
    ));

  const next = applyProviderConfiguration(existing, setup, true);
  const nextUserConfig = applyProviderConfigurationToUserConfig(undefined, setup, true);
  if (next.providers) {
    await configurationStorage.set('providers', next.providers);
  }
  if (next.defaultModel) {
    await configurationStorage.set('defaultModel', next.defaultModel);
  }
  if (nextUserConfig.providers) {
    await configurationStorage.set('providers', nextUserConfig.providers, 'user');
  }
  if (nextUserConfig.defaultModel) {
    await configurationStorage.set('defaultModel', nextUserConfig.defaultModel, 'user');
  }
  await persistApiKeyIfProvidedAsync(configurationStorage, setup);
  if (existing) {
    await providerTester.testConnectionAsync(next, setup.providerRef);
  }
}

async function providerAddCommandAsync(
  options: AddProviderOptions = {},
  questionService: IQuestionService,
  configurationStorage: IConfigurationStorage,
  providerTester: ILlmProviderTester,
  modelDiscoveryRegistry: IModelDiscoveryRegistry,
  providerConfigurationService: IProviderConfigurationService
) {
  const existing = configurationStorage.get();

  const setup =
    options.setup ??
    (await askProviderSetupAsync(
      existing,
      { mode: 'add' },
      questionService,
      modelDiscoveryRegistry
    ));

  let makeDefault = Boolean(options.makeDefault);
  if (options.setup === undefined && options.makeDefault === undefined) {
    makeDefault = await questionService.confirm({
      message: `Make '${setup.providerRef}' the default provider?`,
    });
  }

  const next = applyProviderConfiguration(existing, setup, makeDefault);
  const nextUserConfig = applyProviderConfigurationToUserConfig(undefined, setup, makeDefault);
  if (next.providers) {
    await configurationStorage.set('providers', next.providers);
  }
  if (next.defaultModel) {
    await configurationStorage.set('defaultModel', next.defaultModel);
  }
  if (nextUserConfig.providers) {
    await configurationStorage.set('providers', nextUserConfig.providers, 'user');
  }
  if (nextUserConfig.defaultModel) {
    await configurationStorage.set('defaultModel', nextUserConfig.defaultModel, 'user');
  }
  await persistApiKeyIfProvidedAsync(configurationStorage, setup);
  await providerTester.testConnectionAsync(next, setup.providerRef);
}

function applyProviderConfiguration(
  existing: TeamConfig | undefined,
  setup: ProviderSetupResult,
  makeDefault: boolean
): TeamConfig {
  const base: TeamConfig = existing ? { ...existing } : { version: '0.1.0', randomAvatarUrls: [] };
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

function applyProviderConfigurationToUserConfig(
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

async function persistApiKeyIfProvidedAsync(
  configurationStorage: IConfigurationStorage,
  setup: ProviderSetupResult
): Promise<void> {
  if (!setup.apiKey) {
    return;
  }
  const envVar = `${setup.providerRef.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
  await configurationStorage.setSecret(envVar, setup.apiKey);
}

// ── Interactive provider setup wizard ─────────────────────────────────────────

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

async function askProviderSetupAsync(
  existing: TeamConfig | undefined,
  options: { mode: 'configure' | 'add' },
  questionService: IQuestionService,
  modelDiscoveryRegistry: IModelDiscoveryRegistry
): Promise<ProviderSetupResult> {
  const providerKind = await questionService.select({
    message:
      options.mode === 'configure'
        ? 'Which provider should be configured as default?'
        : 'Which provider do you want to add?',
    choices: PROVIDER_KIND_CHOICES,
  });

  if (providerKind === 'github-copilot') {
    return askGitHubCopilotSetupAsync(existing, questionService, modelDiscoveryRegistry);
  }

  return askOpenAiCompatibleSetupAsync(existing, questionService);
}

async function askGitHubCopilotSetupAsync(
  existing: TeamConfig | undefined,
  questionService: IQuestionService,
  modelDiscoveryRegistry: IModelDiscoveryRegistry
): Promise<ProviderSetupResult> {
  const discoveryService = modelDiscoveryRegistry.getForKind('github-copilot');
  const models = discoveryService ? await discoveryService.fetchModelsAsync() : [];
  const modelChoices =
    models.length > 0
      ? models.map((model) => ({ name: model.name, value: model.name }))
      : [
          { name: 'GPT-4o', value: 'gpt-4o' },
          { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
          { name: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
        ];

  const model = await questionService.select({ message: 'Which model?', choices: modelChoices });

  const suggestedRef = buildProviderRef('github-copilot', undefined, existing);
  const providerRef = await questionService.input({
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

async function askOpenAiCompatibleSetupAsync(
  existing: TeamConfig | undefined,
  questionService: IQuestionService
): Promise<ProviderSetupResult> {
  const preset = await questionService.select({
    message: 'Which service?',
    choices: PRESET_CHOICES,
  });
  const presetInfo = PRESETS[preset];

  let baseUrl: string;
  if (preset === 'custom' || preset === 'azure') {
    baseUrl = await questionService.input({
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

  const modelChoice = await questionService.select({
    message: 'Which model?',
    choices: modelChoices,
  });

  const model =
    modelChoice === '__custom__'
      ? await questionService.input({ message: 'Model name:' })
      : modelChoice === '(uses loaded model)'
        ? ''
        : modelChoice;

  const suggestedRef = buildProviderRef('openai-compatible', baseUrl, existing);

  const providerRef = await questionService.input({
    message: 'Provider reference key (used in config.providers):',
    validate: validateProviderRef,
  });

  const needsKey = presetInfo ? presetInfo.needsKey : true;
  let apiKey: string | undefined;

  if (needsKey) {
    const defaultEnvVar = `${(providerRef || suggestedRef).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

    const envVar = await questionService.input({
      message:
        'API key environment variable name (stored in config, value stays in .ai-team/.env):',
      validate: (value: string) =>
        /^[A-Z_][A-Z0-9_]*$/.test(value.trim()) ||
        'Use uppercase letters, numbers, and underscores only.',
    });
    const resolvedEnvVar = envVar || defaultEnvVar;

    const saveNow = await questionService.confirm({
      message: `Set/update value for ${resolvedEnvVar} now?`,
      default: true,
    });

    if (saveNow) {
      apiKey = await questionService.password({
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
