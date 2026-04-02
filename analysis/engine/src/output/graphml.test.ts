import { describe, it, expect } from 'vitest';
import type { Entity, Relationship } from '@aspect/contracts';
import type { AnalysisResult } from '../orchestrator.js';
import type { CollectedData } from './types.js';
import { toGraphML } from './graphml.js';

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
    ],
    relationships: [
      mockRelationship('a', 'b', { crossModule: true, kind: 'call' }),
    ],
    moduleBoundaries: [],
  };
}

function createMockResult(): AnalysisResult {
  return {
    complexity: {
      cyclomatic: [
        { entityId: 'a', cyclomaticComplexity: 8 },
        { entityId: 'b', cyclomaticComplexity: 3 },
      ],
      cognitive: [],
      halstead: [],
      fileSummaries: [],
    },
    coupling: {
      entities: [
        { entityId: 'a', afferentCoupling: 0, efferentCoupling: 1, instability: 1, totalCoupling: 1 },
        { entityId: 'b', afferentCoupling: 1, efferentCoupling: 0, instability: 0, totalCoupling: 1 },
      ],
      moduleDependencyMatrix: { moduleIds: [], matrix: [], crossModuleEdgeCount: 0 },
      moduleCohesion: [],
    },
    graph: {
      cycles: { cycleCount: 0, largestCycleSize: 0, totalEntitiesInCycles: 0, cycles: [] },
      centrality: [],
      pageRank: [],
      communities: {
        communityCount: 1,
        communities: [{ id: 'comm-0', entityIds: ['a', 'b'], size: 2 }],
        modularity: 0,
      },
    },
    summary: {
      entityCount: 2, relationshipCount: 1, moduleCount: 0,
      maxCyclomaticComplexity: 8, avgCyclomaticComplexity: 5.5,
      cycleCount: 0, communityCount: 1, overallDuplicationPercentage: 0,
      mostComplexEntities: [], mostCoupledEntities: [], worstSrpEntities: [],
      modulesInZoneOfPain: [], modulesInZoneOfUselessness: [],
    },
    timing: { totalMs: 5, perCalculator: {} },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('toGraphML', () => {
  it('produces valid XML with graphml namespace and directed graph', () => {
    const xml = toGraphML(createMockResult(), createMockCollectedData());

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<graphml xmlns="http://graphml.graphstruct.org/graphml">');
    expect(xml).toContain('edgedefault="directed"');
    expect(xml).toContain('</graphml>');
  });

  it('includes node attributes for complexity, coupling, and community', () => {
    const xml = toGraphML(createMockResult(), createMockCollectedData());

    // Key definitions
    expect(xml).toContain('attr.name="complexity"');
    expect(xml).toContain('attr.name="coupling"');
    expect(xml).toContain('attr.name="community"');

    // Node data — entity 'a' has complexity 8
    expect(xml).toContain('<data key="d1">8</data>');
    // Node data — entity 'a' has coupling 1
    expect(xml).toContain('<data key="d2">1</data>');
    // Community assignment
    expect(xml).toContain('<data key="d3">comm-0</data>');
  });

  it('includes edge attributes for crossModule, thirdParty, kind', () => {
    const xml = toGraphML(createMockResult(), createMockCollectedData());

    expect(xml).toContain('<data key="d4">true</data>');   // crossModule
    expect(xml).toContain('<data key="d5">false</data>');   // thirdParty
    expect(xml).toContain('<data key="d6">call</data>');    // kind
  });

  it('produces valid GraphML with empty graph for empty input', () => {
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

    const xml = toGraphML(emptyResult, emptyData);

    expect(xml).toContain('<graphml');
    expect(xml).toContain('<graph id="G"');
    expect(xml).toContain('</graph>');
    expect(xml).toContain('</graphml>');
    expect(xml).not.toContain('<node');
    expect(xml).not.toContain('<edge');
  });

  it('escapes special XML characters in file paths', () => {
    const data: CollectedData = {
      entities: [
        mockEntity({ id: 'x', filePath: 'src/<special>&"file.ts' }),
      ],
      relationships: [],
      moduleBoundaries: [],
    };
    const result: AnalysisResult = {
      summary: {
        entityCount: 1, relationshipCount: 0, moduleCount: 0,
        maxCyclomaticComplexity: 0, avgCyclomaticComplexity: 0,
        cycleCount: 0, communityCount: 0, overallDuplicationPercentage: 0,
        mostComplexEntities: [], mostCoupledEntities: [], worstSrpEntities: [],
        modulesInZoneOfPain: [], modulesInZoneOfUselessness: [],
      },
      timing: { totalMs: 0, perCalculator: {} },
    };

    const xml = toGraphML(result, data);

    expect(xml).toContain('&lt;special&gt;&amp;&quot;file.ts');
    expect(xml).not.toContain('<special>');
  });
});
