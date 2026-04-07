import { describe, it, expect } from 'vitest';
import { computeRoleSeparation } from './role-separation.js';
import type { FileCluster, FileClassificationEntry } from './types.js';

function makeClassification(
  fileId: string,
  role: string | undefined,
  loc: number,
): FileClassificationEntry {
  return {
    fileId,
    filePath: `src/${fileId}.ts`,
    category: 'code',
    contentRole: role as any,
    linesOfCode: loc,
    fileClassification: { category: 'code' } as any,
  };
}

function makeCluster(id: string, fileIds: string[]): FileCluster {
  return {
    id,
    fileIds,
    cohesionType: 'mutual-dependencies',
    internalCoupling: 1,
    externalCoupling: 0,
    cohesionRatio: 1,
  };
}

describe('computeRoleSeparation', () => {
  it('scores 1.0 for a single-role cluster', () => {
    const clusters = [makeCluster('c1', ['f1', 'f2'])];
    const files = [
      makeClassification('f1', 'logic', 100),
      makeClassification('f2', 'logic', 50),
    ];
    const result = computeRoleSeparation(clusters, files);

    expect(result.perCluster).toHaveLength(1);
    expect(result.perCluster[0].dominantRole).toBe('logic');
    expect(result.perCluster[0].separationScore).toBe(1);
    expect(result.perCluster[0].logicLoc).toBe(150);
  });

  it('scores < 1.0 for mixed-role cluster', () => {
    const clusters = [makeCluster('c1', ['f1', 'f2', 'f3'])];
    const files = [
      makeClassification('f1', 'logic', 60),
      makeClassification('f2', 'contract', 30),
      makeClassification('f3', 'presentation', 10),
    ];
    const result = computeRoleSeparation(clusters, files);

    const c = result.perCluster[0];
    expect(c.dominantRole).toBe('logic');
    expect(c.separationScore).toBe(0.6); // 60/100
    expect(c.logicLoc).toBe(60);
    expect(c.contractLoc).toBe(30);
    expect(c.presentationLoc).toBe(10);
  });

  it('computes repo summary', () => {
    const clusters = [
      makeCluster('c1', ['f1']),
      makeCluster('c2', ['f2']),
    ];
    const files = [
      makeClassification('f1', 'logic', 100),
      makeClassification('f2', 'infrastructure', 200),
    ];
    const result = computeRoleSeparation(clusters, files);

    expect(result.repoSummary.totalLogicLoc).toBe(100);
    expect(result.repoSummary.totalInfrastructureLoc).toBe(200);
    expect(result.repoSummary.avgClusterSeparation).toBe(1); // both are pure
  });

  it('buckets unknown roles as other', () => {
    const clusters = [makeCluster('c1', ['f1'])];
    const files = [makeClassification('f1', undefined, 50)];
    const result = computeRoleSeparation(clusters, files);

    expect(result.perCluster[0].otherLoc).toBe(50);
    expect(result.perCluster[0].dominantRole).toBe('other');
  });

  it('handles empty clusters', () => {
    const result = computeRoleSeparation([], []);
    expect(result.perCluster).toHaveLength(0);
    expect(result.repoSummary.avgClusterSeparation).toBe(0);
  });
});
