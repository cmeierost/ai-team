import type {
  IProviderConfigurationService,
  ResolvedDefaultProvider,
  TeamConfig,
} from '@ai-team/core';

export class ProviderConfigurationService implements IProviderConfigurationService {
  constructor(private readonly teamConfig: TeamConfig) {}

  getTeamConfig(): TeamConfig {
    return this.teamConfig;
  }

  resolveDefaultProviderRef(): string | undefined {
    const teamConfig = this.teamConfig;
    const registry = teamConfig?.providers;
    if (!registry || Object.keys(registry).length === 0) {
      return undefined;
    }

    if (teamConfig?.defaultModel?.provider && registry[teamConfig.defaultModel.provider]) {
      return teamConfig.defaultModel.provider;
    }

    const withDefault = Object.entries(registry).find(([, cfg]) => cfg.defaultModel);
    if (withDefault) {
      return withDefault[0];
    }

    return Object.keys(registry)[0];
  }

  resolveDefaultProvider(): ResolvedDefaultProvider | undefined {
    const teamConfig = this.teamConfig;
    const registry = teamConfig?.providers;
    if (!registry || Object.keys(registry).length === 0) {
      return undefined;
    }

    const ref = this.resolveDefaultProviderRef();
    if (ref && registry[ref]) {
      return { ref, config: registry[ref] };
    }

    return undefined;
  }
}
