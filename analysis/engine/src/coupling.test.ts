import { describe, it, expect } from 'vitest';
import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';
import {
  calculateCoupling,
  calculateModuleDependencyMatrix,
  calculateModuleCohesion,
} from './coupling.js';
import type { CouplingResult } from './coupling.js';

// ── Test-data helpers ───────────────────────────────────────────────────

function entity(id: string, filePath = `src/${id}.ts`): Entity {
  return {
    id,
    kind: 'file',
    name: id,
    filePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 10, endColumn: 0 },
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: true,
      visibility: 'public',
    },
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
    sourceRange: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 20 },
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
  return { moduleId, modulePath, files, declaredLayer: null, isPackage: false, kind: 'manual' as const };
}

function findResult(results: CouplingResult[], id: string): CouplingResult {
  const r = results.find((c) => c.entityId === id);
  if (!r) throw new Error(`No coupling result for entity "${id}"`);
  return r;
}

// ── Afferent / Efferent Tests ───────────────────────────────────────────

describe('calculateCoupling', () => {
  it('handles a simple linear chain A→B→C', () => {
    const entities = [entity('A'), entity('B'), entity('C')];
    const rels = [rel('A', 'B'), rel('B', 'C')];
    const results = calculateCoupling(entities, rels);

    const a = findResult(results, 'A');
    expect(a.afferentCoupling).toBe(0);
    expect(a.efferentCoupling).toBe(1);
    expect(a.instability).toBe(1); // Ce/(Ca+Ce)=1/1

    const b = findResult(results, 'B');
    expect(b.afferentCoupling).toBe(1);
    expect(b.efferentCoupling).toBe(1);
    expect(b.instability).toBeCloseTo(0.5);

    const c = findResult(results, 'C');
    expect(c.afferentCoupling).toBe(1);
    expect(c.efferentCoupling).toBe(0);
    expect(c.instability).toBe(0);
  });

  it('handles a hub pattern A→B, A→C, A→D', () => {
    const entities = [entity('A'), entity('B'), entity('C'), entity('D')];
    const rels = [rel('A', 'B'), rel('A', 'C'), rel('A', 'D')];
    const results = calculateCoupling(entities, rels);

    expect(findResult(results, 'A').efferentCoupling).toBe(3);
    expect(findResult(results, 'B').afferentCoupling).toBe(1);
    expect(findResult(results, 'C').afferentCoupling).toBe(1);
    expect(findResult(results, 'D').afferentCoupling).toBe(1);
  });

  it('handles fan-in B→A, C→A, D→A', () => {
    const entities = [entity('A'), entity('B'), entity('C'), entity('D')];
    const rels = [rel('B', 'A'), rel('C', 'A'), rel('D', 'A')];
    const results = calculateCoupling(entities, rels);

    expect(findResult(results, 'A').afferentCoupling).toBe(3);
    expect(findResult(results, 'A').efferentCoupling).toBe(0);
  });

  it('excludes self-references', () => {
    const entities = [entity('A'), entity('B')];
    const rels = [rel('A', 'A'), rel('A', 'B')];
    const results = calculateCoupling(entities, rels);

    const a = findResult(results, 'A');
    expect(a.afferentCoupling).toBe(0);
    expect(a.efferentCoupling).toBe(1);
  });

  it('returns zeros for no relationships', () => {
    const entities = [entity('A'), entity('B')];
    const results = calculateCoupling(entities, []);

    for (const r of results) {
      expect(r.afferentCoupling).toBe(0);
      expect(r.efferentCoupling).toBe(0);
      expect(r.instability).toBe(0);
      expect(r.totalCoupling).toBe(0);
    }
  });

  it('returns empty array for empty inputs', () => {
    expect(calculateCoupling([], [])).toEqual([]);
  });
});

// ── Instability Tests ───────────────────────────────────────────────────

describe('instability', () => {
  it('pure stable: Ca=5, Ce=0 → I=0', () => {
    const entities = [entity('A'), entity('B'), entity('C'), entity('D'), entity('E'), entity('F')];
    // 5 entities pointing at A
    const rels = [rel('B', 'A'), rel('C', 'A'), rel('D', 'A'), rel('E', 'A'), rel('F', 'A')];
    const a = findResult(calculateCoupling(entities, rels), 'A');
    expect(a.afferentCoupling).toBe(5);
    expect(a.efferentCoupling).toBe(0);
    expect(a.instability).toBe(0);
  });

  it('pure unstable: Ca=0, Ce=5 → I=1', () => {
    const entities = [entity('A'), entity('B'), entity('C'), entity('D'), entity('E'), entity('F')];
    const rels = [rel('A', 'B'), rel('A', 'C'), rel('A', 'D'), rel('A', 'E'), rel('A', 'F')];
    const a = findResult(calculateCoupling(entities, rels), 'A');
    expect(a.afferentCoupling).toBe(0);
    expect(a.efferentCoupling).toBe(5);
    expect(a.instability).toBe(1);
  });

  it('balanced: Ca=3, Ce=3 → I=0.5', () => {
    const entities = [entity('A'), entity('B'), entity('C'), entity('D'), entity('E'), entity('F'), entity('G')];
    const rels = [
      rel('B', 'A'), rel('C', 'A'), rel('D', 'A'), // Ca=3
      rel('A', 'E'), rel('A', 'F'), rel('A', 'G'), // Ce=3
    ];
    const a = findResult(calculateCoupling(entities, rels), 'A');
    expect(a.instability).toBeCloseTo(0.5);
  });

  it('isolated entity: Ca=0, Ce=0 → I=0 (not NaN)', () => {
    const entities = [entity('A')];
    const a = findResult(calculateCoupling(entities, []), 'A');
    expect(a.instability).toBe(0);
    expect(Number.isNaN(a.instability)).toBe(false);
  });
});

// ── Module Dependency Matrix Tests ──────────────────────────────────────

describe('calculateModuleDependencyMatrix', () => {
  it('two modules, one-way deps', () => {
    const mb = [
      moduleBoundary('modA', 'src/a/'),
      moduleBoundary('modB', 'src/b/'),
    ];
    const entities = [
      entity('e1', 'src/a/foo.ts'),
      entity('e2', 'src/a/bar.ts'),
      entity('e3', 'src/a/baz.ts'),
      entity('e4', 'src/b/qux.ts'),
    ];
    const rels = [
      rel('e1', 'e4', { crossModule: true }),
      rel('e2', 'e4', { crossModule: true }),
      rel('e3', 'e4', { crossModule: true }),
    ];

    const result = calculateModuleDependencyMatrix(rels, mb, entities);
    expect(result.moduleIds).toEqual(['modA', 'modB']);
    expect(result.matrix[0][1]).toBe(3); // modA → modB
    expect(result.matrix[1][0]).toBe(0); // modB → modA
    expect(result.crossModuleEdgeCount).toBe(3);
  });

  it('three modules, bidirectional', () => {
    const mb = [
      moduleBoundary('modA', 'src/a/'),
      moduleBoundary('modB', 'src/b/'),
      moduleBoundary('modC', 'src/c/'),
    ];
    const entities = [
      entity('a1', 'src/a/a1.ts'),
      entity('b1', 'src/b/b1.ts'),
      entity('c1', 'src/c/c1.ts'),
    ];
    const rels = [
      rel('a1', 'b1'), // A→B
      rel('b1', 'a1'), // B→A
      rel('a1', 'c1'), // A→C
      rel('c1', 'b1'), // C→B
    ];

    const result = calculateModuleDependencyMatrix(rels, mb, entities);
    expect(result.matrix[0][1]).toBe(1); // A→B
    expect(result.matrix[1][0]).toBe(1); // B→A
    expect(result.matrix[0][2]).toBe(1); // A→C
    expect(result.matrix[2][1]).toBe(1); // C→B
    expect(result.matrix[1][2]).toBe(0); // B→C
    expect(result.matrix[2][0]).toBe(0); // C→A
    expect(result.crossModuleEdgeCount).toBe(4);
  });

  it('no cross-module deps: all zeros', () => {
    const mb = [
      moduleBoundary('modA', 'src/a/'),
      moduleBoundary('modB', 'src/b/'),
    ];
    const entities = [
      entity('a1', 'src/a/a1.ts'),
      entity('a2', 'src/a/a2.ts'),
    ];
    const rels = [rel('a1', 'a2')]; // intra-module

    const result = calculateModuleDependencyMatrix(rels, mb, entities);
    expect(result.matrix[0][1]).toBe(0);
    expect(result.matrix[1][0]).toBe(0);
    expect(result.crossModuleEdgeCount).toBe(0);
  });

  it('entity not in any module is ignored', () => {
    const mb = [moduleBoundary('modA', 'src/a/')];
    const entities = [
      entity('a1', 'src/a/a1.ts'),
      entity('orphan', 'lib/orphan.ts'),
    ];
    const rels = [rel('a1', 'orphan')];

    const result = calculateModuleDependencyMatrix(rels, mb, entities);
    expect(result.crossModuleEdgeCount).toBe(0);
  });
});

// ── Module Cohesion Tests ───────────────────────────────────────────────

describe('calculateModuleCohesion', () => {
  it('high cohesion module: many internal, few external', () => {
    const mb = [
      moduleBoundary('modA', 'src/a/'),
      moduleBoundary('modB', 'src/b/'),
    ];
    const entities = [
      entity('a1', 'src/a/a1.ts'),
      entity('a2', 'src/a/a2.ts'),
      entity('a3', 'src/a/a3.ts'),
      entity('b1', 'src/b/b1.ts'),
    ];
    const rels = [
      rel('a1', 'a2'), // internal
      rel('a2', 'a3'), // internal
      rel('a3', 'a1'), // internal
      rel('a1', 'b1'), // external
    ];

    const results = calculateModuleCohesion(rels, mb, entities);
    const modA = results.find((r) => r.moduleId === 'modA')!;
    expect(modA.internalEdges).toBe(3);
    expect(modA.externalEdges).toBe(1);
    expect(modA.cohesionRatio).toBeCloseTo(0.75);
  });

  it('low cohesion module: few internal, many external', () => {
    const mb = [
      moduleBoundary('modA', 'src/a/'),
      moduleBoundary('modB', 'src/b/'),
    ];
    const entities = [
      entity('a1', 'src/a/a1.ts'),
      entity('a2', 'src/a/a2.ts'),
      entity('b1', 'src/b/b1.ts'),
      entity('b2', 'src/b/b2.ts'),
      entity('b3', 'src/b/b3.ts'),
    ];
    const rels = [
      rel('a1', 'a2'), // internal
      rel('a1', 'b1'), // external
      rel('a1', 'b2'), // external
      rel('a2', 'b3'), // external
    ];

    const results = calculateModuleCohesion(rels, mb, entities);
    const modA = results.find((r) => r.moduleId === 'modA')!;
    expect(modA.internalEdges).toBe(1);
    expect(modA.externalEdges).toBe(3);
    expect(modA.cohesionRatio).toBeCloseTo(0.25);
  });

  it('module with no edges: ratio = 0', () => {
    const mb = [moduleBoundary('modA', 'src/a/')];
    const entities = [entity('a1', 'src/a/a1.ts')];

    const results = calculateModuleCohesion([], mb, entities);
    const modA = results.find((r) => r.moduleId === 'modA')!;
    expect(modA.internalEdges).toBe(0);
    expect(modA.externalEdges).toBe(0);
    expect(modA.cohesionRatio).toBe(0);
  });
});

// ── Filter Tests ────────────────────────────────────────────────────────

describe('coupling filters', () => {
  it('excludeThirdParty: third-party edges not counted', () => {
    const entities = [entity('A'), entity('B')];
    const rels = [
      rel('A', 'B', { thirdParty: true }),
      rel('A', 'B'),
    ];

    const withTP = calculateCoupling(entities, rels);
    expect(findResult(withTP, 'A').efferentCoupling).toBe(2);

    const withoutTP = calculateCoupling(entities, rels, { excludeThirdParty: true });
    expect(findResult(withoutTP, 'A').efferentCoupling).toBe(1);
  });

  it('excludeTypeOnly: type-only edges not counted', () => {
    const entities = [entity('A'), entity('B')];
    const rels = [
      rel('A', 'B', { typeOnly: true }),
      rel('A', 'B'),
    ];

    const withTO = calculateCoupling(entities, rels);
    expect(findResult(withTO, 'A').efferentCoupling).toBe(2);

    const withoutTO = calculateCoupling(entities, rels, { excludeTypeOnly: true });
    expect(findResult(withoutTO, 'A').efferentCoupling).toBe(1);
  });

  it('excludeDynamic: dynamic edges not counted', () => {
    const entities = [entity('A'), entity('B')];
    const rels = [
      rel('A', 'B', { dynamic: true }),
      rel('A', 'B'),
    ];

    const withDyn = calculateCoupling(entities, rels);
    expect(findResult(withDyn, 'A').efferentCoupling).toBe(2);

    const withoutDyn = calculateCoupling(entities, rels, { excludeDynamic: true });
    expect(findResult(withoutDyn, 'A').efferentCoupling).toBe(1);
  });

  it('filters apply to module dependency matrix', () => {
    const mb = [
      moduleBoundary('modA', 'src/a/'),
      moduleBoundary('modB', 'src/b/'),
    ];
    const entities = [
      entity('a1', 'src/a/a1.ts'),
      entity('b1', 'src/b/b1.ts'),
    ];
    const rels = [
      rel('a1', 'b1', { thirdParty: true }),
      rel('a1', 'b1'),
    ];

    const withTP = calculateModuleDependencyMatrix(rels, mb, entities);
    expect(withTP.crossModuleEdgeCount).toBe(2);

    const withoutTP = calculateModuleDependencyMatrix(rels, mb, entities, {
      excludeThirdParty: true,
    });
    expect(withoutTP.crossModuleEdgeCount).toBe(1);
  });

  it('filters apply to module cohesion', () => {
    const mb = [
      moduleBoundary('modA', 'src/a/'),
      moduleBoundary('modB', 'src/b/'),
    ];
    const entities = [
      entity('a1', 'src/a/a1.ts'),
      entity('a2', 'src/a/a2.ts'),
      entity('b1', 'src/b/b1.ts'),
    ];
    const rels = [
      rel('a1', 'a2'),                         // internal, not typeOnly
      rel('a1', 'b1', { typeOnly: true }),      // external, typeOnly
    ];

    const withTO = calculateModuleCohesion(rels, mb, entities);
    const modAWith = withTO.find((r) => r.moduleId === 'modA')!;
    expect(modAWith.externalEdges).toBe(1);

    const withoutTO = calculateModuleCohesion(rels, mb, entities, { excludeTypeOnly: true });
    const modAWithout = withoutTO.find((r) => r.moduleId === 'modA')!;
    expect(modAWithout.externalEdges).toBe(0);
  });
});

// ── Integration Test ────────────────────────────────────────────────────

describe('integration: realistic graph', () => {
  it('10 entities, 20 relationships, 3 modules', () => {
    // Modules: core (src/core/), api (src/api/), ui (src/ui/)
    const mb = [
      moduleBoundary('core', 'src/core/'),
      moduleBoundary('api', 'src/api/'),
      moduleBoundary('ui', 'src/ui/'),
    ];

    const entities = [
      entity('c1', 'src/core/model.ts'),
      entity('c2', 'src/core/utils.ts'),
      entity('c3', 'src/core/types.ts'),
      entity('a1', 'src/api/handler.ts'),
      entity('a2', 'src/api/router.ts'),
      entity('a3', 'src/api/middleware.ts'),
      entity('u1', 'src/ui/app.ts'),
      entity('u2', 'src/ui/page.ts'),
      entity('u3', 'src/ui/widget.ts'),
      entity('u4', 'src/ui/layout.ts'),
    ];

    const rels: Relationship[] = [
      // Core internal (3)
      rel('c1', 'c2'),
      rel('c1', 'c3'),
      rel('c2', 'c3'),

      // API internal (2)
      rel('a1', 'a2'),
      rel('a2', 'a3'),

      // UI internal (4)
      rel('u1', 'u2'),
      rel('u1', 'u3'),
      rel('u2', 'u4'),
      rel('u3', 'u4'),

      // API → Core (3)
      rel('a1', 'c1'),
      rel('a2', 'c2'),
      rel('a3', 'c3'),

      // UI → Core (3)
      rel('u1', 'c1'),
      rel('u2', 'c2'),
      rel('u3', 'c3'),

      // UI → API (3)
      rel('u1', 'a1'),
      rel('u2', 'a2'),
      rel('u3', 'a3'),

      // Core → API (1, back-edge)
      rel('c1', 'a1'),

      // Self-reference (excluded)
      rel('c1', 'c1'),
    ];

    // ── Verify coupling for c1 ──
    const couplingResults = calculateCoupling(entities, rels);
    const c1 = findResult(couplingResults, 'c1');
    // Ca(c1): a1→c1, u1→c1 = 2
    // Ce(c1): c1→c2, c1→c3, c1→a1 = 3 (self-ref excluded)
    expect(c1.afferentCoupling).toBe(2);
    expect(c1.efferentCoupling).toBe(3);
    expect(c1.instability).toBeCloseTo(0.6); // 3/5

    // u4 is a pure sink: only incoming
    const u4 = findResult(couplingResults, 'u4');
    expect(u4.afferentCoupling).toBe(2); // u2→u4, u3→u4
    expect(u4.efferentCoupling).toBe(0);
    expect(u4.instability).toBe(0);

    // ── Verify module dependency matrix ──
    const mdm = calculateModuleDependencyMatrix(rels, mb, entities);
    expect(mdm.moduleIds).toEqual(['core', 'api', 'ui']);

    // core→api = 1 (c1→a1)
    expect(mdm.matrix[0][1]).toBe(1);
    // core→ui = 0
    expect(mdm.matrix[0][2]).toBe(0);
    // api→core = 3
    expect(mdm.matrix[1][0]).toBe(3);
    // api→ui = 0
    expect(mdm.matrix[1][2]).toBe(0);
    // ui→core = 3
    expect(mdm.matrix[2][0]).toBe(3);
    // ui→api = 3
    expect(mdm.matrix[2][1]).toBe(3);

    // Total cross-module = 1+3+3+3 = 10
    expect(mdm.crossModuleEdgeCount).toBe(10);

    // ── Verify module cohesion ──
    const cohesion = calculateModuleCohesion(rels, mb, entities);
    const coreCoh = cohesion.find((c) => c.moduleId === 'core')!;
    // Core internal: c1→c2, c1→c3, c2→c3 = 3
    // Core external outgoing: c1→a1 = 1
    // Core external incoming: a1→c1, a2→c2, a3→c3, u1→c1, u2→c2, u3→c3 = 6
    expect(coreCoh.internalEdges).toBe(3);
    expect(coreCoh.externalEdges).toBe(7); // 1 outgoing + 6 incoming
    expect(coreCoh.cohesionRatio).toBeCloseTo(0.3); // 3/10
  });
});
