import type { ILlmProviderTester, LlmConfig, TeamConfig } from '@ai-team/core';
import { resolveEffectiveLlmSettings, testLlmConnection } from './index.js';

export class LlmProviderTester implements ILlmProviderTester {
  async testConnectionAsync(
    config: TeamConfig,
    providerRef: string
  ): Promise<void> {
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

    try {
      await testLlmConnection(resolved.config);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'LLM connection failed.');
    }
  }

  async testLlmConnectionAsync(config: LlmConfig, apiKey?: string): Promise<string> {
    return testLlmConnection(config, apiKey);
  }
}
