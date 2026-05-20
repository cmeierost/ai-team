import type {
  UserConfig,
  LlmConfig,
  LlmProviderConfig,
  TeamConfig,
  IConfigurationStorage,
  IEnvironmentStorage,
  ILlmProviderTester,
  IModelDiscoveryRegistry,
  ExecutionContext,
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
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly providerTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry
  ) {}

  async configureAsync(
    workspaceRoot: string,
    options: ConfigureProviderOptions = {},
    questionService: IQuestionService,
    ctx: ExecutionContext
  ) {
    return providerConfigureCommandAsync(
      workspaceRoot,
      options,
      questionService,
      ctx,
      this.configurationStorage,
      this.environmentStorage,
      this.providerTester,
      this.modelDiscoveryRegistry
    );
  }

  async addAsync(
    workspaceRoot: string,
    options: AddProviderOptions = {},
    questionService: IQuestionService,
    ctx: ExecutionContext
  ) {
    return providerAddCommandAsync(
      workspaceRoot,
      options,
      questionService,
      ctx,
      this.configurationStorage,
      this.environmentStorage,
      this.providerTester,
      this.modelDiscoveryRegistry
    );
  }

  async setAsync(
    workspaceRoot: string,
    options: SetProviderOptions = {},
    questionService: IQuestionService,
    ctx: ExecutionContext
  ) {
    return this.configureAsync(workspaceRoot, options, questionService, ctx);
  }
}

async function providerConfigureCommandAsync(
  workspaceRoot: string,
  options: ConfigureProviderOptions = {},
  questionService: IQuestionService,
  ctx: ExecutionContext,
  configurationStorage: IConfigurationStorage,
  environmentStorage: IEnvironmentStorage,
  providerTester: ILlmProviderTester,
  modelDiscoveryRegistry: IModelDiscoveryRegistry
) {
  const existing = await configurationStorage.loadTeamConfigAsync(workspaceRoot);
  const existingUserConfig = await configurationStorage.loadUserConfigAsync(workspaceRoot);

  const currentDefault = resolveCurrentDefaultProvider(existing);

  if (
    !options.fromInit &&
    currentDefault &&
    !options.keepCurrentDefault &&
    options.setup === undefined
  ) {
    const keep = await questionService.confirm({
      message: `Current default provider is '${currentDefault.ref}' (${currentDefault.config.kind}). Keep it?`,
    }, ctx);
    if (keep) {
      const keepSetup: ProviderSetupResult = {
        providerRef: currentDefault.ref,
        providerConfig: currentDefault.config,
        legacyLlm: {
          provider:
            currentDefault.config.kind === 'github-copilot'
              ? 'github-copilot'
              : 'openai-compatible',
        },
      };
      if (existing) {
        await providerTester.testConnectionAsync(
          workspaceRoot,
          existing,
          keepSetup.providerRef,
          keepSetup.apiKey
        );
      }
      return;
    }
  }

  if (currentDefault && options.keepCurrentDefault) {
    if (!options.fromInit && existing) {
      const keepSetup: ProviderSetupResult = {
        providerRef: currentDefault.ref,
        providerConfig: currentDefault.config,
        legacyLlm: {
          provider:
            currentDefault.config.kind === 'github-copilot'
              ? 'github-copilot'
              : 'openai-compatible',
        },
      };
      await providerTester.testConnectionAsync(
        workspaceRoot,
        existing,
        keepSetup.providerRef,
        keepSetup.apiKey
      );
    }
    return;
  }

  const setup =
    options.setup ??
    (await askProviderSetupAsync(
      workspaceRoot,
      existing,
      { mode: 'configure' },
      questionService,
      ctx,
      environmentStorage,
      modelDiscoveryRegistry
    ));

  const next = applyProviderConfiguration(existing, setup, true);
  const nextUserConfig = applyProviderConfigurationToUserConfig(existingUserConfig, setup, true);
  await configurationStorage.saveTeamConfigAsync(workspaceRoot, next);
  await configurationStorage.saveUserConfigAsync(workspaceRoot, nextUserConfig);
  await persistApiKeyIfProvidedAsync(workspaceRoot, setup, environmentStorage);
  if (existing) {
    await providerTester.testConnectionAsync(
      workspaceRoot,
      existing,
      setup.providerRef,
      setup.apiKey
    );
  }
}

async function providerAddCommandAsync(
  workspaceRoot: string,
  options: AddProviderOptions = {},
  questionService: IQuestionService,
  ctx: ExecutionContext,
  configurationStorage: IConfigurationStorage,
  environmentStorage: IEnvironmentStorage,
  providerTester: ILlmProviderTester,
  modelDiscoveryRegistry: IModelDiscoveryRegistry
) {
  const existing = await configurationStorage.loadTeamConfigAsync(workspaceRoot);
  const existingUserConfig = await configurationStorage.loadUserConfigAsync(workspaceRoot);

  const setup =
    options.setup ??
    (await askProviderSetupAsync(
      workspaceRoot,
      existing,
      { mode: 'add' },
      questionService,
      ctx,
      environmentStorage,
      modelDiscoveryRegistry
    ));

  let makeDefault = Boolean(options.makeDefault);
  if (options.setup === undefined && options.makeDefault === undefined) {
    makeDefault = await questionService.confirm({
      message: `Make '${setup.providerRef}' the default provider?`,
    }, ctx);
  }

  const next = applyProviderConfiguration(existing, setup, makeDefault);
  const nextUserConfig = applyProviderConfigurationToUserConfig(
    existingUserConfig,
    setup,
    makeDefault
  );
  await configurationStorage.saveTeamConfigAsync(workspaceRoot, next);
  await configurationStorage.saveUserConfigAsync(workspaceRoot, nextUserConfig);
  await persistApiKeyIfProvidedAsync(workspaceRoot, setup, environmentStorage);
  await providerTester.testConnectionAsync(workspaceRoot, next, setup.providerRef, setup.apiKey);
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
    ...(makeDefault ? { llm: setup.legacyLlm } : {}),
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
  workspaceRoot: string,
  setup: ProviderSetupResult,
  environmentStorage: IEnvironmentStorage
): Promise<void> {
  if (!setup.apiKey || !setup.apiKeyEnvVar) {
    return;
  }

  const envVars = await environmentStorage.loadEnvFileAsync(workspaceRoot);
  envVars[setup.apiKeyEnvVar] = setup.apiKey;
  await environmentStorage.saveEnvFileAsync(workspaceRoot, envVars);
}

function resolveCurrentDefaultProvider(
  config: TeamConfig | undefined
): { ref: string; config: LlmProviderConfig } | undefined {
  const registry = config?.providers;
  if (!registry || Object.keys(registry).length === 0) {
    return undefined;
  }

  if (config?.defaultModel?.provider && registry[config.defaultModel.provider]) {
    return {
      ref: config.defaultModel.provider,
      config: registry[config.defaultModel.provider],
    };
  }

  const withDefault = Object.entries(registry).find(([, provider]) => provider.defaultModel);
  if (withDefault) {
    return { ref: withDefault[0], config: withDefault[1] };
  }

  const first = Object.keys(registry)[0];
  return {
    ref: first,
    config: registry[first],
  };
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

function buildProviderRef(llm: LlmConfig, existing?: TeamConfig): string {
  if (llm.provider === 'github-copilot') {
    return 'github-copilot';
  }

  if (!llm.baseUrl) {
    return 'openai-compatible';
  }

  try {
    const host = new URL(llm.baseUrl).hostname.toLowerCase();
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
  workspaceRoot: string,
  existing: TeamConfig | undefined,
  options: { mode: 'configure' | 'add' },
  questionService: IQuestionService,
  ctx: ExecutionContext,
  environmentStorage: IEnvironmentStorage,
  modelDiscoveryRegistry: IModelDiscoveryRegistry
): Promise<ProviderSetupResult> {
  const providerKind = await questionService.select({
    message:
      options.mode === 'configure'
        ? 'Which provider should be configured as default?'
        : 'Which provider do you want to add?',
    choices: PROVIDER_KIND_CHOICES,
  }, ctx);

  if (providerKind === 'github-copilot') {
    return askGitHubCopilotSetupAsync(existing, questionService, ctx, modelDiscoveryRegistry);
  }

  return askOpenAiCompatibleSetupAsync(
    workspaceRoot,
    existing,
    questionService,
    ctx,
    environmentStorage
  );
}

async function askGitHubCopilotSetupAsync(
  existing: TeamConfig | undefined,
  questionService: IQuestionService,
  ctx: ExecutionContext,
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

  const model = await questionService.select({ message: 'Which model?', choices: modelChoices }, ctx);

  const suggestedRef = buildProviderRef({ provider: 'github-copilot', model }, existing);
  const providerRef = await questionService.input({
    message: 'Provider reference key (used in config.providers):',
    validate: validateProviderRef,
  }, ctx);

  const providerConfig: LlmProviderConfig = {
    kind: 'github-copilot',
    models: [{ name: model }],
  };

  return {
    providerRef: providerRef || suggestedRef,
    providerConfig,
    legacyLlm: { provider: 'github-copilot', model },
  };
}

async function askOpenAiCompatibleSetupAsync(
  workspaceRoot: string,
  existing: TeamConfig | undefined,
  questionService: IQuestionService,
  ctx: ExecutionContext,
  environmentStorage: IEnvironmentStorage
): Promise<ProviderSetupResult> {
  const preset = await questionService.select({ message: 'Which service?', choices: PRESET_CHOICES }, ctx);
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
    }, ctx);
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

  const modelChoice = await questionService.select({ message: 'Which model?', choices: modelChoices }, ctx);

  const model =
    modelChoice === '__custom__'
      ? await questionService.input({ message: 'Model name:' }, ctx)
      : modelChoice === '(uses loaded model)'
        ? ''
        : modelChoice;

  const suggestedRef = buildProviderRef(
    { provider: 'openai-compatible', baseUrl, ...(model ? { model } : {}) },
    existing
  );

  const providerRef = await questionService.input({
    message: 'Provider reference key (used in config.providers):',
    validate: validateProviderRef,
  }, ctx);

  const needsKey = presetInfo ? presetInfo.needsKey : true;
  let apiKeyEnvVar: string | undefined;
  let apiKey: string | undefined;

  if (needsKey) {
    const envVars = await environmentStorage.loadEnvFileAsync(workspaceRoot);
    const existingRefConfig = (existing?.providers || {})[providerRef || suggestedRef];
    const defaultEnvVar =
      existingRefConfig?.apiKeyEnvVar ||
      `${(providerRef || suggestedRef).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

    apiKeyEnvVar = await questionService.input({
      message:
        'API key environment variable name (stored in config, value stays in .ai-team/.env):',
      validate: (value: string) =>
        /^[A-Z_][A-Z0-9_]*$/.test(value.trim()) ||
        'Use uppercase letters, numbers, and underscores only.',
    }, ctx);
    apiKeyEnvVar = apiKeyEnvVar || defaultEnvVar;

    const existingValue = envVars[apiKeyEnvVar];
    if (existingValue) {
      const useExisting = await questionService.confirm({
        message: `Use existing value for ${apiKeyEnvVar} from .ai-team/.env?`,
      }, ctx);

      if (!useExisting) {
        apiKey = await questionService.password({
          message: `New value for ${apiKeyEnvVar}:`,
        }, ctx);
      }
    } else {
      const saveNow = await questionService.confirm({
        message: `No value for ${apiKeyEnvVar} found in .ai-team/.env. Save one now?`,
      }, ctx);

      if (saveNow) {
        apiKey = await questionService.password({
          message: `Value for ${apiKeyEnvVar}:`,
        }, ctx);
      }
    }
  }

  const providerConfig: LlmProviderConfig = {
    kind: 'openai-compatible',
    baseUrl,
    ...(model ? { defaultModel: model, models: [{ name: model }] } : {}),
    ...(apiKeyEnvVar ? { apiKeyEnvVar } : {}),
  };

  const legacyLlm: LlmConfig = {
    provider: 'openai-compatible',
    baseUrl,
    ...(model ? { model } : {}),
  };

  return {
    providerRef: providerRef || suggestedRef,
    providerConfig,
    legacyLlm,
    apiKeyEnvVar,
    apiKey,
  };
}
