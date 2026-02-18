/**
 * Team graph builder - constructs organization graph from agents
 */

import {
  Agent,
  GraphNode,
  GraphEdge,
  GraphData,
  EdgeType,
  ViewMode,
  Feature,
} from '../types/index.js';
import { AgentManager } from '../agent/index.js';

export class TeamGraphBuilder {
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  /**
   * Build complete organization graph
   * @param viewMode - How to organize the graph
   * @param features - Optional feature map for feature view
   * @returns Graph data with nodes and edges
   */
  buildGraph(viewMode: ViewMode = 'hierarchy', features?: Map<string, Feature>): GraphData {
    const agents = this.agentManager.getAllAgents();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Create agent nodes
    for (const agent of agents) {
      nodes.push({
        id: agent.id,
        type: 'agent',
        data: {
          label: agent.name,
          agent,
          role: agent.role,
          status: agent.status,
        },
      });
    }

    // Create edges based on view mode
    switch (viewMode) {
      case 'hierarchy':
        this.addHierarchyEdges(agents, edges);
        break;
      
      case 'features':
        if (features) {
          this.addFeatureNodes(features, nodes);
          this.addFeatureEdges(agents, features, edges);
        }
        break;
      
      case 'expertise':
        this.addExpertiseEdges(agents, edges);
        break;
      
      case 'matrix':
        this.addHierarchyEdges(agents, edges);
        if (features) {
          this.addFeatureEdges(agents, features, edges);
        }
        this.addCollaborationEdges(agents, edges);
        break;
    }

    return { nodes, edges };
  }

  /**
   * Add reporting relationship edges
   */
  private addHierarchyEdges(agents: Agent[], edges: GraphEdge[]): void {
    for (const agent of agents) {
      if (agent.reportsTo) {
        edges.push({
          id: `${agent.id}-reports-to-${agent.reportsTo}`,
          source: agent.id,
          target: agent.reportsTo,
          type: EdgeType.REPORTS_TO,
          label: 'reports to',
        });
      }
    }
  }

  /**
   * Add feature nodes to graph
   */
  private addFeatureNodes(features: Map<string, Feature>, nodes: GraphNode[]): void {
    for (const [id, feature] of features) {
      nodes.push({
        id: `feature-${id}`,
        type: 'feature',
        data: {
          label: feature.name,
          feature,
        },
      });
    }
  }

  /**
   * Add feature ownership edges
   */
  private addFeatureEdges(
    agents: Agent[],
    features: Map<string, Feature>,
    edges: GraphEdge[]
  ): void {
    for (const [featureId, feature] of features) {
      // Owner edge
      edges.push({
        id: `${feature.owner}-owns-${featureId}`,
        source: feature.owner,
        target: `feature-${featureId}`,
        type: EdgeType.OWNS_FEATURE,
        label: 'owns',
      });

      // Team member edges
      for (const memberId of feature.team) {
        if (memberId !== feature.owner) {
          edges.push({
            id: `${memberId}-contributes-${featureId}`,
            source: memberId,
            target: `feature-${featureId}`,
            type: EdgeType.CONTRIBUTES_TO,
            label: 'contributes',
          });
        }
      }
    }

    // Add feature-based edges for agents
    for (const agent of agents) {
      if (agent.features) {
        for (const featureId of agent.features) {
          const feature = features.get(featureId);
          if (feature && feature.owner !== agent.id && !feature.team.includes(agent.id)) {
            edges.push({
              id: `${agent.id}-feature-${featureId}`,
              source: agent.id,
              target: `feature-${featureId}`,
              type: EdgeType.CONTRIBUTES_TO,
            });
          }
        }
      }
    }
  }

  /**
   * Add expertise-based edges (cross-concern specialists)
   */
  private addExpertiseEdges(agents: Agent[], edges: GraphEdge[]): void {
    for (const agent of agents) {
      if (agent.availableFor) {
        // This agent is available for consultation
        for (const otherAgent of agents) {
          if (otherAgent.id !== agent.id && otherAgent.specializations) {
            // Check if other agent needs this expertise
            const needsConsultation = agent.availableFor.some(expertise =>
              otherAgent.specializations?.includes(expertise)
            );
            
            if (needsConsultation) {
              edges.push({
                id: `${otherAgent.id}-consults-${agent.id}`,
                source: otherAgent.id,
                target: agent.id,
                type: EdgeType.CONSULTS_ON,
                label: 'consults',
              });
            }
          }
        }
      }
    }
  }

  /**
   * Add collaboration edges based on delegate relationships
   */
  private addCollaborationEdges(agents: Agent[], edges: GraphEdge[]): void {
    for (const agent of agents) {
      if (agent.delegatesTo) {
        for (const targetId of agent.delegatesTo) {
          edges.push({
            id: `${agent.id}-delegates-${targetId}`,
            source: agent.id,
            target: targetId,
            type: EdgeType.SHARES_CONTEXT,
            label: 'delegates to',
          });
        }
      }
    }
  }

  /**
   * Calculate layout positions for hierarchical view
   * Uses a simple tree layout algorithm
   */
  calculateHierarchicalLayout(graphData: GraphData): GraphData {
    const { nodes, edges } = graphData;
    
    // Find root nodes (those without incoming REPORTS_TO edges)
    const hasManager = new Set(
      edges
        .filter(e => e.type === EdgeType.REPORTS_TO)
        .map(e => e.source)
    );
    
    const roots = nodes.filter(n => !hasManager.has(n.id));
    
    // Simple layout: assign levels based on depth
    const levels = new Map<string, number>();
    const visited = new Set<string>();
    
    const assignLevel = (nodeId: string, level: number) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      levels.set(nodeId, level);
      
      // Find direct reports
      const reports = edges
        .filter(e => e.type === EdgeType.REPORTS_TO && e.target === nodeId)
        .map(e => e.source);
      
      for (const reportId of reports) {
        assignLevel(reportId, level + 1);
      }
    };
    
    // Assign levels starting from roots
    for (const root of roots) {
      assignLevel(root.id, 0);
    }
    
    // Calculate positions
    const levelCounts = new Map<number, number>();
    const positionedNodes = nodes.map(node => {
      const level = levels.get(node.id) || 0;
      const count = levelCounts.get(level) || 0;
      levelCounts.set(level, count + 1);
      
      return {
        ...node,
        position: {
          x: count * 250,
          y: level * 150,
        },
      };
    });
    
    return { nodes: positionedNodes, edges };
  }
}
