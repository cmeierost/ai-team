import {
  fetchGitHubModels,
  fetchOpenAICompatibleModels,
  loadEnvFile,
  loadTeamConfig,
  saveTeamConfig,
} from '@ai-team/core';

import { ProviderListOptions, ProviderModelsOptions, RefreshProviderModelsOptions } from '../contracts.js';

export async function providerListCommand(workspaceRoot: string, options: ProviderListOptions = {}): Promise<void> {
  const config = await loadTeamConfig(workspaceRoot);

  if (!config) {
    throw new Error('No LLM configured. Run ait init first.');
  }

  const registry = config.providers || config.llmProviders;
  if (!registry || Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  const defaultProviderRef = resolveProviderRef(registry, config.defaultLlmProvider);
  const providerEntries = Object.entries(registry).map(([providerRef, providerConfig]) => ({
    providerRef,
    kind: providerConfig.kind,
    isDefault: providerRef === defaultProviderRef,
    baseUrl: providerConfig.kind === 'openai-compatible' ? providerConfig.baseUrl : undefined,
    defaultModelKey: providerConfig.defaultModelKey,
    modelsCount: Object.keys(providerConfig.models || {}).length,
  }));

  if (options.json) {
    console.log(JSON.stringify({
      defaultProvider: defaultProviderRef,
      providers: providerEntries,
    }, null, 2));
    return;
  }

  console.log('Providers:');
  for (const provider of providerEntries) {
    const marker = provider.isDefault ? '*' : ' ';
    const base = provider.baseUrl ? `, baseUrl=${provider.baseUrl}` : '';
    const defaultModel = provider.defaultModelKey ? `, defaultModelKey=${provider.defaultModelKey}` : '';
    console.log(`${marker} ${provider.providerRef} (${provider.kind}, models=${provider.modelsCount}${defaultModel}${base})`);
  }
}

export async function providerModelsCommand(workspaceRoot: string, options: ProviderModelsOptions): Promise<void> {
  const config = await loadTeamConfig(workspaceRoot);

  if (!config) {
    throw new Error('No LLM configured. Run ait init first.');
  }

  const registry = config.providers || config.llmProviders;
  if (!registry || Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  const defaultProviderRef = resolveProviderRef(registry, config.defaultLlmProvider);
  const providerRefs = options.provider
    ? [resolveProviderRef(registry, config.defaultLlmProvider, options.provider)]
    : Object.keys(registry);

  const providerEntries = providerRefs.map(providerRef => {
    const providerConfig = registry[providerRef];
    const defaultModelKey = providerConfig.defaultModelKey;
    const models = providerConfig.models || {};
    return {
      providerRef,
      kind: providerConfig.kind,
      isDefault: providerRef === defaultProviderRef,
      defaultModelKey,
      defaultModel: defaultModelKey ? models[defaultModelKey] : undefined,
      models,
    };
  });

  if (options.json) {
    if (options.provider) {
      const provider = providerEntries[0];
      console.log(JSON.stringify({
        providerRef: provider.providerRef,
        kind: provider.kind,
        defaultModelKey: provider.defaultModelKey,
        defaultModel: provider.defaultModel,
        models: provider.models,
      }, null, 2));
      return;
    }

    console.log(JSON.stringify({
      defaultProvider: defaultProviderRef,
      providers: providerEntries,
    }, null, 2));
    return;
  }

  for (const [index, provider] of providerEntries.entries()) {
    if (index > 0) {
      console.log('');
    }

    console.log(`Provider: ${provider.providerRef}${provider.isDefault ? ' (default)' : ''}`);
    console.log(`Kind: ${provider.kind}`);

    const modelEntries = Object.entries(provider.models);
    if (modelEntries.length === 0) {
      console.log('No model dictionary found for this provider.');
      console.log('Run `ait provider models refresh --provider <providerRef>` to fetch and persist available models.');
      continue;
    }

    if (provider.defaultModelKey && provider.defaultModel) {
      console.log(`Default: ${provider.defaultModelKey} -> ${provider.defaultModel}`);
    }

    console.log('Models:');
    for (const [modelKey, modelId] of modelEntries) {
      const marker = modelKey === provider.defaultModelKey ? '*' : ' ';
      console.log(`${marker} ${modelKey} -> ${modelId}`);
    }
  }
}

export async function providerModelsRefreshCommand(workspaceRoot: string, options: RefreshProviderModelsOptions): Promise<void> {
  const config = await loadTeamConfig(workspaceRoot);

  if (!config) {
    throw new Error('No LLM configured. Run ait init first.');
  }

  const registry = { ...(config.providers || config.llmProviders || {}) };
  if (Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  let providerRef: string;
  try {
    providerRef = resolveProviderRef(registry, config.defaultLlmProvider, options.provider);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid provider reference.');
  }
  const providerConfig = registry[providerRef];

  let modelIds: string[] = [];

  if (providerConfig.kind === 'github-copilot') {
    const models = await fetchGitHubModels();
    modelIds = models.map(model => model.id);
  } else if (providerConfig.kind === 'openai-compatible') {
    if (!providerConfig.baseUrl) {
      throw new Error(`Provider '${providerRef}' is openai-compatible but has no baseUrl.`);
    }

    const env = await loadEnvFile(workspaceRoot);
    const apiKeyName = providerConfig.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey = env[apiKeyName] || env['AI_TEAM_LLM_API_KEY'] || env['LLM_API_KEY'] || env['OPENAI_API_KEY'];
    modelIds = await fetchOpenAICompatibleModels(providerConfig.baseUrl, apiKey);
  }

  if (modelIds.length === 0) {
    throw new Error('No models returned from provider endpoint.');
  }

  const models = buildModelDictionary(modelIds);
  let defaultModelKey = providerConfig.defaultModelKey;
  if (!defaultModelKey || !models[defaultModelKey]) {
    defaultModelKey = Object.keys(models)[0];
  }

  registry[providerRef] = {
    ...providerConfig,
    models,
    defaultModelKey,
  };

  const nextConfig = {
    ...config,
    providers: registry,
    llmProviders: registry,
    defaultLlmProvider: providerRef,
  };

  await saveTeamConfig(workspaceRoot, nextConfig);
}

function resolveProviderRef(
  registry: Record<string, { isDefault?: boolean }>,
  defaultLlmProvider: string | undefined,
  requested?: string,
): string {
  if (requested && registry[requested]) {
    return requested;
  }

  if (requested && !registry[requested]) {
    throw new Error(`Unknown provider '${requested}'. Available: ${Object.keys(registry).join(', ')}`);
  }

  const defaultByFlag = Object.entries(registry).find(([, cfg]) => cfg.isDefault)?.[0];
  if (defaultByFlag) {
    return defaultByFlag;
  }

  if (defaultLlmProvider && registry[defaultLlmProvider]) {
    return defaultLlmProvider;
  }

  return Object.keys(registry)[0];
}

function buildModelDictionary(modelIds: string[]): Record<string, string> {
  const dictionary: Record<string, string> = {};

  for (const modelId of modelIds) {
    const baseKey = toModelKey(modelId);
    let key = baseKey;
    let counter = 2;
    while (dictionary[key]) {
      key = `${baseKey}-${counter}`;
      counter += 1;
    }
    dictionary[key] = modelId;
  }

  return dictionary;
}

function toModelKey(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'model';
}
