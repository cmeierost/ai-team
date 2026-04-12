import {
  loadUserConfig,
  loadEnvFile,
  loadTeamConfig,
  resolveEffectiveLlmSettings,
  saveUserConfig,
  saveEnvFile,
  saveTeamConfig,
  testLlmConnection,
} from '@ai-team/infrastructure';
import type { UserConfig, LlmProviderConfig, TeamConfig } from '@ai-team/infrastructure';
import type {
  AddProviderOptions,
  ConfigureProviderOptions,
  ProviderSetupInput,
  SetProviderOptions,
} from '@ai-team/api-client';

type ProviderSetupResult = ProviderSetupInput;

export async function providerConfigureCommand(
  workspaceRoot: string,
  options: ConfigureProviderOptions = {}
) {
  const existing = await loadTeamConfig(workspaceRoot);
  const existingUserConfig = await loadUserConfig(workspaceRoot);

  const currentDefault = resolveCurrentDefaultProvider(existing);
  if (currentDefault && options.keepCurrentDefault) {
    if (!options.fromInit) {
      await testConfiguredProvider(workspaceRoot, existing, currentDefault.ref);
    }
    return;
  }

  if (!options.setup) {
    throw new Error('Provider configure requires client-provided setup payload.');
  }

  const setup = options.setup;
  const next = applyProviderConfiguration(existing, setup, true);
  const nextUserConfig = applyProviderConfigurationToUserConfig(existingUserConfig, setup, true);
  await saveTeamConfig(workspaceRoot, next);
  await saveUserConfig(workspaceRoot, nextUserConfig);
  await persistApiKeyIfProvided(workspaceRoot, setup);
  await testConfiguredProvider(workspaceRoot, next, setup.providerRef, setup.apiKey);
}

export async function providerAddCommand(workspaceRoot: string, options: AddProviderOptions = {}) {
  const existing = await loadTeamConfig(workspaceRoot);
  const existingUserConfig = await loadUserConfig(workspaceRoot);

  if (!options.setup) {
    throw new Error('Provider add requires client-provided setup payload.');
  }

  const setup = options.setup;
  const makeDefault = Boolean(options.makeDefault);

  const next = applyProviderConfiguration(existing, setup, makeDefault);
  const nextUserConfig = applyProviderConfigurationToUserConfig(
    existingUserConfig,
    setup,
    makeDefault
  );
  await saveTeamConfig(workspaceRoot, next);
  await saveUserConfig(workspaceRoot, nextUserConfig);
  await persistApiKeyIfProvided(workspaceRoot, setup);

  await testConfiguredProvider(workspaceRoot, next, setup.providerRef, setup.apiKey);
}

export async function providerSetCommand(workspaceRoot: string, options: SetProviderOptions = {}) {
  await providerConfigureCommand(workspaceRoot, options);
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

async function persistApiKeyIfProvided(
  workspaceRoot: string,
  setup: ProviderSetupResult
): Promise<void> {
  if (!setup.apiKey || !setup.apiKeyEnvVar) {
    return;
  }

  const envVars = await loadEnvFile(workspaceRoot);
  envVars[setup.apiKeyEnvVar] = setup.apiKey;
  await saveEnvFile(workspaceRoot, envVars);
}

async function testConfiguredProvider(
  workspaceRoot: string,
  config: TeamConfig | undefined,
  providerRef: string,
  injectedApiKey?: string
) {
  if (!config) {
    return;
  }

  try {
    const registry = config.providers || {};
    const providerConfig = registry[providerRef];
    const model = providerConfig?.defaultModel;

    const tempConfig: TeamConfig = {
      ...config,
      providers: registry,
      defaultModel: model ? { provider: providerRef, model } : config.defaultModel,
    };

    const resolved = resolveEffectiveLlmSettings(tempConfig, undefined, undefined, {
      model: undefined,
    });
    const env = await loadEnvFile(workspaceRoot);
    const apiKeyName = resolved.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey =
      injectedApiKey ||
      env[apiKeyName] ||
      env.AI_TEAM_LLM_API_KEY ||
      env.LLM_API_KEY ||
      env.OPENAI_API_KEY;
    await testLlmConnection(resolved.config, apiKey);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'LLM connection failed.');
  }
}

function resolveCurrentDefaultProvider(
  config: TeamConfig | undefined
): { ref: string; config: LlmProviderConfig } | undefined {
  const registry = config?.providers;
  if (!registry || Object.keys(registry).length === 0) {
    return undefined;
  }

  // 1. Explicit defaultModel.provider
  if (config?.defaultModel?.provider && registry[config.defaultModel.provider]) {
    return {
      ref: config.defaultModel.provider,
      config: registry[config.defaultModel.provider],
    };
  }

  // 2. First provider with a defaultModel
  const withDefault = Object.entries(registry).find(([, provider]) => provider.defaultModel);
  if (withDefault) {
    return { ref: withDefault[0], config: withDefault[1] };
  }

  // 3. First provider
  const first = Object.keys(registry)[0];
  return {
    ref: first,
    config: registry[first],
  };
}
