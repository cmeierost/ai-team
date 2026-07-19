import type { IArtifactsService } from '@ai-team/api-contracts';
import type { ISessionManager } from '@ai-team/core';

export class ArtifactsService implements IArtifactsService {
  constructor(private readonly sessionManager: ISessionManager) {}

  async list(_query?: { sessionId?: string }): Promise<unknown[]> {
    return [];
  }

  async get(_artifactId: string): Promise<unknown> {
    return undefined;
  }
}
