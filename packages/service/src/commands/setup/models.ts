import type { IConfigurationStorage, IModelDiscoveryRegistry, TeamConfig } from '@ai-team/core';
import {
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
} from '@ai-team/api-contracts';

export class ModelsCommand {
  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry
  ) {}

  async providerListAsync(options: ProviderListOptions = {}): Promise<void> {
    return providerListCommandAsync(options, this.configurationStorage);
  }

  async providerModelsAsync(options: ProviderModelsOptions): Promise<void> {
    return providerModelsCommandAsync(options, this.configurationStorage);
  }

  async providerModelsRefreshAsync(
    options: RefreshProviderModelsOptions
  ): Promise<void> {
    return providerModelsRefreshCommandAsync(
      options,
      this.configurationStorage,
      this.modelDiscoveryRegistry
    );
  }
}

async function providerListCommandAsync(
  options: ProviderListOptions = {},
  configurationStorage: IConfigurationStorage
): Promise<void> {
  const config = configurationStorage.get() as TeamConfig;
  const registry = config.providers;
  if (!registry || Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  const defaultProviderRef = resolveProviderRef(registry, config.defaultModel?.provider);
  const providerEntries = Object.entries(registry).map(([providerRef, providerConfig]) => {
    const cfg = providerConfig as Record<string, unknown>;
    return {
      providerRef,
      kind: cfg.kind as string,
      isDefault: providerRef === defaultProviderRef,
      baseUrl: cfg.kind === 'openai-compatible' ? (cfg.baseUrl as string) : undefined,
      defaultModel: cfg.defaultModel as string,
      modelsCount: Array.isArray(cfg.models) ? cfg.models.length : 0,
    };
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          defaultProvider: defaultProviderRef,
          providers: providerEntries,
        },
        null,
        2
      )
    );
    return;
  }

  console.log('Providers:');
  for (const provider of providerEntries) {
    const marker = provider.isDefault ? '*' : ' ';
    const base = provider.baseUrl ? `, baseUrl=${provider.baseUrl}` : '';
    const defaultModel = provider.defaultModel ? `, defaultModel=${provider.defaultModel}` : '';
    console.log(
      `${marker} ${provider.providerRef} (${provider.kind}, models=${provider.modelsCount}${defaultModel}${base})`
    );
  }
}

async function providerModelsCommandAsync(
  options: ProviderModelsOptions,
  configurationStorage: IConfigurationStorage
): Promise<void> {
  const config = configurationStorage.get() as TeamConfig;
  const registry = config.providers;
  if (!registry || Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  const defaultProviderRef = resolveProviderRef(registry, config.defaultModel?.provider);
  const providerRefs = options.provider
    ? [resolveProviderRef(registry, config?.defaultModel?.provider, options.provider)]
    : Object.keys(registry);

  const providerEntries = providerRefs.map((providerRef) => {
    const providerConfig = registry[providerRef] as Record<string, unknown>;
    const models = (providerConfig.models as Array<{ name: string }>) || [];
    const defaultModel = providerConfig.defaultModel as string | undefined;
    return {
      providerRef,
      kind: providerConfig.kind as string,
      isDefault: providerRef === defaultProviderRef,
      defaultModel,
      models,
    };
  });

  if (options.json) {
    if (options.provider) {
      const provider = providerEntries[0];
      console.log(
        JSON.stringify(
          {
            providerRef: provider.providerRef,
            kind: provider.kind,
            defaultModel: provider.defaultModel,
            models: provider.models,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(
      JSON.stringify(
        {
          defaultProvider: defaultProviderRef,
          providers: providerEntries,
        },
        null,
        2
      )
    );
    return;
  }

  for (const [index, provider] of providerEntries.entries()) {
    if (index > 0) {
      console.log('');
    }

    console.log(`Provider: ${provider.providerRef}${provider.isDefault ? ' (default)' : ''}`);
    console.log(`Kind: ${provider.kind}`);

    const modelEntries = provider.models.map((m) => m.name);
    if (modelEntries.length === 0) {
      console.log('No model list found for this provider.');
      console.log(
        'Run `ait provider models refresh --provider <providerRef>` to fetch and persist available models.'
      );
      continue;
    }

    if (provider.defaultModel) {
      console.log(`Default: ${provider.defaultModel}`);
    }

    console.log('Models:');
    for (const modelName of modelEntries) {
      const marker = modelName === provider.defaultModel ? '*' : ' ';
      console.log(`${marker} ${modelName}`);
    }
  }
}

async function providerModelsRefreshCommandAsync(
  options: RefreshProviderModelsOptions,
  configurationStorage: IConfigurationStorage,
  modelDiscoveryRegistry: IModelDiscoveryRegistry
): Promise<void> {
  const config = (await configurationStorage.get()) as TeamConfig;
  const registrySource = config.providers;
  const registry = registrySource ? { ...registrySource } : {};
  if (Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  let providerRef: string;
  try {
    providerRef = resolveProviderRef(registry, config?.defaultModel?.provider, options.provider);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid provider reference.');
  }
  const providerConfig = registry[providerRef] as Record<string, unknown>;

  const discoveryService = modelDiscoveryRegistry.getForKind(providerConfig.kind as string);
  if (!discoveryService) {
    throw new Error(
      `No model discovery service registered for provider kind '${providerConfig.kind}'.`
    );
  }

  const apiKey =
    providerConfig.kind === 'openai-compatible'
      ? (providerConfig.apiKey as string | undefined)
      : undefined;

  const discovered = await discoveryService.fetchModelsAsync(providerConfig.baseUrl as string | undefined, apiKey);
  let models: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }> = discovered.map((m) => ({
    name: m.name,
    contextWindow: m.contextWindow,
    maxPromptTokens: m.maxPromptTokens,
    maxContextWindowTokens: m.maxContextWindowTokens,
    maxOutputTokens: m.maxOutputTokens,
  }));

  if (models.length === 0) {
    throw new Error('No models returned from provider endpoint.');
  }

  models = buildModelsList(models);
  const defaultModel =
    providerConfig.defaultModel && models.some((m) => m.name === providerConfig.defaultModel)
      ? (providerConfig.defaultModel as string)
      : models[0]?.name;

  registry[providerRef] = {
    ...providerConfig,
    kind: providerConfig.kind as 'github-copilot' | 'openai-compatible',
    models,
    defaultModel,
  };

  const nextValues = {
    providers: registry,
    defaultModel: { provider: providerRef, model: defaultModel },
  };

  await configurationStorage.set('providers', nextValues.providers);
  await configurationStorage.set('defaultModel', nextValues.defaultModel);
  await configurationStorage.set('providers', nextValues.providers, 'user');
  await configurationStorage.set('defaultModel', nextValues.defaultModel, 'user');
}

function resolveProviderRef(
  registry: Record<string, unknown>,
  defaultModelProvider: string | undefined,
  requested?: string
): string {
  if (requested && registry[requested]) {
    return requested;
  }

  if (requested && !registry[requested]) {
    throw new Error(
      `Unknown provider '${requested}'. Available: ${Object.keys(registry).join(', ')}`
    );
  }

  if (defaultModelProvider && registry[defaultModelProvider]) {
    return defaultModelProvider;
  }

  return Object.keys(registry)[0];
}

function buildModelsList(
  models: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }>
): Array<{
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}> {
  const seen = new Set<string>();
  const result: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }> = [];

  for (const model of models) {
    const modelId = model.name;
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    result.push(model);
  }

  return result;
}
