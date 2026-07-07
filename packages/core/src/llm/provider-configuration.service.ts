/**
 * Provider configuration resolution — single source of truth for
 * finding the default provider across a TeamConfig registry.
 */

import type { TeamConfig, LlmProviderConfig } from '../types/index.js';

export interface ResolvedDefaultProvider {
  ref: string;
  config: LlmProviderConfig;
}

export interface IProviderConfigurationService {
  /**
   * Resolve the default provider reference from a TeamConfig.
   *
   * Fallback chain:
   * 1. `defaultModel.provider` if it exists in the registry
   * 2. First provider that has a `defaultModel` set
   * 3. First provider in the registry
   */
  resolveDefaultProviderRef(teamConfig?: TeamConfig): string | undefined;

  /**
   * Resolve the default provider including its full config entry.
   * Returns undefined when no providers are configured.
   */
  resolveDefaultProvider(teamConfig?: TeamConfig): ResolvedDefaultProvider | undefined;
}

export class ProviderConfigurationService implements IProviderConfigurationService {
  resolveDefaultProviderRef(teamConfig?: TeamConfig): string | undefined {
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

  resolveDefaultProvider(teamConfig?: TeamConfig): ResolvedDefaultProvider | undefined {
    const registry = teamConfig?.providers;
    if (!registry || Object.keys(registry).length === 0) {
      return undefined;
    }

    const ref = this.resolveDefaultProviderRef(teamConfig);
    if (ref && registry[ref]) {
      return { ref, config: registry[ref] };
    }

    return undefined;
  }
}
