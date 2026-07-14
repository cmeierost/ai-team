import type {
  DiscoveredModel,
  IModelDiscoveryRegistry,
  IModelDiscoveryService,
} from '@ai-team/core';
import { InfrastructureModelCatalogService } from './model-catalog.service.js';

export class GitHubModelDiscoveryService implements IModelDiscoveryService {
  readonly kind = 'github-copilot';

  constructor(
    private readonly modelCatalog: InfrastructureModelCatalogService = new InfrastructureModelCatalogService()
  ) {}

  async fetchModelsAsync(): Promise<DiscoveredModel[]> {
    const models = await this.modelCatalog.fetchGitHubModelsAsync();
    return models.map((m) => ({
      name: m.id,
      contextWindow: m.contextWindow,
      maxPromptTokens: m.maxPromptTokens,
      maxContextWindowTokens: m.maxContextWindowTokens,
      maxOutputTokens: m.maxOutputTokens,
    }));
  }
}

export class OpenAICompatibleModelDiscoveryService implements IModelDiscoveryService {
  readonly kind = 'openai-compatible';

  constructor(
    private readonly modelCatalog: InfrastructureModelCatalogService = new InfrastructureModelCatalogService()
  ) {}

  async fetchModelsAsync(baseUrl?: string, apiKey?: string): Promise<DiscoveredModel[]> {
    if (!baseUrl) {
      throw new Error('baseUrl is required for openai-compatible model discovery.');
    }
    const models = await this.modelCatalog.fetchOpenAiCompatibleModelsDetailedAsync(
      baseUrl,
      apiKey
    );
    return models.map((m) => ({
      name: m.id,
      contextWindow: m.contextWindow,
      maxPromptTokens: m.maxPromptTokens,
      maxContextWindowTokens: m.maxContextWindowTokens,
      maxOutputTokens: m.maxOutputTokens,
    }));
  }
}

export class ModelDiscoveryRegistry implements IModelDiscoveryRegistry {
  private readonly services: Map<string, IModelDiscoveryService>;

  constructor(services: IModelDiscoveryService[]) {
    this.services = new Map(services.map((s) => [s.kind, s]));
  }

  getForKind(kind: string): IModelDiscoveryService | undefined {
    return this.services.get(kind);
  }
}
