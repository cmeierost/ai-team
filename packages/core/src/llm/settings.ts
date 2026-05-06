/**
 * Pure LLM settings resolution logic — only depends on core types.
 * Extracted from infrastructure/src/llm/index.ts so that service-layer
 * modules can call it without importing from @ai-team/infrastructure.
 */

import type {
  LlmConfig,
  Agent,
  Skill,
  TeamConfig,
  LlmGenerationParams,
} from '../types/index.js';
import type { LlmChatOptions } from './index.js';

// ---------------------------------------------------------------------------
// ResolvedLlmSettings
// ---------------------------------------------------------------------------

export interface ResolvedLlmSettings {
  config: LlmConfig;
  options: LlmChatOptions;
  providerRef?: string;
  apiKeyEnvVar?: string;
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
    | { model?: string; defaultModel?: string; models?: Array<{ name: string; contextWindow?: number }> }
    | undefined
): string | undefined {
  if (!provider) return undefined;
  const byName = provider.defaultModel;
  if (byName) return byName;
  return getProviderModels(provider)[0]?.name;
}

function findDefaultProviderRef(teamConfig?: TeamConfig): string | undefined {
  const registry = getProviderRegistry(teamConfig);
  if (!registry) return undefined;
  if (teamConfig?.defaultModel?.provider && registry[teamConfig.defaultModel.provider]) {
    return teamConfig.defaultModel.provider;
  }
  const withDefault = Object.entries(registry).find(([, cfg]) => cfg.defaultModel);
  if (withDefault) return withDefault[0];
  return Object.keys(registry)[0];
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
        params?: LlmGenerationParams;
      }
    | undefined,
  teamConfig?: TeamConfig
): { config: LlmConfig; providerRef?: string; apiKeyEnvVar?: string } {
  if (!profile) return { config };

  let nextConfig: LlmConfig = { ...config };
  let providerRef: string | undefined;
  let apiKeyEnvVar: string | undefined;
  const registry = getProviderRegistry(teamConfig);

  if (profile.provider) {
    const providerFromRegistry = registry?.[profile.provider];
    if (providerFromRegistry) {
      providerRef = profile.provider;
      apiKeyEnvVar = providerFromRegistry.apiKeyEnvVar;
      nextConfig = {
        provider: providerFromRegistry.kind,
        model: resolveProviderDefaultModel(providerFromRegistry),
        baseUrl: providerFromRegistry.baseUrl,
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
      apiKeyEnvVar = mappedProvider.apiKeyEnvVar;
      nextConfig = {
        provider: mappedProvider.kind,
        model: modelKeyEntry.model,
        baseUrl: mappedProvider.baseUrl,
        params: mappedProvider.params,
      };
    } else {
      const selectedProviderRef = providerRef || findDefaultProviderRef(teamConfig);
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
  nextConfig.params = mergeLlmParams(nextConfig.params, profile.params);

  return { config: nextConfig, providerRef, apiKeyEnvVar };
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
    const arrayModelContext = providerConfig.models?.find((m) => m.name === modelKey)?.contextWindow;
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
  runtimeOverrides?: LlmChatOptions
): ResolvedLlmSettings {
  let providerRef: string | undefined;
  let apiKeyEnvVar: string | undefined;
  const registry = getProviderRegistry(teamConfig);

  let baseConfig: LlmConfig | undefined = teamConfig.llm;
  const defaultProviderRef = findDefaultProviderRef(teamConfig);
  if (defaultProviderRef && registry?.[defaultProviderRef]) {
    const providerConfig = registry[defaultProviderRef];
    providerRef = defaultProviderRef;
    apiKeyEnvVar = providerConfig.apiKeyEnvVar;
    baseConfig = {
      provider: providerConfig.kind,
      model: teamConfig.defaultModel?.model ?? resolveProviderDefaultModel(providerConfig),
      baseUrl: providerConfig.baseUrl,
      params: providerConfig.params,
    };
  }

  if (!baseConfig) {
    throw new Error(
      'No effective LLM configuration found. Set `defaultModel` or `providers` in .ai-team/config.json'
    );
  }

  let merged = applyProfile(baseConfig, skill?.llm, teamConfig);
  if (merged.providerRef) providerRef = merged.providerRef;
  if (merged.apiKeyEnvVar) apiKeyEnvVar = merged.apiKeyEnvVar;

  merged = applyProfile(merged.config, agent?.llm, teamConfig);
  if (merged.providerRef) providerRef = merged.providerRef;
  if (merged.apiKeyEnvVar) apiKeyEnvVar = merged.apiKeyEnvVar;

  const profileOptions = profileToOptions(merged.config.params);
  const options: LlmChatOptions = { ...profileOptions, ...(runtimeOverrides || {}) };

  const finalProvider = providerRef ? registry?.[providerRef] : undefined;
  const effectiveModelKey = findModelKeyForModel(finalProvider, merged.config.model || '');
  const contextWindow =
    teamConfig.defaultModel?.contextWindow ??
    getEffectiveContextWindow(finalProvider, effectiveModelKey);

  return { config: merged.config, options, providerRef, apiKeyEnvVar, contextWindow };
}

/**
 * Resolve LLM settings for a system purpose (e.g. 'title', 'summarize').
 */
export function resolveSystemLlmSettings(
  teamConfig: TeamConfig,
  purposeKey: string
): ResolvedLlmSettings {
  const profile = teamConfig.systemModels?.[purposeKey];
  const agent = profile
    ? { llm: { provider: profile.provider, modelKey: profile.modelKey } }
    : undefined;
  return resolveEffectiveLlmSettings(teamConfig, agent as any);
}
