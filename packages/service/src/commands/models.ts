import {
  fetchGitHubModels,
  loadUserConfig,
  fetchOpenAICompatibleModelsDetailed,
  loadEnvFile,
  loadTeamConfig,
  saveUserConfig,
  saveTeamConfig,
} from '@ai-team/core';

import { ProviderListOptions, ProviderModelsOptions, RefreshProviderModelsOptions } from '../contracts.js';

export async function providerListCommand(workspaceRoot: string, options: ProviderListOptions = {}): Promise<void> {
  const config = await loadTeamConfig(workspaceRoot);
  const developerConfig = await loadUserConfig(workspaceRoot);

  if (!config && !developerConfig) {
    throw new Error('No LLM configured. Run ait init first.');
  }

  const registry = developerConfig?.providers || config?.providers;
  if (!registry || Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  const defaultProviderRef = resolveProviderRef(registry, developerConfig?.defaultModel?.provider || config?.defaultModel?.provider);
  const providerEntries = Object.entries(registry).map(([providerRef, providerConfig]) => ({
    providerRef,
    kind: providerConfig.kind,
    isDefault: providerRef === defaultProviderRef,
    baseUrl: providerConfig.kind === 'openai-compatible' ? providerConfig.baseUrl : undefined,
    defaultModel: providerConfig.defaultModel,
    modelsCount: providerConfig.models?.length || 0,
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
    const defaultModel = provider.defaultModel ? `, defaultModel=${provider.defaultModel}` : '';
    console.log(`${marker} ${provider.providerRef} (${provider.kind}, models=${provider.modelsCount}${defaultModel}${base})`);
  }
}

export async function providerModelsCommand(workspaceRoot: string, options: ProviderModelsOptions): Promise<void> {
  const config = await loadTeamConfig(workspaceRoot);
  const developerConfig = await loadUserConfig(workspaceRoot);

  if (!config && !developerConfig) {
    throw new Error('No LLM configured. Run ait init first.');
  }

  const registry = developerConfig?.providers || config?.providers;
  if (!registry || Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  const defaultProviderRef = resolveProviderRef(registry, developerConfig?.defaultModel?.provider || config?.defaultModel?.provider);
  const providerRefs = options.provider
    ? [resolveProviderRef(registry, config?.defaultModel?.provider, options.provider)]
    : Object.keys(registry);

  const providerEntries = providerRefs.map(providerRef => {
    const providerConfig = registry[providerRef];
    const models = providerConfig.models || [];
    const defaultModel = providerConfig.defaultModel;
    return {
      providerRef,
      kind: providerConfig.kind,
      isDefault: providerRef === defaultProviderRef,
      defaultModel,
      models,
    };
  });

  if (options.json) {
    if (options.provider) {
      const provider = providerEntries[0];
      console.log(JSON.stringify({
        providerRef: provider.providerRef,
        kind: provider.kind,
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

    const modelEntries = provider.models.map((m) => m.name);
    if (modelEntries.length === 0) {
      console.log('No model list found for this provider.');
      console.log('Run `ait provider models refresh --provider <providerRef>` to fetch and persist available models.');
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

export async function providerModelsRefreshCommand(workspaceRoot: string, options: RefreshProviderModelsOptions): Promise<void> {
  const config = await loadTeamConfig(workspaceRoot);
  const developerConfig = await loadUserConfig(workspaceRoot);

  if (!config && !developerConfig) {
    throw new Error('No LLM configured. Run ait init first.');
  }

  const registrySource = developerConfig?.providers || config?.providers;
  const registry = registrySource ? { ...registrySource } : {};
  if (Object.keys(registry).length === 0) {
    throw new Error('No providers dictionary found in config. Run ait provider set first.');
  }

  let providerRef: string;
  try {
    providerRef = resolveProviderRef(registry, developerConfig?.defaultModel?.provider || config?.defaultModel?.provider, options.provider);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid provider reference.');
  }
  const providerConfig = registry[providerRef];

  let models: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }> = [];

  if (providerConfig.kind === 'github-copilot') {
    const discovered = await fetchGitHubModels();
    models = discovered.map(model => ({
      name: model.id,
      contextWindow: model.contextWindow,
      maxPromptTokens: model.maxPromptTokens,
      maxContextWindowTokens: model.maxContextWindowTokens,
      maxOutputTokens: model.maxOutputTokens,
    }));
  } else if (providerConfig.kind === 'openai-compatible') {
    if (!providerConfig.baseUrl) {
      throw new Error(`Provider '${providerRef}' is openai-compatible but has no baseUrl.`);
    }

    const env = await loadEnvFile(workspaceRoot);
    const apiKeyName = providerConfig.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey = env[apiKeyName] || env['AI_TEAM_LLM_API_KEY'] || env['LLM_API_KEY'] || env['OPENAI_API_KEY'];
    const discovered = await fetchOpenAICompatibleModelsDetailed(providerConfig.baseUrl, apiKey);
    models = discovered.map(model => ({
      name: model.id,
      contextWindow: model.contextWindow,
      maxPromptTokens: model.maxPromptTokens,
      maxContextWindowTokens: model.maxContextWindowTokens,
      maxOutputTokens: model.maxOutputTokens,
    }));
  }

  if (models.length === 0) {
    throw new Error('No models returned from provider endpoint.');
  }

  models = buildModelsList(models);
  const defaultModel = providerConfig.defaultModel && models.some((m) => m.name === providerConfig.defaultModel)
    ? providerConfig.defaultModel
    : models[0]?.name;

  registry[providerRef] = {
    ...providerConfig,
    models,
    defaultModel,
  };

  if (config) {
    const nextConfig = {
      ...config,
      providers: registry,
      defaultModel: { provider: providerRef, model: defaultModel },
    };
    await saveTeamConfig(workspaceRoot, nextConfig);
  }

  await saveUserConfig(workspaceRoot, { providers: registry, defaultModel: { provider: providerRef, model: defaultModel } });
}

function resolveProviderRef(
  registry: Record<string, unknown>,
  defaultModelProvider: string | undefined,
  requested?: string,
): string {
  if (requested && registry[requested]) {
    return requested;
  }

  if (requested && !registry[requested]) {
    throw new Error(`Unknown provider '${requested}'. Available: ${Object.keys(registry).join(', ')}`);
  }

  if (defaultModelProvider && registry[defaultModelProvider]) {
    return defaultModelProvider;
  }

  return Object.keys(registry)[0];
}

function buildModelsList(models: Array<{
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}>): Array<{
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
