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
  getTeamConfig(): TeamConfig;

  /**
   * Resolve the default provider reference from injected TeamConfig.
   *
   * Fallback chain:
   * 1. `defaultModel.provider` if it exists in the registry
   * 2. First provider that has a `defaultModel` set
   * 3. First provider in the registry
   */
  resolveDefaultProviderRef(): string | undefined;

  /**
   * Resolve the default provider (ref + config) from injected TeamConfig.
   * Returns undefined when no providers are configured.
   */
  resolveDefaultProvider(): ResolvedDefaultProvider | undefined;
}
