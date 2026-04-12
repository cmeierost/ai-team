import type { ApiDescription } from '@ts-http/core';
import type { Agent, AgentStatus } from './agents.js';

export enum EdgeType {
  REPORTS_TO = 'reports-to',
  REPORTS_TO_UNRESOLVED = 'reports-to-unresolved',
  MANAGES = 'manages',
  OWNS_FEATURE = 'owns-feature',
  CONTRIBUTES_TO = 'contributes-to',
  CONSULTS_ON = 'consults-on',
  SHARES_CONTEXT = 'shares-context',
}

export type ViewMode = 'hierarchy' | 'features' | 'expertise' | 'matrix';

export interface GraphNode {
  id: string;
  type: 'agent' | 'feature';
  data: {
    label: string;
    agent?: Agent;
    feature?: {
      id: string;
      name: string;
      description: string;
      owner: string;
      team: string[];
      contextPaths: string[];
      status: string;
    };
    role?: string;
    status?: AgentStatus;
  };
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  error?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ITeamGraphService {
  getTeamGraph(mode?: ViewMode): Promise<GraphData>;
  getOrganizationGraph(): Promise<GraphData>;
}

export const teamDesc: ApiDescription<ITeamGraphService> = {
  subRoute: '/api/team',
  mapping: {
    getTeamGraph: { method: 'GET', path: 'graph' },
    getOrganizationGraph: { method: 'GET', path: 'organization-graph' },
  },
};
