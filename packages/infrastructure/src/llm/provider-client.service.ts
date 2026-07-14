import type { LlmConfig } from '@ai-team/core';
import OpenAI from 'openai';
import { LlmProviderClient } from './llm-provider-client.js';

export class InfrastructureLlmProviderClient {
  private readonly providerClient = new LlmProviderClient();

  createClient(config: LlmConfig, apiKey?: string): OpenAI {
    return this.providerClient.createLlmClient(config, apiKey);
  }

  getDefaultModel(config: LlmConfig): string {
    return this.providerClient.getDefaultModel(config);
  }

  async testConnectionAsync(config: LlmConfig, apiKey?: string): Promise<string> {
    return this.providerClient.testLlmConnection(config, apiKey);
  }
}
