import type { Agent, Feature } from './agent-models.js';
import { AgentStatus, EdgeType } from './taxonomy.js';

export interface GraphNode {
  id: string;
  type: 'agent' | 'feature';
  data: {
    label: string;
    agent?: Agent;
    feature?: Feature;
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
