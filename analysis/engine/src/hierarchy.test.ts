import { describe, it, expect } from 'vitest';
import type { Entity, Relationship } from '@aspect/contracts';
import {
  calculateFolderDistance,
  calculateHierarchyMetrics,
} from './hierarchy.js';

// ── Factories ───────────────────────────────────────────────────────────

function entity(
  id: string,
  filePath: string,
  overrides?: Partial<Entity>,
): Entity {
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
  };
}

// ── calculateFolderDistance ──────────────────────────────────────────────

describe('calculateFolderDistance', () => {
  it('returns distance 0 for files in the same directory', () => {
    const result = calculateFolderDistance('src/a.ts', 'src/b.ts');
    expect(result).toEqual({
      upDistance: 0,
      downDistance: 0,
      totalDistance: 0,
      commonAncestor: 'src',
    });
  });

  it('calculates sibling directory distance', () => {
    const result = calculateFolderDistance(
      'packages/core/src/agent/index.ts',
      'packages/core/src/llm/index.ts',
    );
    expect(result).toEqual({
      upDistance: 1,
      downDistance: 1,
      totalDistance: 2,
      commonAncestor: 'packages/core/src',
    });
  });

  it('handles deeply nested paths', () => {
    const result = calculateFolderDistance(
      'a/b/c/d/file.ts',
      'a/b/x/y/z/file.ts',
    );
    expect(result).toEqual({
      upDistance: 2,
      downDistance: 3,
      totalDistance: 5,
      commonAncestor: 'a/b',
    });
  });

  it('handles root-level files (no directory)', () => {
    const result = calculateFolderDistance('index.ts', 'main.ts');
    expect(result).toEqual({
      upDistance: 0,
      downDistance: 0,
      totalDistance: 0,
      commonAncestor: '',
    });
  });

  it('handles paths with leading slashes', () => {
    const result = calculateFolderDistance('/src/a.ts', '/src/b/c.ts');
    expect(result).toEqual({
      upDistance: 0,
      downDistance: 1,
      totalDistance: 1,
      commonAncestor: 'src',
    });
  });

  it('handles backslash paths', () => {
    const result = calculateFolderDistance(
      'src\\agent\\index.ts',
      'src\\llm\\index.ts',
    );
    expect(result).toEqual({
      upDistance: 1,
      downDistance: 1,
      totalDistance: 2,
      commonAncestor: 'src',
    });
  });

  it('calculates asymmetric distances (deep source, shallow target)', () => {
    const result = calculateFolderDistance(
      'src/deep/nested/file.ts',
      'src/file.ts',
    );
    expect(result).toEqual({
      upDistance: 2,
      downDistance: 0,
      totalDistance: 2,
      commonAncestor: 'src',
    });
  });

  it('returns 0 for the same file path', () => {
    const result = calculateFolderDistance('src/utils/helper.ts', 'src/utils/helper.ts');
    expect(result).toEqual({
      upDistance: 0,
      downDistance: 0,
      totalDistance: 0,
      commonAncestor: 'src/utils',
    });
  });
});

// ── calculateHierarchyMetrics ───────────────────────────────────────────

describe('calculateHierarchyMetrics', () => {
  it('returns empty results for empty input', () => {
    const result = calculateHierarchyMetrics([], []);
    expect(result.relationships).toEqual([]);
    expect(result.distanceDistribution).toEqual({
      histogram: [],
      mean: 0,
      median: 0,
      p90: 0,
    });
    expect(result.utilityFiles).toEqual([]);
    expect(result.longDistanceImports).toEqual([]);
  });

  it('computes correct distance distribution', () => {
    // Three files: src/a.ts, src/b.ts, lib/c.ts
    const entities = [
      entity('file:src/a.ts', 'src/a.ts'),
      entity('file:src/b.ts', 'src/b.ts'),
      entity('file:lib/c.ts', 'lib/c.ts'),
    ];
    const rels = [
      rel('file:src/a.ts', 'file:src/b.ts'), // distance 0
      rel('file:src/a.ts', 'file:lib/c.ts'), // distance 2 (up 1, down 1)
    ];

    const result = calculateHierarchyMetrics(entities, rels);

    expect(result.relationships).toHaveLength(2);
    expect(result.relationships[0].totalDistance).toBe(0);
    expect(result.relationships[1].totalDistance).toBe(2);

    // Distribution: [1, 0, 1] — one at distance 0, one at distance 2
    expect(result.distanceDistribution.histogram).toEqual([1, 0, 1]);
    expect(result.distanceDistribution.mean).toBe(1);
    expect(result.distanceDistribution.median).toBe(1);
  });

  it('detects utility files (high fan-in, low fan-out)', () => {
    // util.ts is imported by 6 files, imports nothing
    const util = entity('file:src/utils/util.ts', 'src/utils/util.ts');
    const importers = Array.from({ length: 6 }, (_, i) =>
      entity(`file:src/mod${i}/index.ts`, `src/mod${i}/index.ts`),
    );
    const entities = [util, ...importers];
    const rels = importers.map((imp) => rel(imp.id, util.id));

    const result = calculateHierarchyMetrics(entities, rels, {
      utilityFanInThreshold: 5,
      utilityRatioThreshold: 0.8,
    });

    expect(result.utilityFiles).toHaveLength(1);
    expect(result.utilityFiles[0].entityId).toBe('file:src/utils/util.ts');
    expect(result.utilityFiles[0].fanIn).toBe(6);
    expect(result.utilityFiles[0].fanOut).toBe(0);
    expect(result.utilityFiles[0].utilityRatio).toBe(1);
  });

  it('does NOT flag a file as utility when fan-in is below threshold', () => {
    const util = entity('file:src/utils/util.ts', 'src/utils/util.ts');
    const importers = Array.from({ length: 3 }, (_, i) =>
      entity(`file:src/mod${i}/index.ts`, `src/mod${i}/index.ts`),
    );
    const entities = [util, ...importers];
    const rels = importers.map((imp) => rel(imp.id, util.id));

    const result = calculateHierarchyMetrics(entities, rels, {
      utilityFanInThreshold: 5,
    });

    expect(result.utilityFiles).toHaveLength(0);
  });

  it('flags long-distance imports correctly', () => {
    const entities = [
      entity('file:a/b/c/d/e/deep.ts', 'a/b/c/d/e/deep.ts'),
      entity('file:x/y/z/far.ts', 'x/y/z/far.ts'),
    ];
    const rels = [rel('file:a/b/c/d/e/deep.ts', 'file:x/y/z/far.ts')];

    const result = calculateHierarchyMetrics(entities, rels, {
      longDistanceThreshold: 4,
    });

    // distance = 5 (up) + 3 (down) = 8
    expect(result.longDistanceImports).toHaveLength(1);
    expect(result.longDistanceImports[0].totalDistance).toBe(8);
    expect(result.longDistanceImports[0].reason).toContain('8 directory levels');
  });

  it('does NOT flag long-distance imports to utility files', () => {
    // Utility file imported by many
    const util = entity('file:x/y/z/util.ts', 'x/y/z/util.ts');
    const deepFile = entity('file:a/b/c/d/e/deep.ts', 'a/b/c/d/e/deep.ts');

    // 6 other importers to make util a utility
    const importers = Array.from({ length: 6 }, (_, i) =>
      entity(`file:m${i}/index.ts`, `m${i}/index.ts`),
    );
    const entities = [util, deepFile, ...importers];

    const rels = [
      // The long-distance import under test
      rel(deepFile.id, util.id),
      // Imports that make util a utility
      ...importers.map((imp) => rel(imp.id, util.id)),
    ];

    const result = calculateHierarchyMetrics(entities, rels, {
      longDistanceThreshold: 4,
      utilityFanInThreshold: 5,
      utilityRatioThreshold: 0.8,
    });

    expect(result.utilityFiles).toHaveLength(1);
    expect(result.utilityFiles[0].filePath).toBe('x/y/z/util.ts');
    // The deep→util import should NOT be flagged
    expect(result.longDistanceImports).toHaveLength(0);
  });

  it('excludes node_modules targets from long-distance flags', () => {
    const entities = [
      entity('file:src/a/b/c/d/deep.ts', 'src/a/b/c/d/deep.ts'),
      entity('file:node_modules/lib/index.ts', 'node_modules/lib/index.ts'),
    ];
    const rels = [rel('file:src/a/b/c/d/deep.ts', 'file:node_modules/lib/index.ts')];

    const result = calculateHierarchyMetrics(entities, rels, {
      longDistanceThreshold: 2,
    });

    expect(result.longDistanceImports).toHaveLength(0);
  });

  it('handles a single relationship', () => {
    const entities = [
      entity('file:src/a.ts', 'src/a.ts'),
      entity('file:lib/b.ts', 'lib/b.ts'),
    ];
    const rels = [rel('file:src/a.ts', 'file:lib/b.ts')];

    const result = calculateHierarchyMetrics(entities, rels);

    expect(result.relationships).toHaveLength(1);
    expect(result.distanceDistribution.mean).toBe(2);
    expect(result.distanceDistribution.median).toBe(2);
    expect(result.distanceDistribution.p90).toBe(2);
  });

  it('handles self-reference (same file)', () => {
    const entities = [entity('file:src/a.ts', 'src/a.ts')];
    const rels = [rel('file:src/a.ts', 'file:src/a.ts')];

    const result = calculateHierarchyMetrics(entities, rels);

    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].totalDistance).toBe(0);
  });

  it('filters to file-only relationships when fileRelationshipsOnly is true', () => {
    const entities = [
      entity('file:src/a.ts', 'src/a.ts'),
      entity('file:src/b.ts', 'src/b.ts'),
      entity('fn:src/a.ts:foo', 'src/a.ts', { kind: 'function', name: 'foo' }),
      entity('fn:src/b.ts:bar', 'src/b.ts', { kind: 'function', name: 'bar' }),
    ];
    const rels = [
      rel('file:src/a.ts', 'file:src/b.ts'),          // file → file ✓
      rel('fn:src/a.ts:foo', 'fn:src/b.ts:bar'),      // function → function ✗
    ];

    const resultAll = calculateHierarchyMetrics(entities, rels, {
      fileRelationshipsOnly: false,
    });
    expect(resultAll.relationships).toHaveLength(2);

    const resultFilesOnly = calculateHierarchyMetrics(entities, rels, {
      fileRelationshipsOnly: true,
    });
    expect(resultFilesOnly.relationships).toHaveLength(1);
    expect(resultFilesOnly.relationships[0].sourceEntityId).toBe('file:src/a.ts');
  });

  it('computes correct p90', () => {
    // 10 relationships with distances 0..9
    const entities = Array.from({ length: 11 }, (_, i) => {
      const depth = Array.from({ length: i }, (__, j) => `d${j}`).join('/');
      const filePath = depth ? `${depth}/f.ts` : 'f.ts';
      return entity(`file:${i}`, filePath);
    });

    // Each entity[i] imports entity[0] (root-level f.ts) — distance = i
    const rels = Array.from({ length: 10 }, (_, i) =>
      rel(`file:${i + 1}`, 'file:0'),
    );

    const result = calculateHierarchyMetrics(entities, rels);

    // Distances: [1,2,3,4,5,6,7,8,9,10]
    // Sorted: [1,2,3,4,5,6,7,8,9,10], p90 index = ceil(10*0.9)-1 = 8 → value 9
    expect(result.distanceDistribution.p90).toBe(9);
  });

  it('skips relationships with unknown entities', () => {
    const entities = [entity('file:src/a.ts', 'src/a.ts')];
    const rels = [rel('file:src/a.ts', 'file:unknown.ts')];

    const result = calculateHierarchyMetrics(entities, rels);

    expect(result.relationships).toHaveLength(0);
  });
});
