import { describe, it, expect } from 'vitest';
import type { Entity, Relationship } from '@aspect/contracts';
import {
  buildDependencyGraph,
  detectCycles,
  calculateCentrality,
  calculatePageRank,
  detectCommunities,
  calculateGraphMetrics,
} from './graph-metrics.js';

// ── Test data helpers ───────────────────────────────────────────────────

function entity(id: string, overrides?: Partial<Entity>): Entity {
  return {
    id,
    kind: 'function',
    name: id,
    filePath: `${id}.ts`,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 10, endColumn: 0 },
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: true,
      visibility: 'public',
    },
    ...overrides,
  } as Entity;
}

function rel(
  source: string,
  target: string,
  overrides?: Partial<Relationship>,
): Relationship {
  return {
    sourceEntityId: source,
    targetEntityId: target,
    kind: 'import',
    sourceRange: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 20 },
    targetClassification: 'concrete',
    targetIsAbstraction: false,
    crossModule: false,
    crossPackage: false,
    thirdParty: false,
    typeOnly: false,
    dynamic: false,
    ...overrides,
  } as Relationship;
}

// ── buildDependencyGraph ────────────────────────────────────────────────

describe('buildDependencyGraph', () => {
  it('creates graph with correct node and edge count', () => {
    const entities = [entity('A'), entity('B'), entity('C')];
    const rels = [rel('A', 'B'), rel('B', 'C')];

    const graph = buildDependencyGraph(entities, rels);

    expect(graph.order).toBe(3);
    expect(graph.size).toBe(2);
    expect(graph.hasNode('A')).toBe(true);
    expect(graph.hasNode('B')).toBe(true);
    expect(graph.hasNode('C')).toBe(true);
    expect(graph.hasDirectedEdge('A', 'B')).toBe(true);
    expect(graph.hasDirectedEdge('B', 'C')).toBe(true);
  });

  it('builds graph with only nodes when no relationships', () => {
    const entities = [entity('A'), entity('B')];
    const graph = buildDependencyGraph(entities, []);

    expect(graph.order).toBe(2);
    expect(graph.size).toBe(0);
  });

  it('merges parallel edges by incrementing weight', () => {
    const entities = [entity('A'), entity('B')];
    const rels = [
      rel('A', 'B', { kind: 'import' }),
      rel('A', 'B', { kind: 'call' }),
    ];

    const graph = buildDependencyGraph(entities, rels);

    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);
    const edge = graph.edge('A', 'B')!;
    expect(graph.getEdgeAttribute(edge, 'weight')).toBe(2);
  });

  it('auto-creates nodes for relationship endpoints not in entity list', () => {
    const entities = [entity('A')];
    const rels = [rel('A', 'external')];

    const graph = buildDependencyGraph(entities, rels);

    expect(graph.order).toBe(2);
    expect(graph.hasNode('external')).toBe(true);
  });
});

// ── detectCycles ────────────────────────────────────────────────────────

describe('detectCycles', () => {
  it('returns cycleCount=0 for a DAG', () => {
    const entities = [entity('A'), entity('B'), entity('C')];
    const rels = [rel('A', 'B'), rel('B', 'C')];
    const graph = buildDependencyGraph(entities, rels);

    const result = detectCycles(graph);

    expect(result.cycleCount).toBe(0);
    expect(result.largestCycleSize).toBe(0);
    expect(result.totalEntitiesInCycles).toBe(0);
    expect(result.cycles).toHaveLength(0);
  });

  it('detects a simple 3-node cycle', () => {
    const entities = [entity('A'), entity('B'), entity('C')];
    const rels = [rel('A', 'B'), rel('B', 'C'), rel('C', 'A')];
    const graph = buildDependencyGraph(entities, rels);

    const result = detectCycles(graph);

    expect(result.cycleCount).toBe(1);
    expect(result.largestCycleSize).toBe(3);
    expect(result.totalEntitiesInCycles).toBe(3);
    expect(result.cycles[0].entityIds).toEqual(
      expect.arrayContaining(['A', 'B', 'C']),
    );
  });

  it('does not count a self-loop as an SCC cycle (single-node SCC)', () => {
    // Tarjan's SCC treats a single node with a self-loop as an SCC of size 1.
    // Our filter (size > 1) excludes it. This documents the behavior.
    const entities = [entity('A')];
    const rels = [rel('A', 'A')];
    const graph = buildDependencyGraph(entities, rels);

    const result = detectCycles(graph);

    // Self-loop: SCC size = 1, filtered out by our >1 rule
    expect(result.cycleCount).toBe(0);
  });

  it('detects multiple independent cycles', () => {
    const entities = [entity('A'), entity('B'), entity('C'), entity('D')];
    const rels = [
      rel('A', 'B'),
      rel('B', 'A'),
      rel('C', 'D'),
      rel('D', 'C'),
    ];
    const graph = buildDependencyGraph(entities, rels);

    const result = detectCycles(graph);

    expect(result.cycleCount).toBe(2);
    expect(result.totalEntitiesInCycles).toBe(4);
    expect(result.largestCycleSize).toBe(2);
  });

  it('finds a complex SCC mixed with isolated nodes', () => {
    // A→B→C→D→B forms an SCC of {B,C,D}; A leads in, E is isolated
    const entities = [
      entity('A'),
      entity('B'),
      entity('C'),
      entity('D'),
      entity('E'),
    ];
    const rels = [
      rel('A', 'B'),
      rel('B', 'C'),
      rel('C', 'D'),
      rel('D', 'B'),
    ];
    const graph = buildDependencyGraph(entities, rels);

    const result = detectCycles(graph);

    expect(result.cycleCount).toBe(1);
    expect(result.cycles[0].size).toBe(3);
    expect(result.cycles[0].entityIds).toEqual(
      expect.arrayContaining(['B', 'C', 'D']),
    );
    expect(result.totalEntitiesInCycles).toBe(3);
  });

  it('handles empty graph', () => {
    const graph = buildDependencyGraph([], []);
    const result = detectCycles(graph);

    expect(result.cycleCount).toBe(0);
    expect(result.cycles).toHaveLength(0);
  });
});

// ── calculateCentrality ─────────────────────────────────────────────────

describe('calculateCentrality', () => {
  it('assigns highest centrality to center of a star graph', () => {
    // Star: hub→A, hub→B, hub→C, A→hub, B→hub, C→hub
    const entities = [entity('hub'), entity('A'), entity('B'), entity('C')];
    const rels = [
      rel('hub', 'A'),
      rel('hub', 'B'),
      rel('hub', 'C'),
      rel('A', 'hub'),
      rel('B', 'hub'),
      rel('C', 'hub'),
    ];
    const graph = buildDependencyGraph(entities, rels);

    const result = calculateCentrality(graph);
    const hubResult = result.find((r) => r.entityId === 'hub')!;
    const leafResults = result.filter((r) => r.entityId !== 'hub');

    expect(hubResult.betweennessCentrality).toBeGreaterThan(0);
    for (const leaf of leafResults) {
      expect(hubResult.betweennessCentrality).toBeGreaterThanOrEqual(
        leaf.betweennessCentrality,
      );
    }
  });

  it('assigns highest centrality to middle of a linear chain', () => {
    // A→B→C→D→E
    const entities = [
      entity('A'),
      entity('B'),
      entity('C'),
      entity('D'),
      entity('E'),
    ];
    const rels = [rel('A', 'B'), rel('B', 'C'), rel('C', 'D'), rel('D', 'E')];
    const graph = buildDependencyGraph(entities, rels);

    const result = calculateCentrality(graph);
    const bResult = result.find((r) => r.entityId === 'B')!;
    const cResult = result.find((r) => r.entityId === 'C')!;
    const dResult = result.find((r) => r.entityId === 'D')!;

    // Middle nodes (B, C, D) should have higher centrality than endpoints
    const aResult = result.find((r) => r.entityId === 'A')!;
    const eResult = result.find((r) => r.entityId === 'E')!;

    expect(cResult.betweennessCentrality).toBeGreaterThan(
      aResult.betweennessCentrality,
    );
    expect(cResult.betweennessCentrality).toBeGreaterThan(
      eResult.betweennessCentrality,
    );
    // C should be highest (or tied with B/D for directed chains)
    expect(cResult.betweennessCentrality).toBeGreaterThanOrEqual(
      bResult.betweennessCentrality,
    );
    expect(cResult.betweennessCentrality).toBeGreaterThanOrEqual(
      dResult.betweennessCentrality,
    );
  });

  it('returns centrality 0 for isolated nodes', () => {
    const entities = [entity('A'), entity('B'), entity('C')];
    const graph = buildDependencyGraph(entities, []);

    const result = calculateCentrality(graph);

    for (const r of result) {
      expect(r.betweennessCentrality).toBe(0);
    }
  });

  it('returns empty array for empty graph', () => {
    const graph = buildDependencyGraph([], []);
    expect(calculateCentrality(graph)).toHaveLength(0);
  });
});

// ── calculatePageRank ───────────────────────────────────────────────────

describe('calculatePageRank', () => {
  it('gives highest rank to node everyone points to', () => {
    const entities = [entity('A'), entity('B'), entity('C'), entity('sink')];
    const rels = [rel('A', 'sink'), rel('B', 'sink'), rel('C', 'sink')];
    const graph = buildDependencyGraph(entities, rels);

    const result = calculatePageRank(graph);
    const sinkRank = result.find((r) => r.entityId === 'sink')!;

    for (const r of result) {
      if (r.entityId !== 'sink') {
        expect(sinkRank.pageRank).toBeGreaterThan(r.pageRank);
      }
    }
  });

  it('gives roughly equal rank in an equal cycle', () => {
    const entities = [entity('A'), entity('B'), entity('C')];
    const rels = [rel('A', 'B'), rel('B', 'C'), rel('C', 'A')];
    const graph = buildDependencyGraph(entities, rels);

    const result = calculatePageRank(graph);
    const ranks = result.map((r) => r.pageRank);

    // All should be roughly 1/3
    for (const rank of ranks) {
      expect(rank).toBeCloseTo(1 / 3, 2);
    }
  });

  it('returns PageRank for single node', () => {
    const entities = [entity('A')];
    const graph = buildDependencyGraph(entities, []);

    const result = calculatePageRank(graph);

    expect(result).toHaveLength(1);
    expect(result[0].entityId).toBe('A');
    expect(result[0].pageRank).toBeCloseTo(1, 2);
  });

  it('returns empty array for empty graph', () => {
    const graph = buildDependencyGraph([], []);
    expect(calculatePageRank(graph)).toHaveLength(0);
  });
});

// ── detectCommunities ───────────────────────────────────────────────────

describe('detectCommunities', () => {
  it('detects two clear clusters', () => {
    // Cluster 1: A-B-C tightly connected; Cluster 2: D-E-F tightly connected
    // One weak link between them
    const entities = [
      entity('A'),
      entity('B'),
      entity('C'),
      entity('D'),
      entity('E'),
      entity('F'),
    ];
    const rels = [
      // Cluster 1 (dense)
      rel('A', 'B'),
      rel('B', 'A'),
      rel('B', 'C'),
      rel('C', 'A'),
      rel('A', 'C'),
      rel('C', 'B'),
      // Cluster 2 (dense)
      rel('D', 'E'),
      rel('E', 'D'),
      rel('E', 'F'),
      rel('F', 'D'),
      rel('D', 'F'),
      rel('F', 'E'),
      // Weak bridge
      rel('C', 'D'),
    ];
    const graph = buildDependencyGraph(entities, rels);

    const result = detectCommunities(graph);

    expect(result.communityCount).toBe(2);
    expect(result.communities).toHaveLength(2);

    // Each community should have 3 nodes
    const sizes = result.communities.map((c) => c.size).sort();
    expect(sizes).toEqual([3, 3]);

    // Verify modularity is positive (good community structure)
    expect(result.modularity).toBeGreaterThan(0);
  });

  it('puts a single tight cluster in one community', () => {
    const entities = [entity('A'), entity('B'), entity('C')];
    const rels = [
      rel('A', 'B'),
      rel('B', 'C'),
      rel('C', 'A'),
      rel('B', 'A'),
      rel('C', 'B'),
      rel('A', 'C'),
    ];
    const graph = buildDependencyGraph(entities, rels);

    const result = detectCommunities(graph);

    expect(result.communityCount).toBe(1);
    expect(result.communities[0].size).toBe(3);
  });

  it('handles isolated nodes with no edges', () => {
    const entities = [entity('A'), entity('B')];
    const graph = buildDependencyGraph(entities, []);

    const result = detectCommunities(graph);

    // Each isolated node is its own community
    expect(result.communityCount).toBe(2);
    expect(result.modularity).toBe(0);
  });

  it('handles empty graph', () => {
    const graph = buildDependencyGraph([], []);
    const result = detectCommunities(graph);

    expect(result.communityCount).toBe(0);
    expect(result.communities).toHaveLength(0);
    expect(result.modularity).toBe(0);
  });
});

// ── calculateGraphMetrics (integration) ─────────────────────────────────

describe('calculateGraphMetrics', () => {
  it('returns all sections populated for a realistic graph', () => {
    const entities = [
      entity('auth-service'),
      entity('user-repo'),
      entity('user-model'),
      entity('db-client'),
      entity('config'),
      entity('logger'),
      entity('api-handler'),
      entity('middleware'),
    ];
    const rels = [
      // auth depends on user stuff (potential cycle)
      rel('auth-service', 'user-repo'),
      rel('user-repo', 'user-model'),
      rel('user-model', 'auth-service'), // cycle!
      // db layer
      rel('user-repo', 'db-client'),
      rel('db-client', 'config'),
      // api layer
      rel('api-handler', 'auth-service'),
      rel('api-handler', 'middleware'),
      rel('middleware', 'auth-service'),
      rel('middleware', 'logger'),
      // everyone uses logger
      rel('auth-service', 'logger'),
      rel('user-repo', 'logger'),
      rel('db-client', 'logger'),
    ];

    const result = calculateGraphMetrics(entities, rels);

    // Cycles: auth-service → user-repo → user-model → auth-service
    expect(result.cycles.cycleCount).toBe(1);
    expect(result.cycles.largestCycleSize).toBe(3);
    expect(result.cycles.cycles[0].entityIds).toEqual(
      expect.arrayContaining(['auth-service', 'user-repo', 'user-model']),
    );

    // Centrality: all nodes should have a value
    expect(result.centrality).toHaveLength(8);
    for (const c of result.centrality) {
      expect(c.betweennessCentrality).toBeGreaterThanOrEqual(0);
      expect(c.betweennessCentrality).toBeLessThanOrEqual(1);
    }

    // PageRank: logger and auth-service should rank high (many incoming edges)
    expect(result.pageRank).toHaveLength(8);
    const loggerRank = result.pageRank.find(
      (r) => r.entityId === 'logger',
    )!.pageRank;
    const configRank = result.pageRank.find(
      (r) => r.entityId === 'config',
    )!.pageRank;
    expect(loggerRank).toBeGreaterThan(configRank);

    // Communities: should find at least 1 community
    expect(result.communities.communityCount).toBeGreaterThanOrEqual(1);
    const totalInCommunities = result.communities.communities.reduce(
      (sum, c) => sum + c.size,
      0,
    );
    expect(totalInCommunities).toBe(8);

    // PageRank values should sum to approximately 1
    const prSum = result.pageRank.reduce((s, r) => s + r.pageRank, 0);
    expect(prSum).toBeCloseTo(1, 1);
  });

  it('handles a graph with no relationships', () => {
    const entities = [entity('A'), entity('B')];
    const result = calculateGraphMetrics(entities, []);

    expect(result.cycles.cycleCount).toBe(0);
    expect(result.centrality).toHaveLength(2);
    expect(result.pageRank).toHaveLength(2);
    expect(result.communities.communityCount).toBe(2);
  });

  it('handles empty inputs', () => {
    const result = calculateGraphMetrics([], []);

    expect(result.cycles.cycleCount).toBe(0);
    expect(result.centrality).toHaveLength(0);
    expect(result.pageRank).toHaveLength(0);
    expect(result.communities.communityCount).toBe(0);
  });
});
