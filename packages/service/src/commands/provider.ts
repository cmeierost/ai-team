import {
  loadDeveloperConfig,
  loadEnvFile,
  loadTeamConfig,
  resolveEffectiveLlmSettings,
  saveDeveloperConfig,
  saveEnvFile,
  saveTeamConfig,
  testLlmConnection,
} from '@ai-team/core';
import type { DeveloperConfig, LlmProviderConfig, TeamConfig } from '@ai-team/core';
import type { AddProviderOptions, ConfigureProviderOptions, ProviderSetupInput, SetProviderOptions } from '../contracts.js';

type ProviderSetupResult = ProviderSetupInput;

export async function providerConfigureCommand(workspaceRoot: string, options: ConfigureProviderOptions = {}) {
  const existing = await loadTeamConfig(workspaceRoot);
  const existingDeveloperConfig = await loadDeveloperConfig(workspaceRoot);

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
  const nextDeveloperConfig = applyProviderConfigurationToDeveloperConfig(existingDeveloperConfig, setup, true);
  await saveTeamConfig(workspaceRoot, next);
  await saveDeveloperConfig(workspaceRoot, nextDeveloperConfig);
  await persistApiKeyIfProvided(workspaceRoot, setup);
  await testConfiguredProvider(workspaceRoot, next, setup.providerRef, setup.apiKey);
}

export async function providerAddCommand(workspaceRoot: string, options: AddProviderOptions = {}) {
  const existing = await loadTeamConfig(workspaceRoot);
  const existingDeveloperConfig = await loadDeveloperConfig(workspaceRoot);

  if (!options.setup) {
    throw new Error('Provider add requires client-provided setup payload.');
  }

  const setup = options.setup;
  const makeDefault = Boolean(options.makeDefault);

  const next = applyProviderConfiguration(existing, setup, makeDefault);
  const nextDeveloperConfig = applyProviderConfigurationToDeveloperConfig(existingDeveloperConfig, setup, makeDefault);
  await saveTeamConfig(workspaceRoot, next);
  await saveDeveloperConfig(workspaceRoot, nextDeveloperConfig);
  await persistApiKeyIfProvided(workspaceRoot, setup);

  await testConfiguredProvider(workspaceRoot, next, setup.providerRef, setup.apiKey);
}

export async function providerSetCommand(workspaceRoot: string, options: SetProviderOptions = {}) {
  await providerConfigureCommand(workspaceRoot, options);
}

function applyProviderConfiguration(
  existing: TeamConfig | undefined,
  setup: ProviderSetupResult,
  makeDefault: boolean,
): TeamConfig {
  const base: TeamConfig = existing ? { ...existing } : { version: '0.1.0', randomAvatarUrls: [] };
  const registry: Record<string, LlmProviderConfig> = {};
  const existingRegistry = base.providers;
  if (existingRegistry) {
    Object.assign(registry, existingRegistry);
  }

  if (makeDefault) {
    for (const key of Object.keys(registry)) {
      registry[key] = { ...registry[key], isDefault: false };
    }
  }

  registry[setup.providerRef] = {
    ...registry[setup.providerRef],
    ...setup.providerConfig,
    ...(makeDefault ? { isDefault: true } : { isDefault: registry[setup.providerRef]?.isDefault }),
  };

  const next: TeamConfig = {
    ...base,
    providers: registry,
    ...(makeDefault ? { defaultLlmProvider: setup.providerRef, llm: setup.legacyLlm } : {}),
  };

  return next;
}

function applyProviderConfigurationToDeveloperConfig(
  existing: DeveloperConfig | undefined,
  setup: ProviderSetupResult,
  makeDefault: boolean,
): DeveloperConfig {
  const base = existing ? { ...existing } : {};
  const existingRegistry = base.llm?.providers;
  const registry = existingRegistry ? { ...existingRegistry } : {};

  if (makeDefault) {
    for (const key of Object.keys(registry)) {
      registry[key] = { ...registry[key], isDefault: false };
    }
  }

  registry[setup.providerRef] = {
    ...registry[setup.providerRef],
    ...setup.providerConfig,
    ...(makeDefault ? { isDefault: true } : { isDefault: registry[setup.providerRef]?.isDefault }),
  };

  return {
    ...base,
    llm: {
      ...(base.llm ? base.llm : {}),
      providers: registry,
      ...(makeDefault ? { defaultLlmProvider: setup.providerRef } : {}),
    },
  };
}

async function persistApiKeyIfProvided(workspaceRoot: string, setup: ProviderSetupResult): Promise<void> {
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
  injectedApiKey?: string,
) {
  if (!config) {
    return;
  }

  try {
    const registry = config.providers || {};
    const tempRegistry: Record<string, LlmProviderConfig> = {};
    for (const [ref, provider] of Object.entries(registry)) {
      tempRegistry[ref] = {
        ...provider,
        isDefault: ref === providerRef,
      };
    }

    const tempConfig: TeamConfig = {
      ...config,
      providers: tempRegistry,
      defaultLlmProvider: providerRef,
    };

    const resolved = resolveEffectiveLlmSettings(tempConfig, undefined, undefined, { model: undefined });
    const env = await loadEnvFile(workspaceRoot);
    const apiKeyName = resolved.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey = injectedApiKey || env[apiKeyName] || env.AI_TEAM_LLM_API_KEY || env.LLM_API_KEY || env.OPENAI_API_KEY;
    await testLlmConnection(resolved.config, apiKey);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'LLM connection failed.');
  }
}

function resolveCurrentDefaultProvider(
  config: TeamConfig | undefined,
): { ref: string; config: LlmProviderConfig } | undefined {
  const registry = config?.providers;
  if (!registry || Object.keys(registry).length === 0) {
    return undefined;
  }

  const byFlag = Object.entries(registry).find(([, provider]) => provider.isDefault);
  if (byFlag) {
    return { ref: byFlag[0], config: byFlag[1] };
  }

  if (config?.defaultLlmProvider && registry[config.defaultLlmProvider]) {
    return {
      ref: config.defaultLlmProvider,
      config: registry[config.defaultLlmProvider],
    };
  }

  const first = Object.keys(registry)[0];
  return {
    ref: first,
    config: registry[first],
  };
}

