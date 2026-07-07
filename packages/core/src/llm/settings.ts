/**
 * Pure LLM settings resolution logic — only depends on core types.
 * Extracted from infrastructure/src/llm/index.ts so that service-layer
 * modules can call it without importing from @ai-team/infrastructure.
 */

import type { LlmConfig, Agent, Skill, TeamConfig, LlmGenerationParams } from '../types/index.js';
import type { LlmChatOptions } from './index.js';
import type { IProviderConfigurationService } from './provider-configuration.service.js';

// ---------------------------------------------------------------------------
// ResolvedLlmSettings
// ---------------------------------------------------------------------------

export interface ResolvedLlmSettings {
  config: LlmConfig;
  options: LlmChatOptions;
  providerRef?: string;
  contextWindow?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeLlmParams(
  base?: LlmGenerationParams,
  override?: LlmGenerationParams
): LlmGenerationParams | undefined {
  if (!base && !override) return undefined;
  return { ...(base || {}), ...(override || {}) };
}

function profileToOptions(params?: LlmGenerationParams): LlmChatOptions {
  if (!params) return {};
  return {
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    topP: params.topP,
    presencePenalty: params.presencePenalty,
    frequencyPenalty: params.frequencyPenalty,
    stop: params.stop,
  };
}

function getProviderRegistry(teamConfig?: TeamConfig) {
  return teamConfig?.providers;
}

function getProviderModels(
  provider: { models?: Array<{ name: string; contextWindow?: number }> } | undefined
): Array<{ name: string; contextWindow?: number }> {
  if (!provider) return [];
  const out: Array<{ name: string; contextWindow?: number }> = [];
  const seen = new Set<string>();
  for (const model of provider.models ?? []) {
    if (!model?.name || seen.has(model.name)) continue;
    seen.add(model.name);
    out.push({ name: model.name, contextWindow: model.contextWindow });
  }
  return out;
}

function resolveProviderDefaultModel(
  provider:
    | {
        model?: string;
        defaultModel?: string;
        models?: Array<{ name: string; contextWindow?: number }>;
      }
    | undefined
): string | undefined {
  if (!provider) return undefined;
  const byName = provider.defaultModel;
  if (byName) return byName;
  return getProviderModels(provider)[0]?.name;
}

function findDefaultProviderRef(
  teamConfig: TeamConfig | undefined,
  providerConfig: IProviderConfigurationService
): string | undefined {
  return providerConfig.resolveDefaultProviderRef(teamConfig);
}

function findModelKeyForModel(
  provider: { models?: Array<{ name: string; contextWindow?: number }> } | undefined,
  modelId: string
): string | undefined {
  if (!provider?.models) return undefined;
  return provider.models.find((m) => m.name === modelId)?.name;
}

function applyProfile(
  config: LlmConfig,
  profile:
    | {
        provider?: string;
        modelKey?: string;
        model?: string;
        baseUrl?: string;
        apiKey?: string;
        params?: LlmGenerationParams;
      }
    | undefined,
  teamConfig: TeamConfig | undefined,
  providerConfig: IProviderConfigurationService
): { config: LlmConfig; providerRef?: string } {
  if (!profile) return { config };

  let nextConfig: LlmConfig = { ...config };
  let providerRef: string | undefined;
  const registry = getProviderRegistry(teamConfig);

  if (profile.provider) {
    const providerFromRegistry = registry?.[profile.provider];
    if (providerFromRegistry) {
      providerRef = profile.provider;
      nextConfig = {
        provider: providerFromRegistry.kind,
        model: resolveProviderDefaultModel(providerFromRegistry),
        baseUrl: providerFromRegistry.baseUrl,
        apiKey: providerFromRegistry.apiKey,
        params: providerFromRegistry.params,
      };
    } else {
      nextConfig.provider = profile.provider;
    }
  }

  if (profile.modelKey !== undefined) {
    const modelKeyEntry = teamConfig?.modelKeys?.[profile.modelKey];
    const mappedProviderRef = modelKeyEntry?.provider;
    const mappedProvider = mappedProviderRef ? registry?.[mappedProviderRef] : undefined;
    const explicitProviderMatchesMapping = !providerRef || providerRef === mappedProviderRef;

    if (modelKeyEntry && mappedProvider && explicitProviderMatchesMapping) {
      providerRef = mappedProviderRef;
      nextConfig = {
        provider: mappedProvider.kind,
        model: modelKeyEntry.model,
        baseUrl: mappedProvider.baseUrl,
        apiKey: mappedProvider.apiKey,
        params: mappedProvider.params,
      };
    } else {
      const selectedProviderRef =
        providerRef ||
        (providerConfig
          ? findDefaultProviderRef(teamConfig, providerConfig)
          : teamConfig?.defaultModel?.provider);
      const selectedProvider = selectedProviderRef ? registry?.[selectedProviderRef] : undefined;
      const resolvedModel = getProviderModels(selectedProvider).find(
        (m) => m.name === profile.modelKey
      )?.name;
      if (resolvedModel) {
        nextConfig.model = resolvedModel;
      } else {
        const fallbackModel = resolveProviderDefaultModel(selectedProvider);
        if (fallbackModel) {
          nextConfig.model = fallbackModel;
        }
      }
    }
  }

  if (profile.model !== undefined) nextConfig.model = profile.model;
  if (profile.baseUrl !== undefined) nextConfig.baseUrl = profile.baseUrl;
  if (profile.apiKey !== undefined) nextConfig.apiKey = profile.apiKey;
  nextConfig.params = mergeLlmParams(nextConfig.params, profile.params);

  return { config: nextConfig, providerRef };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the effective context window from a provider config entry.
 */
export function getEffectiveContextWindow(
  providerConfig:
    | { contextWindow?: number; models?: Array<{ name: string; contextWindow?: number }> }
    | undefined,
  modelKey?: string
): number | undefined {
  if (!providerConfig) return undefined;
  if (modelKey) {
    const arrayModelContext = providerConfig.models?.find(
      (m) => m.name === modelKey
    )?.contextWindow;
    if (arrayModelContext !== undefined) return arrayModelContext;
  }
  return providerConfig.contextWindow;
}

/**
 * Resolve effective LLM settings by merging team config, skill, agent overrides,
 * and runtime overrides in order of precedence.
 */
export function resolveEffectiveLlmSettings(
  teamConfig: TeamConfig,
  agent?: Pick<Agent, 'llm'>,
  skill?: Pick<Skill, 'llm'>,
  runtimeOverrides?: LlmChatOptions,
  providerConfig?: IProviderConfigurationService
): ResolvedLlmSettings {
  let providerRef: string | undefined;
  const registry = getProviderRegistry(teamConfig);

  const pc = providerConfig;
  const defaultProviderRef = pc
    ? findDefaultProviderRef(teamConfig, pc)
    : teamConfig.defaultModel?.provider;
  let baseConfig: LlmConfig | undefined;
  if (defaultProviderRef && registry?.[defaultProviderRef]) {
    const providerConfig = registry[defaultProviderRef];
    providerRef = defaultProviderRef;
    baseConfig = {
      provider: providerConfig.kind,
      model: teamConfig.defaultModel?.model ?? resolveProviderDefaultModel(providerConfig),
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      params: providerConfig.params,
    };
  }

  if (!baseConfig) {
    throw new Error(
      'No effective LLM configuration found. Set `defaultModel` or `providers` in .ai-team/config.json'
    );
  }

  let merged = pc ? applyProfile(baseConfig, skill?.llm, teamConfig, pc) : { config: baseConfig };
  if (merged.providerRef) providerRef = merged.providerRef;

  merged = pc ? applyProfile(merged.config, agent?.llm, teamConfig, pc) : { config: merged.config };
  if (merged.providerRef) providerRef = merged.providerRef;

  const profileOptions = profileToOptions(merged.config.params);
  const options: LlmChatOptions = { ...profileOptions, ...(runtimeOverrides || {}) };

  const finalProvider = providerRef ? registry?.[providerRef] : undefined;
  const effectiveModelKey = findModelKeyForModel(finalProvider, merged.config.model || '');
  const contextWindow =
    teamConfig.defaultModel?.contextWindow ??
    getEffectiveContextWindow(finalProvider, effectiveModelKey);

  return { config: merged.config, options, providerRef, contextWindow };
}

/**
 * Resolve LLM settings for a system purpose (e.g. 'title', 'summarize').
 */
export function resolveSystemLlmSettings(
  teamConfig: TeamConfig,
  purposeKey: string,
  providerConfig?: IProviderConfigurationService
): ResolvedLlmSettings {
  const profile = teamConfig.systemModels?.[purposeKey];
  const agent = profile
    ? { llm: { provider: profile.provider, modelKey: profile.modelKey } }
    : undefined;
  return resolveEffectiveLlmSettings(
    teamConfig,
    agent as any,
    undefined,
    undefined,
    providerConfig
  );
}
