import type { IArtifactsService } from '@ai-team/api-contracts';
import type { SessionManager } from '../sessions/session-manager.js';
import { NotFoundError } from '@ai-team/core';

export class ArtifactsService implements IArtifactsService {
  constructor(private readonly sessionManager: SessionManager) {}

  async list(query?: { sessionId?: string }): Promise<unknown[]> {
    return (await (this.sessionManager as any).listArtifacts?.(query?.sessionId)) ?? [];
  }

  async get(artifactId: string): Promise<unknown> {
    const artifact = await (this.sessionManager as any).getArtifact?.(artifactId);
    if (!artifact) throw new NotFoundError('Artifact not found');
    return artifact;
  }
}
