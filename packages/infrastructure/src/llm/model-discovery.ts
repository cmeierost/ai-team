import type {
  DiscoveredModel,
  IModelDiscoveryRegistry,
  IModelDiscoveryService,
} from '@ai-team/core';
import { fetchGitHubModels, fetchOpenAICompatibleModelsDetailed } from './index.js';

export class GitHubModelDiscoveryService implements IModelDiscoveryService {
  readonly kind = 'github-copilot';

  async fetchModelsAsync(): Promise<DiscoveredModel[]> {
    const models = await fetchGitHubModels();
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

  async fetchModelsAsync(baseUrl?: string, apiKey?: string): Promise<DiscoveredModel[]> {
    if (!baseUrl) {
      throw new Error('baseUrl is required for openai-compatible model discovery.');
    }
    const models = await fetchOpenAICompatibleModelsDetailed(baseUrl, apiKey);
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

export function createModelDiscoveryRegistry(): ModelDiscoveryRegistry {
  return new ModelDiscoveryRegistry([
    new GitHubModelDiscoveryService(),
    new OpenAICompatibleModelDiscoveryService(),
  ]);
}
