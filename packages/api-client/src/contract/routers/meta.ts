import type { ApiDescription } from '@ts-http/core';

export interface IContextService {
  getContextEstimate(agentId: string, query?: { sessionId?: string }): Promise<unknown>;
}

export const contextDesc: ApiDescription<IContextService> = {
  subRoute: '/api/context',
  mapping: {
    getContextEstimate: { method: 'GET', path: 'context-estimate/:agentId' },
  },
};
