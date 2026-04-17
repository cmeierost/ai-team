import type { ApiDescription } from '@ts-http/core';
import type { WorkflowDefinitionApiResponse } from '../shared-types.js';

export interface IContextService {
  getContextEstimate(agentId: string, query?: { sessionId?: string }): Promise<unknown>;
  getContextEstimateForSession(agentId: string, sessionId: string): Promise<unknown>;
  getWorkflowDefinition(workflowId: string): Promise<WorkflowDefinitionApiResponse>;
}

export const contextDesc: ApiDescription<IContextService> = {
  subRoute: '/api/context',
  mapping: {
    getContextEstimate: { method: 'GET', path: 'context-estimate/:agentId' },
    getContextEstimateForSession: {
      method: 'GET',
      path: 'context-estimate/:agentId/session/:sessionId',
    },
    getWorkflowDefinition: {
      method: 'GET',
      path: 'workflows/:workflowId/definition',
    },
  },
};
