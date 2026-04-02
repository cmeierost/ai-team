// @aspect/engine — Graph metrics calculator
// Builds dependency graphs and computes cycle detection, centrality,
// PageRank, and community detection using graphology.

import Graph, { UndirectedGraph } from 'graphology';
import { stronglyConnectedComponents } from 'graphology-components';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness.js';
import pagerank from 'graphology-metrics/centrality/pagerank.js';
import louvain from 'graphology-communities-louvain';
import type { Entity, Relationship } from '@aspect/contracts';

// ── Result types ────────────────────────────────────────────────────────

export interface GraphMetricsResult {
  cycles: CycleInfo;
  centrality: CentralityResult[];
  pageRank: PageRankResult[];
  communities: CommunityResult;
}

export interface CycleInfo {
  cycleCount: number;
  largestCycleSize: number;
  totalEntitiesInCycles: number;
  cycles: Array<{
    id: string;
    entityIds: string[];
    size: number;
  }>;
}

export interface CentralityResult {
  entityId: string;
  betweennessCentrality: number;
}

export interface PageRankResult {
  entityId: string;
  pageRank: number;
}

export interface CommunityResult {
  communityCount: number;
  communities: Array<{
    id: string;
    entityIds: string[];
    size: number;
  }>;
  modularity: number;
}

// ── Graph building ──────────────────────────────────────────────────────

export function buildDependencyGraph(
  entities: Entity[],
  relationships: Relationship[],
): Graph {
  const graph = new Graph({ type: 'directed', multi: false });

  for (const entity of entities) {
    if (!graph.hasNode(entity.id)) {
      graph.addNode(entity.id, {
        kind: entity.kind,
        name: entity.name,
        filePath: entity.filePath,
      });
    }
  }

  for (const rel of relationships) {
    // Ensure both endpoints exist (relationships may reference entities
    // not in the provided list, e.g. third-party targets).
    if (!graph.hasNode(rel.sourceEntityId)) {
      graph.mergeNode(rel.sourceEntityId);
    }
    if (!graph.hasNode(rel.targetEntityId)) {
      graph.mergeNode(rel.targetEntityId);
    }

    const edgeKey = `${rel.sourceEntityId}->${rel.targetEntityId}`;
    if (graph.hasEdge(edgeKey)) {
      // Increment weight for parallel edges between same pair
      const w = (graph.getEdgeAttribute(edgeKey, 'weight') as number) ?? 1;
      graph.setEdgeAttribute(edgeKey, 'weight', w + 1);
    } else {
      graph.addEdgeWithKey(edgeKey, rel.sourceEntityId, rel.targetEntityId, {
        kind: rel.kind,
        crossModule: rel.crossModule,
        thirdParty: rel.thirdParty,
        typeOnly: rel.typeOnly,
        weight: 1,
      });
    }
  }

  return graph;
}

// ── Cycle detection (Tarjan's SCC) ──────────────────────────────────────

export function detectCycles(graph: Graph): CycleInfo {
  if (graph.order === 0) {
    return { cycleCount: 0, largestCycleSize: 0, totalEntitiesInCycles: 0, cycles: [] };
  }

  const sccs = stronglyConnectedComponents(graph);

  // Filter to SCCs with size > 1 (a single node is not a cycle unless self-loop,
  // but Tarjan's SCCs don't inherently capture self-loops as size > 1)
  const cyclicSccs = sccs.filter((scc) => scc.length > 1);

  const cycles = cyclicSccs.map((scc, i) => ({
    id: `scc-${i}`,
    entityIds: scc.sort(),
    size: scc.length,
  }));

  const totalEntitiesInCycles = cycles.reduce((sum, c) => sum + c.size, 0);

  return {
    cycleCount: cycles.length,
    largestCycleSize: cycles.length > 0 ? Math.max(...cycles.map((c) => c.size)) : 0,
    totalEntitiesInCycles,
    cycles,
  };
}

// ── Betweenness centrality ──────────────────────────────────────────────

export function calculateCentrality(graph: Graph): CentralityResult[] {
  if (graph.order === 0) return [];

  const mapping = betweennessCentrality(graph, { normalized: true });

  return Object.entries(mapping)
    .map(([entityId, value]) => ({
      entityId,
      betweennessCentrality: value,
    }))
    .sort((a, b) => b.betweennessCentrality - a.betweennessCentrality);
}

// ── PageRank ────────────────────────────────────────────────────────────

export function calculatePageRank(graph: Graph): PageRankResult[] {
  if (graph.order === 0) return [];

  const mapping = pagerank(graph, {
    alpha: 0.85,
    maxIterations: 100,
    tolerance: 1e-6,
    getEdgeWeight: 'weight',
  });

  return Object.entries(mapping)
    .map(([entityId, value]) => ({
      entityId,
      pageRank: value,
    }))
    .sort((a, b) => b.pageRank - a.pageRank);
}

// ── Community detection (Louvain) ───────────────────────────────────────

export function detectCommunities(graph: Graph): CommunityResult {
  if (graph.order === 0) {
    return { communityCount: 0, communities: [], modularity: 0 };
  }

  // Louvain requires an undirected graph — build one by merging edge weights
  const undirected = new UndirectedGraph();

  graph.forEachNode((node, attrs) => {
    undirected.addNode(node, attrs);
  });

  graph.forEachEdge((_edge, attrs, source, target) => {
    if (source === target) return; // skip self-loops
    const w = (attrs.weight as number) ?? 1;
    if (undirected.hasEdge(source, target)) {
      const existing = (undirected.getEdgeAttribute(source, target, 'weight') as number) ?? 0;
      undirected.setEdgeAttribute(source, target, 'weight', existing + w);
    } else {
      undirected.mergeEdge(source, target, { weight: w });
    }
  });

  // Single node or no edges — Louvain may error; return each node as its own community
  if (undirected.size === 0) {
    const nodes = undirected.nodes();
    return {
      communityCount: nodes.length,
      communities: nodes.map((n, i) => ({
        id: `community-${i}`,
        entityIds: [n],
        size: 1,
      })),
      modularity: 0,
    };
  }

  const detailed = louvain.detailed(undirected, { getEdgeWeight: 'weight' });

  // Group nodes by community
  const communityMap = new Map<number, string[]>();
  for (const [node, communityId] of Object.entries(detailed.communities)) {
    const list = communityMap.get(communityId) ?? [];
    list.push(node);
    communityMap.set(communityId, list);
  }

  // Sort community IDs for deterministic output
  const sortedIds = [...communityMap.keys()].sort((a, b) => a - b);

  const communities = sortedIds.map((cid, i) => {
    const entityIds = communityMap.get(cid)!.sort();
    return {
      id: `community-${i}`,
      entityIds,
      size: entityIds.length,
    };
  });

  return {
    communityCount: communities.length,
    communities,
    modularity: detailed.modularity,
  };
}

// ── Combined entry point ────────────────────────────────────────────────

export function calculateGraphMetrics(
  entities: Entity[],
  relationships: Relationship[],
): GraphMetricsResult {
  const graph = buildDependencyGraph(entities, relationships);

  return {
    cycles: detectCycles(graph),
    centrality: calculateCentrality(graph),
    pageRank: calculatePageRank(graph),
    communities: detectCommunities(graph),
  };
}
