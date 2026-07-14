import type {
  ILlmProviderTester,
  ILlmSettingsResolver,
  LlmConfig,
  TeamConfig,
} from '@ai-team/core';
import { InfrastructureLlmProviderClient } from './provider-client.service.js';

export class LlmProviderTester implements ILlmProviderTester {
  constructor(
    private readonly llmSettingsResolver: ILlmSettingsResolver,
    private readonly providerClient: InfrastructureLlmProviderClient = new InfrastructureLlmProviderClient()
  ) {}

  async testConnectionAsync(config: TeamConfig, providerRef: string): Promise<void> {
    const registry = config.providers || {};
    const providerConfig = registry[providerRef];
    const model = providerConfig?.defaultModel;

    const tempConfig: TeamConfig = {
      ...config,
      providers: registry,
      defaultModel: model ? { provider: providerRef, model } : config.defaultModel,
    };

    const resolved = this.llmSettingsResolver.resolveEffectiveLlmSettings(
      tempConfig,
      undefined,
      undefined,
      {
        model: undefined,
      }
    );

    try {
      await this.providerClient.testConnectionAsync(resolved.config);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'LLM connection failed.');
    }
  }

  async testLlmConnectionAsync(config: LlmConfig, apiKey?: string): Promise<string> {
    return this.providerClient.testConnectionAsync(config, apiKey);
  }
}
