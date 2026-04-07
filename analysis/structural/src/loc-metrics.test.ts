import { describe, it, expect } from 'vitest';
import { computeCanonicalLocMetrics } from './loc-metrics.js';
import type { Entity, Relationship } from '@aspect/contracts';

function makeFileEntity(id: string, filePath: string, rawCounts?: Partial<Entity['rawCounts']>): Entity {
  return {
    id,
    kind: 'file',
    name: filePath,
    filePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 100, endColumn: 0 },
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root',
    classification: { isAbstract: false, isInterface: false, isConcrete: true, isTypeOnly: false, isExported: false, visibility: null },
    rawCounts: rawCounts as any,
  };
}

function makeChildEntity(id: string, parentId: string, filePath: string, rawCounts?: Partial<Entity['rawCounts']>): Entity {
  return {
    id,
    kind: 'function',
    name: 'fn',
    filePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 10, endColumn: 0 },
    childEntityIds: [],
    entityDepth: 1,
    hierarchyKind: 'member',
    parentEntityId: parentId,
    classification: { isAbstract: false, isInterface: false, isConcrete: true, isTypeOnly: false, isExported: false, visibility: null },
    rawCounts: rawCounts as any,
  };
}

function makeRelationship(sourceFilePath: string, kind: Relationship['kind']): Relationship {
  return {
    sourceEntityId: 'e1',
    targetEntityId: 'e2',
    kind,
    sourceFilePath,
    targetFilePath: 'other.ts',
    sourceRange: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
    resolutionKind: 'resolved',
    targetClassification: 'function',
    targetIsAbstraction: false,
    crossModule: false,
    crossPackage: false,
    thirdParty: false,
    typeOnly: false,
    dynamic: false,
    consumedMembers: null,
    targetTotalMembers: null,
  };
}

describe('computeCanonicalLocMetrics', () => {
  it('computes canonical LOC from entity rawCounts', () => {
    const entities: Entity[] = [
      makeFileEntity('f1', 'src/a.ts', { linesOfCode: 100, blankLines: 10, commentLines: 5 }),
    ];
    const rels: Relationship[] = [
      makeRelationship('src/a.ts', 'import'),
      makeRelationship('src/a.ts', 'import'),
    ];
    const result = computeCanonicalLocMetrics(entities, rels);

    expect(result.perFile).toHaveLength(1);
    const f = result.perFile[0];
    expect(f.rawLines).toBe(100);
    expect(f.blankLines).toBe(10);
    expect(f.commentLines).toBe(5);
    expect(f.importExportOnlyLines).toBe(2);
    expect(f.canonicalLoc).toBe(83); // 100 - 10 - 5 - 2
    expect(f.documentationDensity).toBe(0.05);

    expect(result.totalCanonicalLoc).toBe(83);
    expect(result.totalRawLines).toBe(100);
  });

  it('aggregates from children when file has no rawCounts', () => {
    const entities: Entity[] = [
      makeFileEntity('f1', 'src/a.ts'),
      makeChildEntity('c1', 'f1', 'src/a.ts', { linesOfCode: 30, blankLines: 2, commentLines: 1 }),
      makeChildEntity('c2', 'f1', 'src/a.ts', { linesOfCode: 20, blankLines: 1, commentLines: 0 }),
    ];
    const result = computeCanonicalLocMetrics(entities, []);

    const f = result.perFile[0];
    expect(f.rawLines).toBe(50);
    expect(f.blankLines).toBe(3);
    expect(f.commentLines).toBe(1);
    expect(f.canonicalLoc).toBe(46);
  });

  it('handles missing rawCounts gracefully', () => {
    const entities: Entity[] = [
      makeFileEntity('f1', 'src/empty.ts'),
    ];
    const result = computeCanonicalLocMetrics(entities, []);

    const f = result.perFile[0];
    expect(f.rawLines).toBe(0);
    expect(f.canonicalLoc).toBe(0);
    expect(f.documentationDensity).toBe(0);
  });

  it('computes aggregate ratios', () => {
    const entities: Entity[] = [
      makeFileEntity('f1', 'a.ts', { linesOfCode: 200, blankLines: 40, commentLines: 20 }),
      makeFileEntity('f2', 'b.ts', { linesOfCode: 100, blankLines: 10, commentLines: 5 }),
    ];
    const rels: Relationship[] = [
      makeRelationship('a.ts', 'import'),
      makeRelationship('b.ts', 're-export'),
    ];
    const result = computeCanonicalLocMetrics(entities, rels);

    expect(result.totalRawLines).toBe(300);
    expect(result.blankLineRatio).toBeCloseTo(50 / 300, 2);
    expect(result.commentRatio).toBeCloseTo(25 / 300, 2);
    expect(result.importExportOnlyRatio).toBeCloseTo(2 / 300, 2);
  });
});
