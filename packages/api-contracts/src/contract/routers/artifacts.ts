import type { ApiDescription } from '@ts-http/core';

export interface IArtifactsService {
  list(query?: { sessionId?: string }): Promise<unknown[]>;
  get(artifactId: string): Promise<unknown>;
}

export const artifactsDesc: ApiDescription<IArtifactsService> = {
  subRoute: '/api/artifacts',
  mapping: {
    list: { method: 'GET', path: '' },
    get: { method: 'GET', path: ':artifactId' },
  },
};
