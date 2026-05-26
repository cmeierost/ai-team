import { describe, it, expect } from 'vitest';
import { computeHierarchySummary } from './hierarchy-analysis.js';
import type { Entity } from '@aspect/contracts';

function makeEntity(overrides: Partial<Entity> & { id: string; kind: Entity['kind']; name: string }): Entity {
  return {
    filePath: overrides.filePath ?? 'src/test.ts',
    sourceRange: { startLine: 1, startColumn: 0, endLine: 10, endColumn: 0 },
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'member',
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: false,
      visibility: null,
    },
    ...overrides,
  };
}

describe('computeHierarchySummary', () => {
  it('returns empty summary for no entities', () => {
    const result = computeHierarchySummary([]);
    expect(result.totalHierarchicalEntities).toBe(0);
    expect(result.maxDepth).toBe(0);
    expect(result.containerCount).toBe(0);
    expect(result.leafCount).toBe(0);
    expect(result.perFile).toHaveLength(0);
  });

  it('counts containers and leaves correctly', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'f1', kind: 'file', name: 'test.ts', filePath: 'src/test.ts', entityDepth: 0, hierarchyKind: 'root', childEntityIds: ['c1'] }),
      makeEntity({ id: 'c1', kind: 'class', name: 'MyClass', filePath: 'src/test.ts', parentEntityId: 'f1', entityDepth: 1, hierarchyKind: 'container', childEntityIds: ['m1', 'm2'] }),
      makeEntity({ id: 'm1', kind: 'method', name: 'doStuff', filePath: 'src/test.ts', parentEntityId: 'c1', entityDepth: 2, hierarchyKind: 'member', childEntityIds: [] }),
      makeEntity({ id: 'm2', kind: 'method', name: 'doMore', filePath: 'src/test.ts', parentEntityId: 'c1', entityDepth: 2, hierarchyKind: 'member', childEntityIds: [] }),
    ];

    const result = computeHierarchySummary(entities);

    expect(result.containerCount).toBe(1); // MyClass
    expect(result.leafCount).toBe(2);      // doStuff, doMore
    expect(result.maxDepth).toBe(2);
    expect(result.totalHierarchicalEntities).toBe(3); // all three non-file entities have parent or children
  });

  it('computes depth distribution', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'f1', kind: 'file', name: 'test.ts', filePath: 'src/test.ts', entityDepth: 0, hierarchyKind: 'root', childEntityIds: ['fn1', 'c1'] }),
      makeEntity({ id: 'fn1', kind: 'function', name: 'helper', filePath: 'src/test.ts', parentEntityId: 'f1', entityDepth: 1, hierarchyKind: 'member' }),
      makeEntity({ id: 'c1', kind: 'class', name: 'Foo', filePath: 'src/test.ts', parentEntityId: 'f1', entityDepth: 1, hierarchyKind: 'container', childEntityIds: ['m1'] }),
      makeEntity({ id: 'm1', kind: 'method', name: 'bar', filePath: 'src/test.ts', parentEntityId: 'c1', entityDepth: 2, hierarchyKind: 'member' }),
    ];

    const result = computeHierarchySummary(entities);

    expect(result.depthDistribution[1]).toBe(2); // fn1, c1
    expect(result.depthDistribution[2]).toBe(1); // m1
    expect(result.maxDepth).toBe(2);
  });

  it('computes per-file breakdown', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'f1', kind: 'file', name: 'a.ts', filePath: 'src/a.ts', entityDepth: 0, hierarchyKind: 'root', childEntityIds: ['fn1'] }),
      makeEntity({ id: 'fn1', kind: 'function', name: 'doA', filePath: 'src/a.ts', parentEntityId: 'f1', entityDepth: 1, hierarchyKind: 'member' }),
      makeEntity({ id: 'f2', kind: 'file', name: 'b.ts', filePath: 'src/b.ts', entityDepth: 0, hierarchyKind: 'root', childEntityIds: ['c2'] }),
      makeEntity({ id: 'c2', kind: 'class', name: 'ClassB', filePath: 'src/b.ts', parentEntityId: 'f2', entityDepth: 1, hierarchyKind: 'container', childEntityIds: ['m2'] }),
      makeEntity({ id: 'm2', kind: 'method', name: 'run', filePath: 'src/b.ts', parentEntityId: 'c2', entityDepth: 2, hierarchyKind: 'member' }),
    ];

    const result = computeHierarchySummary(entities);

    expect(result.perFile).toHaveLength(2);

    const fileA = result.perFile.find((f) => f.filePath === 'src/a.ts')!;
    expect(fileA.totalEntityCount).toBe(1);
    expect(fileA.topLevelCount).toBe(1);
    expect(fileA.maxDepth).toBe(1);
    expect(fileA.containerKinds).toEqual([]);

    const fileB = result.perFile.find((f) => f.filePath === 'src/b.ts')!;
    expect(fileB.totalEntityCount).toBe(2);
    expect(fileB.topLevelCount).toBe(1); // only ClassB at depth 1
    expect(fileB.maxDepth).toBe(2);
    expect(fileB.containerKinds).toEqual(['class']);
  });

  it('handles entities with no parent or children as leaves', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'f1', kind: 'file', name: 'x.ts', filePath: 'src/x.ts', entityDepth: 0, hierarchyKind: 'root' }),
      makeEntity({ id: 'fn1', kind: 'function', name: 'solo', filePath: 'src/x.ts', entityDepth: 1, hierarchyKind: 'member' }),
    ];

    const result = computeHierarchySummary(entities);

    expect(result.leafCount).toBe(1);
    expect(result.containerCount).toBe(0);
    // solo has no parentEntityId and no children → not hierarchical
    expect(result.totalHierarchicalEntities).toBe(0);
  });
});
