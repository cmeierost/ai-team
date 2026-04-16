import { describe, it, expect } from 'vitest';
import { computeNonQualifiedDiagnostics } from './nonqualified-diagnostics.js';
import type { Entity } from '@aspect/contracts';

function makeFileEntity(id: string, filePath: string, loc: number): Entity {
  return {
    id,
    kind: 'file',
    name: filePath,
    filePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: loc, endColumn: 0 },
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root',
    classification: { isAbstract: false, isInterface: false, isConcrete: true, isTypeOnly: false, isExported: false, visibility: null },
    rawCounts: { linesOfCode: loc },
  };
}

function makeChildEntity(id: string, parentId: string, filePath: string, loc: number): Entity {
  return {
    id,
    kind: 'function',
    name: 'fn',
    filePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: loc, endColumn: 0 },
    childEntityIds: [],
    entityDepth: 1,
    hierarchyKind: 'member',
    parentEntityId: parentId,
    classification: { isAbstract: false, isInterface: false, isConcrete: true, isTypeOnly: false, isExported: false, visibility: null },
    rawCounts: { linesOfCode: loc },
  };
}

describe('computeNonQualifiedDiagnostics', () => {
  it('detects gap between file and child entities', () => {
    const entities: Entity[] = [
      makeFileEntity('f1', 'src/a.ts', 100),
      makeChildEntity('c1', 'f1', 'src/a.ts', 40),
      makeChildEntity('c2', 'f1', 'src/a.ts', 30),
    ];
    const diag = computeNonQualifiedDiagnostics(entities);

    expect(diag.perFile).toHaveLength(1);
    const f = diag.perFile[0];
    expect(f.totalLines).toBe(100);
    expect(f.entityCoveredLines).toBe(70);
    expect(f.nonQualifiedLines).toBe(30);
    expect(f.nonQualifiedRatio).toBe(0.3);

    expect(diag.totalNonQualifiedLoc).toBe(30);
    expect(diag.nonQualifiedRatio).toBe(0.3);
  });

  it('reports 0 gap when fully covered', () => {
    const entities: Entity[] = [
      makeFileEntity('f1', 'src/a.ts', 50),
      makeChildEntity('c1', 'f1', 'src/a.ts', 50),
    ];
    const diag = computeNonQualifiedDiagnostics(entities);

    const f = diag.perFile[0];
    expect(f.nonQualifiedLines).toBe(0);
    expect(f.nonQualifiedRatio).toBe(0);
  });

  it('treats file with no children as fully non-qualified', () => {
    const entities: Entity[] = [
      makeFileEntity('f1', 'src/standalone.ts', 80),
    ];
    const diag = computeNonQualifiedDiagnostics(entities);

    const f = diag.perFile[0];
    expect(f.nonQualifiedLines).toBe(80);
    expect(f.nonQualifiedRatio).toBe(1);
  });

  it('clamps to 0 when children exceed file LOC', () => {
    const entities: Entity[] = [
      makeFileEntity('f1', 'src/a.ts', 50),
      makeChildEntity('c1', 'f1', 'src/a.ts', 30),
      makeChildEntity('c2', 'f1', 'src/a.ts', 30),
    ];
    const diag = computeNonQualifiedDiagnostics(entities);

    const f = diag.perFile[0];
    expect(f.nonQualifiedLines).toBe(0); // clamped to 0
  });

  it('handles empty input', () => {
    const diag = computeNonQualifiedDiagnostics([]);
    expect(diag.perFile).toHaveLength(0);
    expect(diag.totalNonQualifiedLoc).toBe(0);
    expect(diag.nonQualifiedRatio).toBe(0);
  });
});
