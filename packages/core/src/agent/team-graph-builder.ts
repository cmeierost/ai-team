/**
 * Team graph builder - constructs organization graph from agents
 */

import { GraphData, ViewMode, Feature } from '../types/index.js';

export interface ITeamGraphBuilder {
  /**
   * Build complete organization graph
   * @param viewMode - How to organize the graph
   * @param features - Optional feature map for feature view
   * @returns Graph data with nodes and edges
   */
  buildGraph(viewMode: ViewMode, features?: Map<string, Feature>): Promise<GraphData>;

  /**
   * Build the default organization hierarchy graph.
   */
  buildOrganizationGraph(): Promise<GraphData>;

  /**
   * Calculate layout positions for hierarchical view
   * Uses a simple tree layout algorithm
   */
  calculateHierarchicalLayout(graphData: GraphData): GraphData;
}
