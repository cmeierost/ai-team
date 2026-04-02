import { describe, it, expect } from 'vitest';
import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';
import type { AnalysisResult } from '../orchestrator.js';
import type { CollectedData } from './types.js';
import { toDot } from './dot.js';

// ── Mock factories ──────────────────────────────────────────────────────

function mockEntity(overrides: Partial<Entity> & { id: string; filePath: string }): Entity {
  return {
    kind: 'class',
    name: overrides.id.split('::')[1] ?? overrides.id,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 50, endColumn: 1 },
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: true,
      visibility: 'public',
    },
    ...overrides,
  };
}

function mockRelationship(
  source: string,
  target: string,
  overrides?: Partial<Relationship>,
): Relationship {
  return {
    sourceEntityId: source,
    targetEntityId: target,
    kind: 'import',
    sourceRange: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 30 },
    targetClassification: 'concrete',
    targetIsAbstraction: false,
    crossModule: false,
    crossPackage: false,
    thirdParty: false,
    typeOnly: false,
    dynamic: false,
    ...overrides,
  };
}

function createMockCollectedData(): CollectedData {
  return {
    entities: [
      mockEntity({ id: 'a', filePath: 'src/a.ts' }),
      mockEntity({ id: 'b', filePath: 'src/b.ts' }),
      mockEntity({ id: 'c', filePath: 'src/c.ts' }),
    ],
    relationships: [
      mockRelationship('a', 'b'),
      mockRelationship('b', 'c', { crossModule: true }),
      mockRelationship('c', 'a'),
    ],
    moduleBoundaries: [
      { moduleId: 'mod-a', modulePath: 'src/', files: ['src/a.ts', 'src/b.ts'], declaredLayer: null, isPackage: false },
      { moduleId: 'mod-b', modulePath: 'lib/', files: ['src/c.ts'], declaredLayer: null, isPackage: false },
    ],
  };
}

function createMockResult(): AnalysisResult {
  return {
    complexity: {
      cyclomatic: [
        { entityId: 'a', cyclomaticComplexity: 5 },
        { entityId: 'b', cyclomaticComplexity: 15 },
        { entityId: 'c', cyclomaticComplexity: 3 },
      ],
      cognitive: [],
      halstead: [],
      fileSummaries: [],
    },
    coupling: {
      entities: [
        { entityId: 'a', afferentCoupling: 1, efferentCoupling: 2, instability: 0.67, totalCoupling: 3 },
        { entityId: 'b', afferentCoupling: 2, efferentCoupling: 5, instability: 0.71, totalCoupling: 7 },
      ],
      moduleDependencyMatrix: {
        moduleIds: ['mod-a', 'mod-b'],
        matrix: [[0, 1], [1, 0]],
        crossModuleEdgeCount: 2,
      },
      moduleCohesion: [],
    },
    graph: {
      cycles: {
        cycleCount: 1,
        largestCycleSize: 3,
        totalEntitiesInCycles: 3,
        cycles: [{ id: 'c1', entityIds: ['a', 'b', 'c'], size: 3 }],
      },
      centrality: [],
      pageRank: [
        { entityId: 'a', pageRank: 0.4 },
        { entityId: 'b', pageRank: 0.35 },
        { entityId: 'c', pageRank: 0.25 },
      ],
      communities: {
        communityCount: 2,
        communities: [
          { id: 'comm-0', entityIds: ['a', 'b'], size: 2 },
          { id: 'comm-1', entityIds: ['c'], size: 1 },
        ],
        modularity: 0.3,
      },
    },
    summary: {
      entityCount: 3,
      relationshipCount: 3,
      moduleCount: 2,
      maxCyclomaticComplexity: 15,
      avgCyclomaticComplexity: 7.67,
      cycleCount: 1,
      communityCount: 2,
      overallDuplicationPercentage: 0,
      mostComplexEntities: [],
      mostCoupledEntities: [],
      worstSrpEntities: [],
      modulesInZoneOfPain: [],
      modulesInZoneOfUselessness: [],
    },
    timing: { totalMs: 10, perCalculator: {} },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('toDot', () => {
  it('produces valid DOT with digraph keyword and rankdir', () => {
    const dot = toDot(createMockResult(), createMockCollectedData());

    expect(dot).toContain('digraph dependencies {');
    expect(dot).toContain('rankdir=LR');
    expect(dot).toContain('}');
  });

  it('highlights cycle edges in red', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      highlightCycles: true,
    });

    // a→b and b→c are cycle edges; c→a wraps around
    expect(dot).toContain('color=red');
    expect(dot).toContain('penwidth=2');
  });

  it('renders module-level graph with module IDs as nodes', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      graphType: 'module',
    });

    expect(dot).toContain('"mod-a"');
    expect(dot).toContain('"mod-b"');
    // Module-level graph should use module IDs, not entity IDs
    expect(dot).not.toContain('"a"');
  });

  it('produces valid empty digraph for empty input', () => {
    const emptyResult: AnalysisResult = {
      summary: {
        entityCount: 0, relationshipCount: 0, moduleCount: 0,
        maxCyclomaticComplexity: 0, avgCyclomaticComplexity: 0,
        cycleCount: 0, communityCount: 0, overallDuplicationPercentage: 0,
        mostComplexEntities: [], mostCoupledEntities: [], worstSrpEntities: [],
        modulesInZoneOfPain: [], modulesInZoneOfUselessness: [],
      },
      timing: { totalMs: 0, perCalculator: {} },
    };
    const emptyData: CollectedData = { entities: [], relationships: [], moduleBoundaries: [] };

    const dot = toDot(emptyResult, emptyData);

    expect(dot).toContain('digraph dependencies {');
    expect(dot).toContain('}');
    expect(dot.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('filters to cross-module edges only when crossModuleOnly is set', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      crossModuleOnly: true,
      highlightCycles: false,
    });

    // Only the b→c edge is crossModule
    const edgeLines = dot.split('\n').filter((l) => l.includes('->'));
    expect(edgeLines).toHaveLength(1);
    expect(edgeLines[0]).toContain('"b"');
    expect(edgeLines[0]).toContain('"c"');
  });

  it('colours nodes by community when enabled', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      colorByCommunity: true,
    });

    expect(dot).toContain('style=filled');
    expect(dot).toContain('fillcolor=');
  });

  it('scales node size by complexity metric', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      sizeByMetric: 'complexity',
    });

    expect(dot).toContain('width=');
    expect(dot).toContain('height=');
  });

  it('scales node size by coupling metric', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      sizeByMetric: 'coupling',
    });

    expect(dot).toContain('width=');
    expect(dot).toContain('height=');
  });

  it('scales node size by pageRank metric', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      sizeByMetric: 'pageRank',
    });

    expect(dot).toContain('width=');
    expect(dot).toContain('height=');
  });

  it('skips edges where source or target node is not in entities', () => {
    const data = createMockCollectedData();
    data.relationships.push(
      mockRelationship('nonexistent', 'a'),
      mockRelationship('b', 'nonexistent'),
    );

    const dot = toDot(createMockResult(), data, { highlightCycles: false });

    // Only the 3 original edges (between existing nodes) should appear
    const edgeLines = dot.split('\n').filter((l) => l.includes('->'));
    expect(edgeLines).toHaveLength(3);
  });

  it('does not highlight cycles when highlightCycles is false', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      highlightCycles: false,
    });

    expect(dot).not.toContain('color=red');
    expect(dot).not.toContain('penwidth=2');
  });

  it('renders module graph with coupling matrix edges', () => {
    const dot = toDot(createMockResult(), createMockCollectedData(), {
      graphType: 'module',
    });

    // Module graph should have edges from coupling matrix
    expect(dot).toContain('->');
    // Matrix has [0,1],[1,0] so mod-a -> mod-b and mod-b -> mod-a
    const edgeLines = dot.split('\n').filter((l) => l.includes('->'));
    expect(edgeLines).toHaveLength(2);
  });

  it('renders empty module graph without coupling data', () => {
    const result = createMockResult();
    delete (result as Record<string, unknown>).coupling;

    const dot = toDot(result, createMockCollectedData(), { graphType: 'module' });

    expect(dot).toContain('digraph dependencies {');
    expect(dot).toContain('}');
    const edgeLines = dot.split('\n').filter((l) => l.includes('->'));
    expect(edgeLines).toHaveLength(0);
  });
});
