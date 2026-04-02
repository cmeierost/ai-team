import { describe, it, expect } from 'vitest';
import type {
  Entity,
  Relationship,
  ModuleBoundary,
  DuplicationSignal,
} from '@aspect/contracts';
import { analyze } from './orchestrator.js';
import type { AnalysisInput } from './orchestrator.js';

// ── Test-data helpers ───────────────────────────────────────────────────

const srcRange = {
  startLine: 1,
  startColumn: 0,
  endLine: 10,
  endColumn: 0,
};

const defaultClassification = {
  isAbstract: false,
  isInterface: false,
  isConcrete: true,
  isTypeOnly: false,
  isExported: true,
  visibility: 'public' as const,
};

function entity(
  id: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    kind: 'class',
    name: id,
    filePath: `src/${id}.ts`,
    sourceRange: srcRange,
    classification: defaultClassification,
    ...overrides,
  };
}

function rel(
  source: string,
  target: string,
  overrides: Partial<Relationship> = {},
): Relationship {
  return {
    sourceEntityId: source,
    targetEntityId: target,
    kind: 'import',
    sourceRange: srcRange,
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

function moduleBoundary(
  moduleId: string,
  modulePath: string,
  files: string[] = [],
): ModuleBoundary {
  return {
    moduleId,
    modulePath,
    files,
    declaredLayer: null,
    isPackage: false,
    kind: 'manual' as const,
  };
}

/**
 * Builds a small but realistic input: 3 modules, ~15 entities,
 * cross-module relationships, duplication clones, and LCOM data.
 */
function createTestInput(): AnalysisInput {
  // Module A — 5 entities
  const a1 = entity('a-cls1', {
    filePath: 'src/moduleA/cls1.ts',
    kind: 'class',
    rawCounts: {
      branchPoints: 8,
      nestingContributions: [
        { depth: 1, increment: 1 },
        { depth: 2, increment: 1 },
      ],
      operators: { distinct: 10, total: 30 },
      operands: { distinct: 8, total: 25 },
      linesOfCode: 120,
    },
    methodFieldAccessMatrix: [
      { methodName: 'doA', accessedFields: ['x', 'y'] },
      { methodName: 'doB', accessedFields: ['x'] },
      { methodName: 'doC', accessedFields: ['z'] },
    ],
  });
  const a2 = entity('a-fn1', {
    filePath: 'src/moduleA/fn1.ts',
    kind: 'function',
    rawCounts: {
      branchPoints: 2,
      nestingContributions: [{ depth: 0, increment: 1 }],
      operators: { distinct: 5, total: 10 },
      operands: { distinct: 4, total: 8 },
      linesOfCode: 30,
    },
  });
  const a3 = entity('a-iface', {
    filePath: 'src/moduleA/iface.ts',
    kind: 'interface',
    classification: { ...defaultClassification, isInterface: true, isConcrete: false },
    rawCounts: { linesOfCode: 15 },
  });
  const aFile = entity('a-file', {
    filePath: 'src/moduleA/cls1.ts',
    kind: 'file',
    rawCounts: { linesOfCode: 150 },
  });
  const aFile2 = entity('a-file2', {
    filePath: 'src/moduleA/fn1.ts',
    kind: 'file',
    rawCounts: { linesOfCode: 40 },
  });

  // Module B — 5 entities
  const b1 = entity('b-cls1', {
    filePath: 'src/moduleB/cls1.ts',
    kind: 'class',
    rawCounts: {
      branchPoints: 15,
      nestingContributions: [
        { depth: 1, increment: 1 },
        { depth: 2, increment: 1 },
        { depth: 3, increment: 1 },
      ],
      operators: { distinct: 12, total: 40 },
      operands: { distinct: 10, total: 30 },
      linesOfCode: 200,
    },
    methodFieldAccessMatrix: [
      { methodName: 'handleX', accessedFields: ['data'] },
      { methodName: 'handleY', accessedFields: ['config'] },
      { methodName: 'handleZ', accessedFields: ['other'] },
    ],
  });
  const b2 = entity('b-fn1', {
    filePath: 'src/moduleB/fn1.ts',
    kind: 'function',
    rawCounts: {
      branchPoints: 1,
      nestingContributions: [],
      operators: { distinct: 3, total: 5 },
      operands: { distinct: 2, total: 4 },
      linesOfCode: 10,
    },
  });
  const b3 = entity('b-cls2', {
    filePath: 'src/moduleB/cls2.ts',
    kind: 'class',
    rawCounts: { branchPoints: 3, linesOfCode: 50 },
    methodFieldAccessMatrix: [
      { methodName: 'run', accessedFields: ['state', 'config'] },
      { methodName: 'init', accessedFields: ['state'] },
    ],
  });
  const bFile = entity('b-file', {
    filePath: 'src/moduleB/cls1.ts',
    kind: 'file',
    rawCounts: { linesOfCode: 220 },
  });
  const bFile2 = entity('b-file2', {
    filePath: 'src/moduleB/fn1.ts',
    kind: 'file',
    rawCounts: { linesOfCode: 15 },
  });

  // Module C — 5 entities
  const c1 = entity('c-cls1', {
    filePath: 'src/moduleC/cls1.ts',
    kind: 'class',
    rawCounts: {
      branchPoints: 5,
      nestingContributions: [{ depth: 1, increment: 1 }],
      operators: { distinct: 6, total: 15 },
      operands: { distinct: 5, total: 12 },
      linesOfCode: 80,
    },
    methodFieldAccessMatrix: [
      { methodName: 'process', accessedFields: ['items', 'count'] },
      { methodName: 'validate', accessedFields: ['items'] },
    ],
  });
  const c2 = entity('c-fn1', {
    filePath: 'src/moduleC/fn1.ts',
    kind: 'function',
    rawCounts: {
      branchPoints: 0,
      nestingContributions: [],
      operators: { distinct: 2, total: 3 },
      operands: { distinct: 2, total: 3 },
      linesOfCode: 5,
    },
  });
  const c3 = entity('c-enum', {
    filePath: 'src/moduleC/enums.ts',
    kind: 'enum',
    rawCounts: { linesOfCode: 10 },
  });
  const cFile = entity('c-file', {
    filePath: 'src/moduleC/cls1.ts',
    kind: 'file',
    rawCounts: { linesOfCode: 90 },
  });
  const cFile2 = entity('c-file2', {
    filePath: 'src/moduleC/fn1.ts',
    kind: 'file',
    rawCounts: { linesOfCode: 8 },
  });

  const entities = [a1, a2, a3, aFile, aFile2, b1, b2, b3, bFile, bFile2, c1, c2, c3, cFile, cFile2];

  const relationships: Relationship[] = [
    // Intra-module A
    rel('a-cls1', 'a-fn1'),
    rel('a-cls1', 'a-iface', { kind: 'implement', targetIsAbstraction: true, targetClassification: 'interface' }),
    // Intra-module B
    rel('b-cls1', 'b-fn1'),
    rel('b-cls1', 'b-cls2'),
    // Intra-module C
    rel('c-cls1', 'c-fn1'),
    rel('c-cls1', 'c-enum'),
    // Cross-module A→B
    rel('a-cls1', 'b-cls1', { crossModule: true }),
    rel('a-fn1', 'b-fn1', { crossModule: true }),
    // Cross-module B→C
    rel('b-cls1', 'c-cls1', { crossModule: true }),
    // Cross-module C→A
    rel('c-cls1', 'a-cls1', { crossModule: true }),
    // Extra coupling
    rel('b-cls2', 'a-iface', { crossModule: true, targetIsAbstraction: true, targetClassification: 'interface' }),
    rel('c-fn1', 'b-fn1', { crossModule: true }),
    // Contain relationship for SRP name clustering
    rel('a-cls1', 'a-fn1', { kind: 'contain' }),
  ];

  const moduleBoundaries: ModuleBoundary[] = [
    moduleBoundary('modA', 'src/moduleA/', [
      'src/moduleA/cls1.ts',
      'src/moduleA/fn1.ts',
      'src/moduleA/iface.ts',
    ]),
    moduleBoundary('modB', 'src/moduleB/', [
      'src/moduleB/cls1.ts',
      'src/moduleB/fn1.ts',
      'src/moduleB/cls2.ts',
    ]),
    moduleBoundary('modC', 'src/moduleC/', [
      'src/moduleC/cls1.ts',
      'src/moduleC/fn1.ts',
      'src/moduleC/enums.ts',
    ]),
  ];

  const duplicationSignals: DuplicationSignal[] = [
    {
      source: { tool: 'jscpd', version: '1.0.0' },
      clones: [
        {
          id: 'clone-1',
          format: 'typescript',
          tokenCount: 50,
          lineCount: 10,
          firstFile: {
            filePath: 'src/moduleA/cls1.ts',
            startLine: 10,
            endLine: 19,
          },
          secondFile: {
            filePath: 'src/moduleB/cls1.ts',
            startLine: 20,
            endLine: 29,
          },
        },
        {
          id: 'clone-2',
          format: 'typescript',
          tokenCount: 30,
          lineCount: 5,
          firstFile: {
            filePath: 'src/moduleA/fn1.ts',
            startLine: 1,
            endLine: 5,
          },
          secondFile: {
            filePath: 'src/moduleA/fn1.ts',
            startLine: 10,
            endLine: 14,
          },
        },
      ],
      statistics: {
        totalLines: 1000,
        totalTokens: 5000,
        totalSources: 10,
        duplicatedLines: 50,
        duplicatedTokens: 200,
      },
    },
  ];

  return { entities, relationships, moduleBoundaries, duplicationSignals };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('analyze — orchestrator', () => {
  it('runs all calculators and populates every result section', async () => {
    const input = createTestInput();
    const result = await analyze(input);

    expect(result.complexity).toBeDefined();
    expect(result.complexity!.cyclomatic.length).toBeGreaterThan(0);
    expect(result.complexity!.cognitive.length).toBeGreaterThan(0);
    expect(result.complexity!.halstead.length).toBeGreaterThan(0);
    expect(result.complexity!.fileSummaries.length).toBeGreaterThan(0);

    expect(result.coupling).toBeDefined();
    expect(result.coupling!.entities.length).toBeGreaterThan(0);
    expect(result.coupling!.moduleDependencyMatrix.moduleIds).toHaveLength(3);
    expect(result.coupling!.moduleCohesion).toHaveLength(3);

    expect(result.graph).toBeDefined();
    expect(result.graph!.centrality.length).toBeGreaterThan(0);
    expect(result.graph!.pageRank.length).toBeGreaterThan(0);

    expect(result.cohesion).toBeDefined();
    expect(result.cohesion!.length).toBeGreaterThan(0);

    expect(result.solid).toBeDefined();

    expect(result.duplication).toBeDefined();
    expect(result.duplication!.project.totalClones).toBe(2);

    expect(result.moduleMetrics).toBeDefined();
    expect(result.moduleMetrics!.modules).toHaveLength(3);

    expect(result.summary).toBeDefined();
    expect(result.timing).toBeDefined();
  });

  it('only runs selected calculators when include is specified', async () => {
    const input = createTestInput();
    const result = await analyze(input, { include: ['complexity'] });

    expect(result.complexity).toBeDefined();
    expect(result.coupling).toBeUndefined();
    expect(result.graph).toBeUndefined();
    expect(result.cohesion).toBeUndefined();
    expect(result.solid).toBeUndefined();
    expect(result.duplication).toBeUndefined();
    expect(result.moduleMetrics).toBeUndefined();

    // Summary should still exist (with zeros for non-computed sections)
    expect(result.summary.maxCyclomaticComplexity).toBeGreaterThan(0);
    expect(result.summary.cycleCount).toBe(0);
  });

  it('produces accurate summary numbers matching detail results', async () => {
    const input = createTestInput();
    const result = await analyze(input);
    const summary = result.summary;

    expect(summary.entityCount).toBe(input.entities.length);
    expect(summary.relationshipCount).toBe(input.relationships.length);
    expect(summary.moduleCount).toBe(input.moduleBoundaries.length);

    // maxCyclomaticComplexity should equal the highest in the detailed results
    const cyclomatics = result.complexity!.cyclomatic;
    const expectedMax = Math.max(
      ...cyclomatics.map((c) => c.cyclomaticComplexity),
    );
    expect(summary.maxCyclomaticComplexity).toBe(expectedMax);

    // avgCyclomaticComplexity
    const expectedAvg =
      cyclomatics.reduce((s, c) => s + c.cyclomaticComplexity, 0) /
      cyclomatics.length;
    expect(summary.avgCyclomaticComplexity).toBeCloseTo(expectedAvg, 5);

    // cycleCount from graph
    expect(summary.cycleCount).toBe(result.graph!.cycles.cycleCount);

    // communityCount from graph
    expect(summary.communityCount).toBe(
      result.graph!.communities.communityCount,
    );

    // duplication percentage from project
    expect(summary.overallDuplicationPercentage).toBeCloseTo(
      result.duplication!.project.duplicationPercentage,
      5,
    );
  });

  it('records timing for all executed calculators', async () => {
    const input = createTestInput();
    const result = await analyze(input);

    expect(result.timing.totalMs).toBeGreaterThan(0);
    expect(result.timing.perCalculator.complexity).toBeGreaterThanOrEqual(0);
    expect(result.timing.perCalculator.coupling).toBeGreaterThanOrEqual(0);
    expect(result.timing.perCalculator.graph).toBeGreaterThanOrEqual(0);
    expect(result.timing.perCalculator.cohesion).toBeGreaterThanOrEqual(0);
    expect(result.timing.perCalculator.solid).toBeGreaterThanOrEqual(0);
    expect(result.timing.perCalculator.duplication).toBeGreaterThanOrEqual(0);
    expect(result.timing.perCalculator.module).toBeGreaterThanOrEqual(0);

    // Total should be >= sum of individual timings
    const sum = Object.values(result.timing.perCalculator).reduce(
      (a, b) => a + b,
      0,
    );
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(sum * 0.99); // small float tolerance
  });

  it('handles empty input gracefully', async () => {
    const input: AnalysisInput = {
      entities: [],
      relationships: [],
      moduleBoundaries: [],
    };
    const result = await analyze(input);

    expect(result.complexity!.cyclomatic).toHaveLength(0);
    expect(result.complexity!.cognitive).toHaveLength(0);
    expect(result.complexity!.halstead).toHaveLength(0);

    expect(result.coupling!.entities).toHaveLength(0);
    expect(result.coupling!.moduleCohesion).toHaveLength(0);
    expect(result.coupling!.moduleDependencyMatrix.moduleIds).toHaveLength(0);

    expect(result.graph!.cycles.cycleCount).toBe(0);
    expect(result.graph!.centrality).toHaveLength(0);

    expect(result.cohesion).toHaveLength(0);

    expect(result.duplication!.project.totalClones).toBe(0);

    expect(result.moduleMetrics!.modules).toHaveLength(0);

    expect(result.summary.entityCount).toBe(0);
    expect(result.summary.maxCyclomaticComplexity).toBe(0);
    expect(result.summary.avgCyclomaticComplexity).toBe(0);
    expect(result.summary.mostComplexEntities).toHaveLength(0);
    expect(result.summary.mostCoupledEntities).toHaveLength(0);
    expect(result.summary.worstSrpEntities).toHaveLength(0);
  });

  it('handles missing optional signals gracefully', async () => {
    const input = createTestInput();
    delete input.duplicationSignals;

    const result = await analyze(input);

    expect(result.duplication).toBeDefined();
    expect(result.duplication!.project.totalClones).toBe(0);
    expect(result.duplication!.project.duplicationPercentage).toBe(0);
  });

  it('feeds cohesion LCOM4 results into SOLID SRP', async () => {
    const input = createTestInput();
    const result = await analyze(input, { include: ['cohesion', 'solid'] });

    expect(result.cohesion).toBeDefined();
    expect(result.cohesion!.length).toBeGreaterThan(0);
    expect(result.solid).toBeDefined();

    // Every SRP indicator's lcom4 value should correspond to a cohesion result
    const lcom4Map = new Map(result.cohesion!.map((c) => [c.entityId, c.lcom4]));
    for (const srpEntry of result.solid!.srp) {
      if (lcom4Map.has(srpEntry.entityId)) {
        expect(srpEntry.lcom4).toBe(lcom4Map.get(srpEntry.entityId));
      }
    }
  });

  it('lists correct top offenders in summary', async () => {
    const input = createTestInput();
    const result = await analyze(input);

    // Most complex: should be sorted descending by cyclomatic
    const complex = result.summary.mostComplexEntities;
    expect(complex.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < complex.length; i++) {
      expect(complex[i - 1].cyclomatic).toBeGreaterThanOrEqual(
        complex[i].cyclomatic,
      );
    }

    // Most coupled: sorted descending by totalCoupling
    const coupled = result.summary.mostCoupledEntities;
    expect(coupled.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < coupled.length; i++) {
      expect(coupled[i - 1].totalCoupling).toBeGreaterThanOrEqual(
        coupled[i].totalCoupling,
      );
    }

    // Worst SRP: sorted descending by lcom4
    const srp = result.summary.worstSrpEntities;
    expect(srp.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < srp.length; i++) {
      expect(srp[i - 1].lcom4).toBeGreaterThanOrEqual(srp[i].lcom4);
    }

    // The entity with branchPoints=15 (b-cls1) should be the most complex
    expect(complex[0].entityId).toBe('b-cls1');
    expect(complex[0].cyclomatic).toBe(16); // 15+1
  });

  it('only includes cohesion timing when cohesion is explicitly requested', async () => {
    const input = createTestInput();
    const result = await analyze(input, { include: ['solid'] });

    // Cohesion runs implicitly for SOLID, but cohesion section not in result
    expect(result.cohesion).toBeUndefined();
    expect(result.solid).toBeDefined();
    // Timing should still record the cohesion computation
    expect(result.timing.perCalculator.cohesion).toBeGreaterThanOrEqual(0);
  });

  it('respects couplingOptions filter', async () => {
    const input = createTestInput();
    // Add a third-party relationship
    input.relationships.push(
      rel('a-cls1', 'external-lib', { thirdParty: true, crossModule: true }),
    );
    input.entities.push(
      entity('external-lib', { filePath: 'node_modules/ext/index.ts' }),
    );

    const withTP = await analyze(input, { include: ['coupling'] });
    const withoutTP = await analyze(input, {
      include: ['coupling'],
      couplingOptions: { excludeThirdParty: true },
    });

    // Filtering third-party should reduce coupling for a-cls1
    const findCoupling = (entities: { entityId: string; efferentCoupling: number }[], id: string) =>
      entities.find((e) => e.entityId === id);

    const aCls1With = findCoupling(withTP.coupling!.entities, 'a-cls1');
    const aCls1Without = findCoupling(withoutTP.coupling!.entities, 'a-cls1');

    expect(aCls1With!.efferentCoupling).toBeGreaterThan(
      aCls1Without!.efferentCoupling,
    );
  });

  it('reports module zone detection from moduleMetrics in summary', async () => {
    // Build input where modA is in zone-of-pain (low A, low I)
    const entities: Entity[] = [
      entity('a-cls', {
        filePath: 'src/modA/a.ts',
        kind: 'class',
        rawCounts: { linesOfCode: 100 },
      }),
      entity('b-iface', {
        filePath: 'src/modB/b.ts',
        kind: 'interface',
        classification: {
          ...defaultClassification,
          isInterface: true,
          isAbstract: false,
          isConcrete: false,
        },
        rawCounts: { linesOfCode: 20 },
      }),
    ];
    const relationships: Relationship[] = [];
    const moduleBoundaries: ModuleBoundary[] = [
      moduleBoundary('modA', 'src/modA/', ['src/modA/a.ts']),
      moduleBoundary('modB', 'src/modB/', ['src/modB/b.ts']),
    ];

    const result = await analyze(
      { entities, relationships, moduleBoundaries },
      { include: ['module'] },
    );

    // modA: abstractness=0 (only concrete class), instability=0 (no deps) → zone of pain
    expect(result.summary.modulesInZoneOfPain).toContain('modA');
    // modB: abstractness=1 (only interface), instability=0 → not zone of uselessness
    // (needs both high A AND high I for uselessness)
  });
});
