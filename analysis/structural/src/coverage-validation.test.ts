import { describe, it, expect } from 'vitest';
import { computeCoverageValidation } from './coverage-validation.js';
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

describe('computeCoverageValidation', () => {
  it('returns zeroed result for no entities', () => {
    const result = computeCoverageValidation([]);
    expect(result.standaloneEntityCount).toBe(0);
    expect(result.importReexportEntityCount).toBe(0);
    expect(result.kindDistribution).toEqual({});
    expect(result.uncoveredFileCount).toBe(0);
  });

  it('computes kind distribution', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'f1', kind: 'file', name: 'a.ts', filePath: 'src/a.ts' }),
      makeEntity({ id: 'fn1', kind: 'function', name: 'doA', filePath: 'src/a.ts', parentEntityId: 'f1' }),
      makeEntity({ id: 'fn2', kind: 'function', name: 'doB', filePath: 'src/a.ts', parentEntityId: 'f1' }),
      makeEntity({ id: 'c1', kind: 'class', name: 'Foo', filePath: 'src/a.ts', parentEntityId: 'f1' }),
    ];

    const result = computeCoverageValidation(entities);

    expect(result.kindDistribution['file']).toBe(1);
    expect(result.kindDistribution['function']).toBe(2);
    expect(result.kindDistribution['class']).toBe(1);
    expect(result.standaloneEntityCount).toBe(3);
    expect(result.importReexportEntityCount).toBe(0);
  });

  it('detects uncovered files (files with no children)', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'f1', kind: 'file', name: 'covered.ts', filePath: 'src/covered.ts' }),
      makeEntity({ id: 'fn1', kind: 'function', name: 'fn', filePath: 'src/covered.ts', parentEntityId: 'f1' }),
      makeEntity({ id: 'f2', kind: 'file', name: 'empty.ts', filePath: 'src/empty.ts' }),
    ];

    const result = computeCoverageValidation(entities);

    expect(result.uncoveredFileCount).toBe(1); // empty.ts has no children
  });

  it('all files covered when every file has children', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'f1', kind: 'file', name: 'a.ts', filePath: 'src/a.ts' }),
      makeEntity({ id: 'fn1', kind: 'function', name: 'x', filePath: 'src/a.ts', parentEntityId: 'f1' }),
      makeEntity({ id: 'f2', kind: 'file', name: 'b.ts', filePath: 'src/b.ts' }),
      makeEntity({ id: 'fn2', kind: 'class', name: 'Y', filePath: 'src/b.ts', parentEntityId: 'f2' }),
    ];

    const result = computeCoverageValidation(entities);

    expect(result.uncoveredFileCount).toBe(0);
  });

  it('counts standalone vs import/reexport entities', () => {
    // import/reexport kinds aren't in the standard Entity kind union,
    // but if they somehow appear they should be flagged
    const entities: Entity[] = [
      makeEntity({ id: 'f1', kind: 'file', name: 'a.ts', filePath: 'src/a.ts' }),
      makeEntity({ id: 'fn1', kind: 'function', name: 'doStuff', filePath: 'src/a.ts', parentEntityId: 'f1' }),
      makeEntity({ id: 'c1', kind: 'class', name: 'Svc', filePath: 'src/a.ts', parentEntityId: 'f1' }),
    ];

    const result = computeCoverageValidation(entities);

    expect(result.standaloneEntityCount).toBe(2);
    expect(result.importReexportEntityCount).toBe(0);
  });
});
