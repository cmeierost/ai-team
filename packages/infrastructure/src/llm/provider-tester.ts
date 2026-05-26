import type { IEnvironmentStorage, ILlmProviderTester, LlmConfig, TeamConfig } from '@ai-team/core';
import { resolveEffectiveLlmSettings, testLlmConnection } from './index.js';

export class LlmProviderTester implements ILlmProviderTester {
  constructor(private readonly environmentStorage: IEnvironmentStorage) {}

  async testConnectionAsync(
    workspaceRoot: string,
    config: TeamConfig,
    providerRef: string,
    injectedApiKey?: string
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
    const env = await this.environmentStorage.loadEnvFileAsync(workspaceRoot);
    const apiKeyName = resolved.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey =
      injectedApiKey ||
      env[apiKeyName] ||
      env.AI_TEAM_LLM_API_KEY ||
      env.LLM_API_KEY ||
      env.OPENAI_API_KEY;

    try {
      await testLlmConnection(resolved.config, apiKey);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'LLM connection failed.');
    }
  }

  async testLlmConnectionAsync(config: LlmConfig, apiKey?: string): Promise<string> {
    return testLlmConnection(config, apiKey);
  }
}
