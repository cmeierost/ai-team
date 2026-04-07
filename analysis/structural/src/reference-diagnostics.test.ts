import { describe, it, expect } from 'vitest';
import { computeReferenceDiagnostics } from './reference-diagnostics.js';
import type { Relationship } from '@aspect/contracts';

function makeRelationship(overrides: Partial<Relationship>): Relationship {
  return {
    sourceEntityId: 'src-1',
    targetEntityId: 'tgt-1',
    kind: 'import',
    sourceFilePath: 'src/a.ts',
    targetFilePath: 'src/b.ts',
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
    ...overrides,
  };
}

describe('computeReferenceDiagnostics', () => {
  it('counts a mix of resolved / proxy / unresolved', () => {
    const rels: Relationship[] = [
      makeRelationship({ resolutionKind: 'resolved' }),
      makeRelationship({ resolutionKind: 'resolved' }),
      makeRelationship({ resolutionKind: 'proxy' }),
      makeRelationship({ resolutionKind: 'unresolved', targetFilePath: 'ext/lib.ts' }),
    ];
    const diag = computeReferenceDiagnostics(rels);

    expect(diag.totalReferences).toBe(4);
    expect(diag.resolvedCount).toBe(2);
    expect(diag.proxyCount).toBe(1);
    expect(diag.unresolvedCount).toBe(1);
    expect(diag.resolutionRate).toBe(0.5);
    expect(diag.proxyRate).toBe(0.25);
    expect(diag.unresolvedRate).toBe(0.25);
  });

  it('produces per-file breakdown', () => {
    const rels: Relationship[] = [
      makeRelationship({ sourceEntityId: 'f1', sourceFilePath: 'a.ts', resolutionKind: 'resolved' }),
      makeRelationship({ sourceEntityId: 'f1', sourceFilePath: 'a.ts', resolutionKind: 'unresolved', targetFilePath: 'ext.ts' }),
      makeRelationship({ sourceEntityId: 'f2', sourceFilePath: 'b.ts', resolutionKind: 'proxy' }),
    ];
    const diag = computeReferenceDiagnostics(rels);

    expect(diag.perFileStats).toHaveLength(2);

    const fileA = diag.perFileStats.find((f) => f.filePath === 'a.ts')!;
    expect(fileA.outgoingResolved).toBe(1);
    expect(fileA.outgoingUnresolved).toBe(1);
    expect(fileA.outgoingTotal).toBe(2);
    expect(fileA.resolutionRate).toBe(0.5);

    const fileB = diag.perFileStats.find((f) => f.filePath === 'b.ts')!;
    expect(fileB.outgoingProxy).toBe(1);
  });

  it('produces top unresolved targets', () => {
    const rels: Relationship[] = [
      makeRelationship({ resolutionKind: 'unresolved', targetFilePath: 'x.ts' }),
      makeRelationship({ resolutionKind: 'unresolved', targetFilePath: 'x.ts' }),
      makeRelationship({ resolutionKind: 'unresolved', targetFilePath: 'y.ts' }),
    ];
    const diag = computeReferenceDiagnostics(rels);

    expect(diag.topUnresolvedTargets[0]).toEqual({ target: 'x.ts', count: 2 });
    expect(diag.topUnresolvedTargets[1]).toEqual({ target: 'y.ts', count: 1 });
  });

  it('handles empty input', () => {
    const diag = computeReferenceDiagnostics([]);
    expect(diag.totalReferences).toBe(0);
    expect(diag.resolutionRate).toBe(0);
    expect(diag.perFileStats).toHaveLength(0);
  });
});
