import type { DiscoveredProviderModel } from './llm-model-discovery-client.js';
import { LlmModelDiscoveryClient } from './llm-model-discovery-client.js';

export class InfrastructureModelCatalogService {
  private readonly discoveryClient = new LlmModelDiscoveryClient();

  fetchGitHubModelsAsync(): Promise<DiscoveredProviderModel[]> {
    return this.discoveryClient.fetchGitHubModels();
  }

  fetchOpenAiCompatibleModelIdsAsync(baseUrl: string, apiKey?: string): Promise<string[]> {
    return this.discoveryClient.fetchOpenAICompatibleModels(baseUrl, apiKey);
  }

  fetchOpenAiCompatibleModelsDetailedAsync(
    baseUrl: string,
    apiKey?: string
  ): Promise<DiscoveredProviderModel[]> {
    return this.discoveryClient.fetchOpenAICompatibleModelsDetailed(baseUrl, apiKey);
  }
}
