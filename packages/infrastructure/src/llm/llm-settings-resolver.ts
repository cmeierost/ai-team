import type {
  Agent,
  ILlmSettingsResolver,
  IProviderConfigurationService,
  LlmChatOptions,
  LlmConfig,
  LlmGenerationParams,
  ResolvedLlmSettings,
  Skill,
  TeamConfig,
} from '@ai-team/core';

export class InfrastructureLlmSettingsResolver implements ILlmSettingsResolver {
  constructor(private readonly providerConfig: IProviderConfigurationService) {}

  private mergeLlmParams(
    base?: LlmGenerationParams,
    override?: LlmGenerationParams
  ): LlmGenerationParams | undefined {
    if (!base && !override) return undefined;
    return { ...(base || {}), ...(override || {}) };
  }

  private profileToOptions(params?: LlmGenerationParams): LlmChatOptions {
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

  private getProviderRegistry(teamConfig?: TeamConfig) {
    return teamConfig?.providers;
  }

  private getProviderModels(
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

  private resolveProviderDefaultModel(
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
    return this.getProviderModels(provider)[0]?.name;
  }

  private findModelKeyForModel(
    provider: { models?: Array<{ name: string; contextWindow?: number }> } | undefined,
    modelId: string
  ): string | undefined {
    if (!provider?.models) return undefined;
    return provider.models.find((m) => m.name === modelId)?.name;
  }

  private applyProfile(
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
    teamConfig: TeamConfig | undefined
  ): { config: LlmConfig; providerRef?: string } {
    if (!profile) return { config };

    let nextConfig: LlmConfig = { ...config };
    let providerRef: string | undefined;
    const registry = this.getProviderRegistry(teamConfig);

    if (profile.provider) {
      const providerFromRegistry = registry?.[profile.provider];
      if (providerFromRegistry) {
        providerRef = profile.provider;
        nextConfig = {
          provider: providerFromRegistry.kind,
          model: this.resolveProviderDefaultModel(providerFromRegistry),
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
        const selectedProviderRef = providerRef || this.providerConfig.resolveDefaultProviderRef();
        const selectedProvider = selectedProviderRef ? registry?.[selectedProviderRef] : undefined;
        const resolvedModel = this.getProviderModels(selectedProvider).find(
          (m) => m.name === profile.modelKey
        )?.name;
        if (resolvedModel) {
          nextConfig.model = resolvedModel;
        } else {
          const fallbackModel = this.resolveProviderDefaultModel(selectedProvider);
          if (fallbackModel) {
            nextConfig.model = fallbackModel;
          }
        }
      }
    }

    if (profile.model !== undefined) nextConfig.model = profile.model;
    if (profile.baseUrl !== undefined) nextConfig.baseUrl = profile.baseUrl;
    if (profile.apiKey !== undefined) nextConfig.apiKey = profile.apiKey;
    nextConfig.params = this.mergeLlmParams(nextConfig.params, profile.params);

    return { config: nextConfig, providerRef };
  }

  getEffectiveContextWindow(
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

  resolveEffectiveLlmSettings(
    teamConfig: TeamConfig,
    agent?: Pick<Agent, 'llm'>,
    skill?: Pick<Skill, 'llm'>,
    runtimeOverrides?: LlmChatOptions
  ): ResolvedLlmSettings {
    let providerRef: string | undefined;
    const registry = this.getProviderRegistry(teamConfig);

    const defaultProviderRef = this.providerConfig.resolveDefaultProviderRef();
    let baseConfig: LlmConfig | undefined;
    if (defaultProviderRef && registry?.[defaultProviderRef]) {
      const providerCfg = registry[defaultProviderRef];
      providerRef = defaultProviderRef;
      baseConfig = {
        provider: providerCfg.kind,
        model: teamConfig.defaultModel?.model ?? this.resolveProviderDefaultModel(providerCfg),
        baseUrl: providerCfg.baseUrl,
        apiKey: providerCfg.apiKey,
        params: providerCfg.params,
      };
    }

    if (!baseConfig) {
      throw new Error(
        'No effective LLM configuration found. Set `defaultModel` or `providers` in .ai-team/config.json'
      );
    }

    let merged = this.applyProfile(baseConfig, skill?.llm, teamConfig);
    if (merged.providerRef) providerRef = merged.providerRef;

    merged = this.applyProfile(merged.config, agent?.llm, teamConfig);
    if (merged.providerRef) providerRef = merged.providerRef;

    const profileOptions = this.profileToOptions(merged.config.params);
    const options: LlmChatOptions = { ...profileOptions, ...(runtimeOverrides || {}) };

    const finalProvider = providerRef ? registry?.[providerRef] : undefined;
    const effectiveModelKey = this.findModelKeyForModel(
      finalProvider,
      merged.config.model || ''
    );
    const contextWindow =
      teamConfig.defaultModel?.contextWindow ??
      this.getEffectiveContextWindow(finalProvider, effectiveModelKey);

    return { config: merged.config, options, providerRef, contextWindow };
  }

  resolveSystemLlmSettings(teamConfig: TeamConfig, purposeKey: string): ResolvedLlmSettings {
    const profile = teamConfig.systemModels?.[purposeKey];
    const agent = profile
      ? { llm: { provider: profile.provider, modelKey: profile.modelKey } }
      : undefined;
    return this.resolveEffectiveLlmSettings(
      teamConfig,
      agent as Pick<Agent, 'llm'>,
      undefined,
      undefined
    );
  }
}
