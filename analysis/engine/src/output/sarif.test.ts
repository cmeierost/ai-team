import { describe, it, expect } from 'vitest';
import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';
import type { AnalysisResult } from '../orchestrator.js';
import type { CollectedData } from './types.js';
import { toSarif } from './sarif.js';

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

function createMockCollectedData(): CollectedData {
  return {
    entities: [
      mockEntity({ id: 'src/a.ts::Foo', filePath: 'src/a.ts', sourceRange: { startLine: 5, startColumn: 2, endLine: 40, endColumn: 1 } }),
      mockEntity({ id: 'src/b.ts::Bar', filePath: 'src/b.ts' }),
      mockEntity({ id: 'src/c.ts::Baz', filePath: 'src/c.ts', kind: 'function' }),
    ],
    relationships: [],
    moduleBoundaries: [
      { moduleId: 'mod-a', modulePath: 'src/', files: ['src/a.ts', 'src/b.ts'], declaredLayer: null, isPackage: false },
    ],
  };
}

function createMockAnalysisResult(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    complexity: {
      cyclomatic: [
        { entityId: 'src/a.ts::Foo', cyclomaticComplexity: 5 },
        { entityId: 'src/b.ts::Bar', cyclomaticComplexity: 15 },
        { entityId: 'src/c.ts::Baz', cyclomaticComplexity: 3 },
      ],
      cognitive: [],
      halstead: [],
      fileSummaries: [],
    },
    graph: {
      cycles: {
        cycleCount: 1,
        largestCycleSize: 2,
        totalEntitiesInCycles: 2,
        cycles: [{ id: 'c1', entityIds: ['src/a.ts::Foo', 'src/b.ts::Bar'], size: 2 }],
      },
      centrality: [],
      pageRank: [],
      communities: { communityCount: 0, communities: [], modularity: 0 },
    },
    solid: {
      srp: [{ entityId: 'src/b.ts::Bar', lcom4: 3, importSourceDiversity: 0.8, responsibilityGroupCount: 3, nameSemanticClusters: [], srpScore: 0.3 }],
      ocp: [],
      isp: [],
      dip: [{ entityId: 'src/a.ts::Foo', abstractionDependencyRatio: 0.2, concreteDependencyCount: 4, layerViolationCount: 1, dipScore: 0.4 }],
      lsp: [],
    },
    duplication: {
      project: { totalLines: 1000, duplicatedLines: 250, duplicationPercentage: 25, totalClones: 5 },
      files: [
        { filePath: 'src/b.ts', duplicatedLines: 50, totalLines: 100, duplicationPercentage: 50, cloneCount: 3 },
        { filePath: 'src/c.ts', duplicatedLines: 5, totalLines: 50, duplicationPercentage: 10, cloneCount: 1 },
      ],
      crossModule: [],
      hotspots: [],
    },
    coupling: {
      entities: [
        { entityId: 'src/b.ts::Bar', afferentCoupling: 5, efferentCoupling: 8, instability: 0.62, totalCoupling: 13 },
        { entityId: 'src/a.ts::Foo', afferentCoupling: 1, efferentCoupling: 2, instability: 0.67, totalCoupling: 3 },
      ],
      moduleDependencyMatrix: { moduleIds: [], matrix: [], crossModuleEdgeCount: 0 },
      moduleCohesion: [],
    },
    summary: {
      entityCount: 3,
      relationshipCount: 0,
      moduleCount: 1,
      maxCyclomaticComplexity: 15,
      avgCyclomaticComplexity: 7.67,
      cycleCount: 1,
      communityCount: 0,
      overallDuplicationPercentage: 25,
      mostComplexEntities: [],
      mostCoupledEntities: [],
      worstSrpEntities: [],
      modulesInZoneOfPain: ['mod-a'],
      modulesInZoneOfUselessness: [],
    },
    timing: { totalMs: 42, perCalculator: {} },
    ...overrides,
  };
}

function createEmptyAnalysisResult(): AnalysisResult {
  return {
    summary: {
      entityCount: 0,
      relationshipCount: 0,
      moduleCount: 0,
      maxCyclomaticComplexity: 0,
      avgCyclomaticComplexity: 0,
      cycleCount: 0,
      communityCount: 0,
      overallDuplicationPercentage: 0,
      mostComplexEntities: [],
      mostCoupledEntities: [],
      worstSrpEntities: [],
      modulesInZoneOfPain: [],
      modulesInZoneOfUselessness: [],
    },
    timing: { totalMs: 0, perCalculator: {} },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('toSarif', () => {
  it('produces valid SARIF structure with $schema and version', () => {
    const sarif = toSarif(createEmptyAnalysisResult(), createMockCollectedData());

    expect(sarif.$schema).toBe(
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    );
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('@aspect/engine');
    expect(sarif.runs[0].tool.driver.version).toBe('0.1.0');
  });

  it('maps high cyclomatic complexity to warning results', () => {
    const sarif = toSarif(createMockAnalysisResult(), createMockCollectedData());
    const complexityResults = sarif.runs[0].results.filter(
      (r) => r.ruleId === 'aspect/high-cyclomatic-complexity',
    );

    expect(complexityResults).toHaveLength(1);
    expect(complexityResults[0].level).toBe('warning');
    expect(complexityResults[0].message.text).toContain('15');
    expect(complexityResults[0].message.text).toContain('threshold: 10');
  });

  it('maps dependency cycles to error-level results', () => {
    const sarif = toSarif(createMockAnalysisResult(), createMockCollectedData());
    const cycleResults = sarif.runs[0].results.filter(
      (r) => r.ruleId === 'aspect/dependency-cycle',
    );

    expect(cycleResults).toHaveLength(1);
    expect(cycleResults[0].level).toBe('error');
    expect(cycleResults[0].message.text).toContain('size 2');
  });

  it('produces valid SARIF with no results for empty analysis', () => {
    const sarif = toSarif(
      createEmptyAnalysisResult(),
      { entities: [], relationships: [], moduleBoundaries: [] },
    );

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results).toHaveLength(0);
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(0);
  });

  it('maps entity filePath and sourceRange to SARIF physicalLocation', () => {
    const sarif = toSarif(createMockAnalysisResult(), createMockCollectedData());
    const dipResults = sarif.runs[0].results.filter(
      (r) => r.ruleId === 'aspect/low-dip',
    );

    expect(dipResults).toHaveLength(1);
    const loc = dipResults[0].locations[0];
    expect(loc.physicalLocation.artifactLocation.uri).toBe('src/a.ts');
    // sourceRange.startColumn is 0-based; SARIF is 1-based
    expect(loc.physicalLocation.region.startLine).toBe(5);
    expect(loc.physicalLocation.region.startColumn).toBe(3);
  });

  it('includes low-srp and high-duplication rules', () => {
    const sarif = toSarif(createMockAnalysisResult(), createMockCollectedData());
    const ruleIds = sarif.runs[0].results.map((r) => r.ruleId);

    expect(ruleIds).toContain('aspect/low-srp');
    expect(ruleIds).toContain('aspect/high-duplication');
  });

  it('includes zone-of-pain and high-coupling rules', () => {
    const sarif = toSarif(createMockAnalysisResult(), createMockCollectedData());
    const ruleIds = sarif.runs[0].results.map((r) => r.ruleId);

    expect(ruleIds).toContain('aspect/zone-of-pain');
    expect(ruleIds).toContain('aspect/high-coupling');
  });

  it('respects custom tool name and version', () => {
    const sarif = toSarif(
      createEmptyAnalysisResult(),
      createMockCollectedData(),
      { toolName: 'my-tool', toolVersion: '2.0.0' },
    );

    expect(sarif.runs[0].tool.driver.name).toBe('my-tool');
    expect(sarif.runs[0].tool.driver.version).toBe('2.0.0');
  });
});
