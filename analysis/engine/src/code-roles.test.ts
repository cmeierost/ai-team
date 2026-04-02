import { describe, it, expect } from 'vitest';
import type { Entity, Relationship } from '@aspect/contracts';
import { classifyCodeRoles } from './code-roles.js';
import type { CodeRoleOptions } from './code-roles.js';

// ── Factories ───────────────────────────────────────────────────────────

function fileEntity(id: string, filePath: string, overrides?: Partial<Entity>): Entity {
  return {
    id,
    kind: 'file',
    name: filePath.split('/').pop()!,
    filePath,
    language: 'typescript',
    sourceRange: { startLine: 1, startColumn: 0, endLine: 50, endColumn: 0 },
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

function childEntity(
  id: string,
  filePath: string,
  kind: Entity['kind'],
  parentEntityId: string,
): Entity {
  return {
    id,
    kind,
    name: id,
    filePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 10, endColumn: 0 },
    classification: {
      isAbstract: false,
      isInterface: kind === 'interface',
      isConcrete: kind !== 'interface' && kind !== 'type-alias',
      isTypeOnly: kind === 'interface' || kind === 'type-alias',
      isExported: true,
      visibility: 'public',
    },
    parentEntityId,
  } as Entity;
}

function rel(
  src: string,
  tgt: string,
  opts?: { typeOnly?: boolean; thirdParty?: boolean },
): Relationship {
  return {
    sourceEntityId: src,
    targetEntityId: tgt,
    kind: 'import',
    crossModule: false,
    crossPackage: false,
    thirdParty: opts?.thirdParty ?? false,
    typeOnly: opts?.typeOnly ?? false,
    targetClassification: 'concrete',
    targetIsAbstraction: false,
    dynamic: false,
    consumedMembers: null,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 30 },
  } as Relationship;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('classifyCodeRoles', () => {
  it('classifies utility: high fan-in, low fan-out, utility path', () => {
    const utils = fileEntity('utils', 'src/utils/format.ts');
    const a = fileEntity('a', 'src/a.ts');
    const b = fileEntity('b', 'src/b.ts');
    const c = fileEntity('c', 'src/c.ts');
    const d = fileEntity('d', 'src/d.ts');
    const e = fileEntity('e', 'src/e.ts');
    const f = fileEntity('f', 'src/f.ts');

    const entities = [utils, a, b, c, d, e, f];
    const relationships = [
      rel('a', 'utils'),
      rel('b', 'utils'),
      rel('c', 'utils'),
      rel('d', 'utils'),
      rel('e', 'utils'),
      rel('f', 'utils'),
      rel('utils', 'a'), // one fan-out to stay within threshold
    ];

    const result = classifyCodeRoles(entities, relationships);

    const utilClass = result.classifications.find((c) => c.entityId === 'utils');
    expect(utilClass).toBeDefined();
    expect(utilClass!.role).toBe('utility');
    expect(utilClass!.confidence).toBeGreaterThan(0);
    expect(result.summary.utility).toBeGreaterThanOrEqual(1);
  });

  it('classifies contract: type-only imports, "types" path', () => {
    const types = fileEntity('types', 'src/types/index.ts');
    const a = fileEntity('a', 'src/a.ts');
    const b = fileEntity('b', 'src/b.ts');
    const c = fileEntity('c', 'src/c.ts');

    const entities = [types, a, b, c];
    const relationships = [
      rel('a', 'types', { typeOnly: true }),
      rel('b', 'types', { typeOnly: true }),
      rel('c', 'types', { typeOnly: true }),
    ];

    const result = classifyCodeRoles(entities, relationships);

    const typesClass = result.classifications.find((c) => c.entityId === 'types');
    expect(typesClass).toBeDefined();
    expect(typesClass!.role).toBe('contract');
  });

  it('classifies contract via .d.ts extension', () => {
    const decl = fileEntity('decl', 'src/global.d.ts');

    const result = classifyCodeRoles([decl], []);

    const declClass = result.classifications.find((c) => c.entityId === 'decl');
    expect(declClass).toBeDefined();
    expect(declClass!.role).toBe('contract');
    expect(declClass!.signals.some((s) => s.signal === 'declaration-file')).toBe(true);
  });

  it('classifies business_logic as default for moderate coupling', () => {
    const svc = fileEntity('svc', 'src/services/order-service.ts');
    const a = fileEntity('a', 'src/a.ts');
    const b = fileEntity('b', 'src/b.ts');
    const c = fileEntity('c', 'src/c.ts');

    const entities = [svc, a, b, c];
    const relationships = [
      rel('a', 'svc'),
      rel('b', 'svc'),
      rel('svc', 'a'),
      rel('svc', 'b'),
      rel('svc', 'c'),
    ];

    const result = classifyCodeRoles(entities, relationships);

    const svcClass = result.classifications.find((c) => c.entityId === 'svc');
    expect(svcClass).toBeDefined();
    expect(svcClass!.role).toBe('business_logic');
  });

  it('classifies presentation: component path', () => {
    const comp = fileEntity('comp', 'src/components/Button.tsx');

    const result = classifyCodeRoles([comp], []);

    const compClass = result.classifications.find((c) => c.entityId === 'comp');
    expect(compClass).toBeDefined();
    expect(compClass!.role).toBe('presentation');
  });

  it('classifies presentation: view path', () => {
    const view = fileEntity('view', 'src/views/Dashboard.tsx');

    const result = classifyCodeRoles([view], []);

    const viewClass = result.classifications.find((c) => c.entityId === 'view');
    expect(viewClass).toBeDefined();
    expect(viewClass!.role).toBe('presentation');
  });

  it('detects contract violations: contract importing business_logic', () => {
    // "types" file is a contract; "svc" is business_logic
    const types = fileEntity('types', 'src/types/models.d.ts');
    const svc = fileEntity('svc', 'src/services/order.ts');
    const a = fileEntity('a', 'src/a.ts');
    const b = fileEntity('b', 'src/b.ts');

    const entities = [types, svc, a, b];
    const relationships = [
      // incoming type-only to types → contract
      rel('a', 'types', { typeOnly: true }),
      rel('b', 'types', { typeOnly: true }),
      // types imports svc (bad!)
      rel('types', 'svc'),
      // svc has moderate coupling → business_logic
      rel('a', 'svc'),
      rel('svc', 'a'),
      rel('svc', 'b'),
    ];

    const result = classifyCodeRoles(entities, relationships);

    expect(result.contractViolations.length).toBeGreaterThanOrEqual(1);
    const violation = result.contractViolations.find((v) => v.entityId === 'types');
    expect(violation).toBeDefined();
    expect(violation!.implementationImports).toContain('src/services/order.ts');
  });

  it('detects overloaded business_logic (god-object risk)', () => {
    // Create a business_logic file with fan-in >= 10
    const god = fileEntity('god', 'src/services/mega-service.ts');
    const files: Entity[] = [god];
    const rels: Relationship[] = [];

    for (let i = 0; i < 12; i++) {
      const f = fileEntity(`f${i}`, `src/modules/mod${i}.ts`);
      files.push(f);
      rels.push(rel(`f${i}`, 'god'));
      // Give god some fan-out for business_logic classification
      rels.push(rel('god', `f${i}`));
    }

    const result = classifyCodeRoles(files, rels, { overloadedFanInThreshold: 10 });

    const godClass = result.classifications.find((c) => c.entityId === 'god');
    expect(godClass).toBeDefined();
    // Should be business_logic (moderate coupling, no special name)
    expect(godClass!.role).toBe('business_logic');

    expect(result.overloadedBusinessLogic.length).toBeGreaterThanOrEqual(1);
    const overloaded = result.overloadedBusinessLogic.find((o) => o.entityId === 'god');
    expect(overloaded).toBeDefined();
    expect(overloaded!.fanIn).toBeGreaterThanOrEqual(10);
  });

  it('classifies unknown when no signals are strong enough', () => {
    // A file with no imports, no importers, generic name, no child entities
    const lonely = fileEntity('lonely', 'src/something/foo.ts');

    // Lower default business_logic baseline won't reach 0.3
    // Actually default baseline is 0.15 which is < 0.3
    const result = classifyCodeRoles([lonely], []);

    const lonelyClass = result.classifications.find((c) => c.entityId === 'lonely');
    expect(lonelyClass).toBeDefined();
    expect(lonelyClass!.role).toBe('unknown');
    expect(result.summary.unknown).toBe(1);
  });

  it('returns empty results for empty input', () => {
    const result = classifyCodeRoles([], []);

    expect(result.classifications).toEqual([]);
    expect(result.summary).toEqual({
      utility: 0,
      contract: 0,
      business_logic: 0,
      presentation: 0,
      unknown: 0,
    });
    expect(result.contractViolations).toEqual([]);
    expect(result.overloadedBusinessLogic).toEqual([]);
  });

  it('filters out node_modules and bare-name entities', () => {
    const internal = fileEntity('internal', 'src/index.ts');
    const external = fileEntity('ext', 'node_modules/lodash/index.ts');
    const bare = fileEntity('bare', 'lodash'); // bare specifier, no /

    const entities = [internal, external, bare];
    const result = classifyCodeRoles(entities, []);

    // Only the internal file should be classified
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].entityId).toBe('internal');
  });

  it('uses child entity kinds for contract classification', () => {
    const typesFile = fileEntity('types-file', 'src/models.ts');
    const iface1 = childEntity('iface1', 'src/models.ts', 'interface', 'types-file');
    const iface2 = childEntity('iface2', 'src/models.ts', 'interface', 'types-file');
    const typeAlias = childEntity('alias1', 'src/models.ts', 'type-alias', 'types-file');

    const entities = [typesFile, iface1, iface2, typeAlias];
    // Give it some incoming type-only imports to strengthen the signal
    const a = fileEntity('a', 'src/a.ts');
    const b = fileEntity('b', 'src/b.ts');
    entities.push(a, b);

    const relationships = [
      rel('a', 'types-file', { typeOnly: true }),
      rel('b', 'types-file', { typeOnly: true }),
    ];

    const result = classifyCodeRoles(entities, relationships);

    const cls = result.classifications.find((c) => c.entityId === 'types-file');
    expect(cls).toBeDefined();
    expect(cls!.role).toBe('contract');
    expect(cls!.signals.some((s) => s.signal === 'mostly-type-entities')).toBe(true);
  });

  it('respects custom option thresholds', () => {
    // With very low utility fan-in threshold, a file with 2 importers qualifies
    const helper = fileEntity('helper', 'src/helpers/calc.ts');
    const a = fileEntity('a', 'src/a.ts');
    const b = fileEntity('b', 'src/b.ts');

    const opts: CodeRoleOptions = {
      utilityFanInThreshold: 2,
      utilityMaxFanOut: 5,
    };

    const result = classifyCodeRoles(
      [helper, a, b],
      [rel('a', 'helper'), rel('b', 'helper')],
      opts,
    );

    const cls = result.classifications.find((c) => c.entityId === 'helper');
    expect(cls).toBeDefined();
    expect(cls!.role).toBe('utility');
  });

  it('normalizes backslash paths to forward slashes in output', () => {
    const f = fileEntity('f', 'src\\components\\Button.tsx');

    const result = classifyCodeRoles([f], []);

    const cls = result.classifications.find((c) => c.entityId === 'f');
    expect(cls).toBeDefined();
    expect(cls!.filePath).toBe('src/components/Button.tsx');
    expect(cls!.filePath).not.toContain('\\');
  });

  it('skips third-party relationships when computing metrics', () => {
    const internal = fileEntity('internal', 'src/index.ts');
    const lib = fileEntity('lib', 'node_modules/lib/index.ts');

    const entities = [internal, lib];
    const relationships = [
      rel('internal', 'lib', { thirdParty: true }),
    ];

    const result = classifyCodeRoles(entities, relationships);

    // Only the internal file should be classified, and the third-party
    // relationship shouldn't inflate its fan-out
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].entityId).toBe('internal');
  });
});
