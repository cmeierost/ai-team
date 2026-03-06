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
   * Resolve manager ID from reportsTo field (supports ID or role-based reference)
   * @param reportsTo - Raw reportsTo value (ID or role name)
   * @returns Resolved manager ID and optional error message
   */
  private resolveManagerId(reportsTo: string): { id: string | null; error?: string } {
    // Try exact ID lookup first (fast path)
    const exactMatch = this.agentManager.getAgent(reportsTo);
    if (exactMatch) {
      return { id: reportsTo };
    }

    const q = reportsTo.toLowerCase().trim();
    const allAgents = this.agentManager.getAllAgents();

    // Try exact role match before fuzzy (e.g. reportsTo: 'cto').
    // This avoids fuzzy collisions where a short role string also fuzzy-matches
    // a different agent (e.g. levenshtein('ceo','cto') = 1).
    const roleMatches = allAgents.filter(a => a.role.toLowerCase() === q);
    if (roleMatches.length === 1) return { id: roleMatches[0].id };
    if (roleMatches.length > 1) {
      const names = roleMatches.map(m => m.name).join(', ');
      return { id: null, error: `Ambiguous role reference "${reportsTo}" matches: ${names}` };
    }

    // Try exact name match (e.g. reportsTo: 'Alice Wong').
    const nameMatches = allAgents.filter(a => a.name.toLowerCase() === q);
    if (nameMatches.length === 1) return { id: nameMatches[0].id };
    if (nameMatches.length > 1) {
      const names = nameMatches.map(m => m.name).join(', ');
      return { id: null, error: `Ambiguous name reference "${reportsTo}" matches: ${names}` };
    }

    // Fall back to fuzzy resolution (partial substring, Levenshtein, etc.)
    const matches = this.agentManager.resolveAgent(reportsTo);

    if (matches.length === 0) {
      return {
        id: null,
        error: `Manager "${reportsTo}" not found`,
      };
    }

    if (matches.length > 1) {
      const names = matches.map(m => m.name).join(', ');
      return {
        id: null,
        error: `Ambiguous reference "${reportsTo}" matches: ${names}`,
      };
    }

    return { id: matches[0].id };
  }

  /**
   * Add reporting relationship edges
   */
  private addHierarchyEdges(agents: Agent[], edges: GraphEdge[]): void {
    for (const agent of agents) {
      if (agent.reportsTo) {
        const { id: managerId, error } = this.resolveManagerId(agent.reportsTo);
        
        if (managerId) {
          // Successfully resolved
          edges.push({
            id: `${agent.id}-reports-to-${managerId}`,
            source: agent.id,
            target: managerId,
            type: EdgeType.REPORTS_TO,
            label: 'reports to',
          });
        } else {
          // Resolution failed - add broken edge for visualization
          edges.push({
            id: `${agent.id}-reports-to-unresolved`,
            source: agent.id,
            target: agent.reportsTo, // Keep original for error display
            type: EdgeType.REPORTS_TO_UNRESOLVED,
            label: 'reports to',
            error,
          });
        }
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
