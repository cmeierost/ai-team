import { describe, it, expect } from 'vitest';
import type {
  Entity,
  Relationship,
  ModuleBoundary,
  SourceRange,
} from '@aspect/contracts';
import { calculateModuleMetrics } from './module-metrics.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEFAULT_RANGE: SourceRange = {
  startLine: 1,
  startColumn: 0,
  endLine: 1,
  endColumn: 0,
};

function makeEntity(opts: {
  id: string;
  kind: Entity['kind'];
  filePath: string;
  isAbstract?: boolean;
  isInterface?: boolean;
  linesOfCode?: number;
}): Entity {
  const isAbstract = opts.isAbstract ?? false;
  const isInterface = opts.isInterface ?? false;
  return {
    id: opts.id,
    kind: opts.kind,
    name: opts.id,
    filePath: opts.filePath,
    sourceRange: DEFAULT_RANGE,
    classification: {
      isAbstract,
      isInterface,
      isConcrete: !isAbstract && !isInterface,
      isTypeOnly: false,
      isExported: true,
      visibility: 'public',
    },
    ...(opts.linesOfCode != null
      ? { rawCounts: { linesOfCode: opts.linesOfCode } }
      : {}),
  };
}

function makeRelationship(
  sourceEntityId: string,
  targetEntityId: string,
  overrides?: { thirdParty?: boolean },
): Relationship {
  return {
    sourceEntityId,
    targetEntityId,
    kind: 'import',
    sourceRange: DEFAULT_RANGE,
    targetClassification: 'concrete',
    targetIsAbstraction: false,
    crossModule: true,
    crossPackage: false,
    thirdParty: overrides?.thirdParty ?? false,
    typeOnly: false,
    dynamic: false,
  };
}

function makeModuleBoundary(
  moduleId: string,
  modulePath: string,
  files: string[] = [],
): ModuleBoundary {
  return { moduleId, modulePath, files, declaredLayer: null, isPackage: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculateModuleMetrics', () => {
  // ------ Test 9 ------
  it('calculates abstractness of 1 for a pure abstract module', () => {
    const entities = [
      makeEntity({ id: 'i1', kind: 'interface', filePath: 'src/mod/a.ts', isInterface: true }),
      makeEntity({ id: 'i2', kind: 'interface', filePath: 'src/mod/b.ts', isInterface: true }),
    ];
    const boundaries = [makeModuleBoundary('mod', 'src/mod/')];
    const result = calculateModuleMetrics(entities, [], boundaries);

    expect(result.modules[0].abstractness).toBe(1);
  });

  // ------ Test 10 ------
  it('calculates abstractness of 0 for a pure concrete module', () => {
    const entities = [
      makeEntity({ id: 'c1', kind: 'class', filePath: 'src/mod/a.ts' }),
      makeEntity({ id: 'c2', kind: 'class', filePath: 'src/mod/b.ts' }),
    ];
    const boundaries = [makeModuleBoundary('mod', 'src/mod/')];
    const result = calculateModuleMetrics(entities, [], boundaries);

    expect(result.modules[0].abstractness).toBe(0);
  });

  // ------ Test 11 ------
  it('calculates abstractness for a mixed module', () => {
    const entities = [
      makeEntity({ id: 'i1', kind: 'interface', filePath: 'src/mod/a.ts', isInterface: true }),
      makeEntity({ id: 'i2', kind: 'interface', filePath: 'src/mod/b.ts', isInterface: true }),
      makeEntity({ id: 'c1', kind: 'class', filePath: 'src/mod/c.ts' }),
      makeEntity({ id: 'c2', kind: 'class', filePath: 'src/mod/d.ts' }),
      makeEntity({ id: 'c3', kind: 'class', filePath: 'src/mod/e.ts' }),
    ];
    const boundaries = [makeModuleBoundary('mod', 'src/mod/')];
    const result = calculateModuleMetrics(entities, [], boundaries);

    expect(result.modules[0].abstractness).toBeCloseTo(0.4); // 2/5
  });

  // ------ Test 12 ------
  it('calculates low instability for a stable module', () => {
    const entities = [
      makeEntity({ id: 'a1', kind: 'class', filePath: 'src/modA/a.ts' }),
      makeEntity({ id: 'b1', kind: 'class', filePath: 'src/modB/b1.ts' }),
      makeEntity({ id: 'b2', kind: 'class', filePath: 'src/modB/b2.ts' }),
      makeEntity({ id: 'b3', kind: 'class', filePath: 'src/modB/b3.ts' }),
      makeEntity({ id: 'b4', kind: 'class', filePath: 'src/modB/b4.ts' }),
      makeEntity({ id: 'b5', kind: 'class', filePath: 'src/modB/b5.ts' }),
      makeEntity({ id: 'c1', kind: 'class', filePath: 'src/modC/c.ts' }),
    ];
    const boundaries = [
      makeModuleBoundary('modA', 'src/modA/'),
      makeModuleBoundary('modB', 'src/modB/'),
      makeModuleBoundary('modC', 'src/modC/'),
    ];
    const relationships = [
      // 5 incoming to modA from modB
      makeRelationship('b1', 'a1'),
      makeRelationship('b2', 'a1'),
      makeRelationship('b3', 'a1'),
      makeRelationship('b4', 'a1'),
      makeRelationship('b5', 'a1'),
      // 1 outgoing from modA to modC
      makeRelationship('a1', 'c1'),
    ];
    const result = calculateModuleMetrics(entities, relationships, boundaries);

    const modA = result.modules.find((m) => m.moduleId === 'modA')!;
    expect(modA.afferentCoupling).toBe(5);
    expect(modA.efferentCoupling).toBe(1);
    expect(modA.instability).toBeCloseTo(1 / 6); // Ce/(Ca+Ce) = 1/6
  });

  // ------ Test 13 ------
  it('calculates high instability for an unstable module', () => {
    const entities = [
      makeEntity({ id: 'a1', kind: 'class', filePath: 'src/modA/a.ts' }),
      makeEntity({ id: 'b1', kind: 'class', filePath: 'src/modB/b1.ts' }),
      makeEntity({ id: 'b2', kind: 'class', filePath: 'src/modB/b2.ts' }),
      makeEntity({ id: 'b3', kind: 'class', filePath: 'src/modB/b3.ts' }),
      makeEntity({ id: 'b4', kind: 'class', filePath: 'src/modB/b4.ts' }),
      makeEntity({ id: 'b5', kind: 'class', filePath: 'src/modB/b5.ts' }),
    ];
    const boundaries = [
      makeModuleBoundary('modA', 'src/modA/'),
      makeModuleBoundary('modB', 'src/modB/'),
    ];
    const relationships = [
      // 5 outgoing from modA, 0 incoming
      makeRelationship('a1', 'b1'),
      makeRelationship('a1', 'b2'),
      makeRelationship('a1', 'b3'),
      makeRelationship('a1', 'b4'),
      makeRelationship('a1', 'b5'),
    ];
    const result = calculateModuleMetrics(entities, relationships, boundaries);

    const modA = result.modules.find((m) => m.moduleId === 'modA')!;
    expect(modA.afferentCoupling).toBe(0);
    expect(modA.efferentCoupling).toBe(5);
    expect(modA.instability).toBe(1); // 5/(0+5) = 1
  });

  // ------ Test 14 ------
  it('calculates distance of 0 for a module on the main sequence', () => {
    // A=0.5 (1 interface + 1 class), I=0.5 (Ca=1, Ce=1)
    const entities = [
      makeEntity({ id: 'i1', kind: 'interface', filePath: 'src/mod/a.ts', isInterface: true }),
      makeEntity({ id: 'c1', kind: 'class', filePath: 'src/mod/b.ts' }),
      makeEntity({ id: 'ext', kind: 'class', filePath: 'src/other/x.ts' }),
    ];
    const boundaries = [
      makeModuleBoundary('mod', 'src/mod/'),
      makeModuleBoundary('other', 'src/other/'),
    ];
    const relationships = [
      makeRelationship('ext', 'c1'), // Ca for mod
      makeRelationship('c1', 'ext'), // Ce for mod
    ];
    const result = calculateModuleMetrics(entities, relationships, boundaries);

    const mod = result.modules.find((m) => m.moduleId === 'mod')!;
    expect(mod.abstractness).toBe(0.5);
    expect(mod.instability).toBe(0.5);
    expect(mod.distanceFromMainSequence).toBeCloseTo(0);
  });

  // ------ Test 15 ------
  it('detects zone of pain (low abstractness, low instability)', () => {
    // A=0 (all concrete), I=0 (only incoming, no outgoing)
    const entities = [
      makeEntity({ id: 'c1', kind: 'class', filePath: 'src/pain/a.ts' }),
      makeEntity({ id: 'ext', kind: 'class', filePath: 'src/ext/x.ts' }),
    ];
    const boundaries = [
      makeModuleBoundary('pain', 'src/pain/'),
      makeModuleBoundary('ext', 'src/ext/'),
    ];
    const relationships = [
      makeRelationship('ext', 'c1'), // Ca for pain = 1, Ce = 0
    ];
    const result = calculateModuleMetrics(entities, relationships, boundaries);

    const pain = result.modules.find((m) => m.moduleId === 'pain')!;
    expect(pain.abstractness).toBe(0);
    expect(pain.instability).toBe(0);
    expect(result.zoneOfPain).toContain('pain');
    expect(result.zoneOfUselessness).not.toContain('pain');
  });

  // ------ Test 16 ------
  it('detects zone of uselessness (high abstractness, high instability)', () => {
    // A=1 (all interfaces), I=1 (only outgoing, no incoming)
    const entities = [
      makeEntity({ id: 'i1', kind: 'interface', filePath: 'src/useless/a.ts', isInterface: true }),
      makeEntity({ id: 'ext', kind: 'class', filePath: 'src/ext/x.ts' }),
    ];
    const boundaries = [
      makeModuleBoundary('useless', 'src/useless/'),
      makeModuleBoundary('ext', 'src/ext/'),
    ];
    const relationships = [
      makeRelationship('i1', 'ext'), // Ce for useless = 1, Ca = 0
    ];
    const result = calculateModuleMetrics(entities, relationships, boundaries);

    const useless = result.modules.find((m) => m.moduleId === 'useless')!;
    expect(useless.abstractness).toBe(1);
    expect(useless.instability).toBe(1);
    expect(result.zoneOfUselessness).toContain('useless');
    expect(result.zoneOfPain).not.toContain('useless');
  });

  // ------ Test 17 ------
  it('handles empty modules with zero entities', () => {
    const boundaries = [makeModuleBoundary('empty', 'src/empty/')];
    const result = calculateModuleMetrics([], [], boundaries);

    const mod = result.modules[0];
    expect(mod.abstractness).toBe(0);
    expect(mod.instability).toBe(0);
    expect(mod.distanceFromMainSequence).toBe(1); // |0 + 0 - 1| = 1
    expect(mod.size.entityCount).toBe(0);
    expect(mod.size.fileCount).toBe(0);
    expect(mod.size.totalLoc).toBe(0);
  });

  // ------ Test 18 ------
  it('returns empty results when no module boundaries provided', () => {
    const entities = [
      makeEntity({ id: 'c1', kind: 'class', filePath: 'src/a.ts' }),
    ];
    const result = calculateModuleMetrics(entities, [], []);

    expect(result.modules).toEqual([]);
    expect(result.averageAbstractness).toBe(0);
    expect(result.averageInstability).toBe(0);
    expect(result.averageDistance).toBe(0);
    expect(result.zoneOfPain).toEqual([]);
    expect(result.zoneOfUselessness).toEqual([]);
  });

  // ------ Test 20 (integration) ------
  it('calculates complete metrics for multiple modules', () => {
    const entities = [
      // Module core: 2 interfaces + 1 class → A = 2/3
      makeEntity({ id: 'core-i1', kind: 'interface', filePath: 'src/core/i1.ts', isInterface: true }),
      makeEntity({ id: 'core-i2', kind: 'interface', filePath: 'src/core/i2.ts', isInterface: true }),
      makeEntity({ id: 'core-c1', kind: 'class', filePath: 'src/core/c1.ts' }),
      makeEntity({ id: 'core-f', kind: 'file', filePath: 'src/core/c1.ts', linesOfCode: 100 }),

      // Module api: 0 interfaces + 3 classes → A = 0
      makeEntity({ id: 'api-c1', kind: 'class', filePath: 'src/api/c1.ts' }),
      makeEntity({ id: 'api-c2', kind: 'class', filePath: 'src/api/c2.ts' }),
      makeEntity({ id: 'api-c3', kind: 'class', filePath: 'src/api/c3.ts' }),
      makeEntity({ id: 'api-f1', kind: 'file', filePath: 'src/api/c1.ts', linesOfCode: 50 }),
      makeEntity({ id: 'api-f2', kind: 'file', filePath: 'src/api/c2.ts', linesOfCode: 75 }),
      makeEntity({ id: 'api-f3', kind: 'file', filePath: 'src/api/c3.ts', linesOfCode: 25 }),

      // Module util: 1 interface + 1 class → A = 0.5
      makeEntity({ id: 'util-i1', kind: 'interface', filePath: 'src/util/i1.ts', isInterface: true }),
      makeEntity({ id: 'util-c1', kind: 'class', filePath: 'src/util/c1.ts' }),
      makeEntity({ id: 'util-f', kind: 'file', filePath: 'src/util/c1.ts', linesOfCode: 200 }),
    ];

    const boundaries = [
      makeModuleBoundary('core', 'src/core/'),
      makeModuleBoundary('api', 'src/api/'),
      makeModuleBoundary('util', 'src/util/'),
    ];

    const relationships = [
      // api → core: 3 deps
      makeRelationship('api-c1', 'core-i1'),
      makeRelationship('api-c2', 'core-i2'),
      makeRelationship('api-c3', 'core-c1'),
      // api → util: 1 dep
      makeRelationship('api-c1', 'util-c1'),
      // util → core: 1 dep
      makeRelationship('util-c1', 'core-i1'),
    ];

    const result = calculateModuleMetrics(entities, relationships, boundaries);

    // Core: A = 2/3, Ca = 4, Ce = 0, I = 0, D = |2/3 + 0 − 1| = 1/3
    const core = result.modules.find((m) => m.moduleId === 'core')!;
    expect(core.abstractness).toBeCloseTo(2 / 3);
    expect(core.afferentCoupling).toBe(4);
    expect(core.efferentCoupling).toBe(0);
    expect(core.instability).toBe(0);
    expect(core.distanceFromMainSequence).toBeCloseTo(1 / 3);
    expect(core.size.classCount).toBe(1);
    expect(core.size.interfaceCount).toBe(2);
    expect(core.size.fileCount).toBe(1);

    // API: A = 0, Ca = 0, Ce = 4, I = 1, D = |0 + 1 − 1| = 0
    const api = result.modules.find((m) => m.moduleId === 'api')!;
    expect(api.abstractness).toBe(0);
    expect(api.afferentCoupling).toBe(0);
    expect(api.efferentCoupling).toBe(4);
    expect(api.instability).toBe(1);
    expect(api.distanceFromMainSequence).toBeCloseTo(0);
    expect(api.size.classCount).toBe(3);
    expect(api.size.totalLoc).toBe(150);

    // Util: A = 0.5, Ca = 1, Ce = 1, I = 0.5, D = |0.5 + 0.5 − 1| = 0
    const util = result.modules.find((m) => m.moduleId === 'util')!;
    expect(util.abstractness).toBe(0.5);
    expect(util.afferentCoupling).toBe(1);
    expect(util.efferentCoupling).toBe(1);
    expect(util.instability).toBe(0.5);
    expect(util.distanceFromMainSequence).toBeCloseTo(0);

    // Averages
    expect(result.averageAbstractness).toBeCloseTo((2 / 3 + 0 + 0.5) / 3);
    expect(result.averageInstability).toBeCloseTo((0 + 1 + 0.5) / 3);

    // No module qualifies for either zone
    expect(result.zoneOfPain).toEqual([]);
    expect(result.zoneOfUselessness).toEqual([]);
  });
});
