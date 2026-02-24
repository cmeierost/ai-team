import chalk from 'chalk';
import {
  loadTeamConfig,
  loadEnvFile,
  fetchOpenAICompatibleModels,
  fetchGitHubModels,
  saveTeamConfig,
} from '@ai-team/core';

interface ModelsOptions {
  provider?: string;
  json?: boolean;
}

export async function providerModelsCommand(options: ModelsOptions) {
  const workspaceRoot = process.cwd();
  const config = await loadTeamConfig(workspaceRoot);

  if (!config) {
    console.log(chalk.red('No LLM configured. Run ') + chalk.bold('ait init') + chalk.red(' first.'));
    process.exit(1);
  }

  const registry = config.providers || config.llmProviders;
  if (!registry || Object.keys(registry).length === 0) {
    console.log(chalk.red('No providers dictionary found in config. Run ') + chalk.bold('ait provider set') + chalk.red(' first.'));
    process.exit(1);
  }

  let providerRef: string;
  try {
    providerRef = resolveProviderRef(registry, config.defaultLlmProvider, options.provider);
  } catch (error) {
    console.log(chalk.red(error instanceof Error ? error.message : 'Invalid provider reference.'));
    process.exit(1);
  }
  const providerConfig = registry[providerRef];

  if (options.json) {
    console.log(JSON.stringify({
      providerRef,
      kind: providerConfig.kind,
      isDefault: providerConfig.isDefault,
      defaultModelKey: providerConfig.defaultModelKey,
      models: providerConfig.models || {},
    }, null, 2));
    return;
  }

  console.log(chalk.bold(`\nProvider: ${providerRef} (${providerConfig.kind})\n`));
  if (!providerConfig.models || Object.keys(providerConfig.models).length === 0) {
    console.log(chalk.yellow('No models are stored for this provider.'));
    console.log(chalk.dim('Run: ait provider models refresh --provider ' + providerRef));
    console.log('');
    return;
  }

  const defaultKey = providerConfig.defaultModelKey;
  for (const [modelKey, modelId] of Object.entries(providerConfig.models)) {
    const marker = defaultKey === modelKey ? chalk.green(' (default)') : '';
    console.log(`  - ${modelKey}: ${modelId}${marker}`);
  }
  console.log('');
}

interface RefreshModelsOptions {
  provider?: string;
}

export async function providerModelsRefreshCommand(options: RefreshModelsOptions) {
  const workspaceRoot = process.cwd();
  const config = await loadTeamConfig(workspaceRoot);

  if (!config) {
    console.log(chalk.red('No LLM configured. Run ') + chalk.bold('ait init') + chalk.red(' first.'));
    process.exit(1);
  }

  const registry = { ...(config.providers || config.llmProviders || {}) };
  if (Object.keys(registry).length === 0) {
    console.log(chalk.red('No providers dictionary found in config. Run ') + chalk.bold('ait provider set') + chalk.red(' first.'));
    process.exit(1);
  }

  let providerRef: string;
  try {
    providerRef = resolveProviderRef(registry, config.defaultLlmProvider, options.provider);
  } catch (error) {
    console.log(chalk.red(error instanceof Error ? error.message : 'Invalid provider reference.'));
    process.exit(1);
  }
  const providerConfig = registry[providerRef];

  let modelIds: string[] = [];

  if (providerConfig.kind === 'github-copilot') {
    const models = await fetchGitHubModels();
    modelIds = models.map(model => model.id);
  } else if (providerConfig.kind === 'openai-compatible') {
    if (!providerConfig.baseUrl) {
      console.log(chalk.red(`Provider '${providerRef}' is openai-compatible but has no baseUrl.`));
      process.exit(1);
    }

    const env = await loadEnvFile(workspaceRoot);
    const apiKeyName = providerConfig.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey = env[apiKeyName] || env['AI_TEAM_LLM_API_KEY'] || env['LLM_API_KEY'] || env['OPENAI_API_KEY'];
    modelIds = await fetchOpenAICompatibleModels(providerConfig.baseUrl, apiKey);
  }

  if (modelIds.length === 0) {
    console.log(chalk.yellow('No models returned from provider endpoint.'));
    process.exit(1);
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

  console.log(chalk.green(`Updated model dictionary for provider '${providerRef}'.`));
  console.log(chalk.dim(`Stored ${Object.keys(models).length} models in .ai-team/config.json`));
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
