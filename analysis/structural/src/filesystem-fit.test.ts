import { describe, it, expect } from 'vitest';
import { computeFilesystemFit } from './filesystem-fit.js';
import type { FileClassificationEntry, Community } from './types.js';

// ── Test helpers ────────────────────────────────────────────────────────

function makeFile(id: string, path: string): FileClassificationEntry {
  return {
    fileId: id,
    filePath: path,
    category: 'code',
    fileClassification: { category: 'code', confidence: 1, reason: 'test' },
  };
}

function makeCommunity(id: string, fileIds: string[]): Community {
  return {
    id,
    memberEntityIds: [],
    memberFileIds: fileIds,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('computeFilesystemFit', () => {
  it('returns perfect scores when all cluster files share the same directory', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
      makeFile('b1', 'src/api/routes.ts'),
      makeFile('b2', 'src/api/handler.ts'),
    ];
    const clusters = [
      makeCommunity('c0', ['a1', 'a2']),
      makeCommunity('c1', ['b1', 'b2']),
    ];

    const result = computeFilesystemFit(files, clusters);

    expect(result.adjustedRandIndex).toBe(1);
    expect(result.normalizedMutualInfo).toBe(1);
    expect(result.mojoFmScore).toBe(100);
    expect(result.filesToMove).toBe(0);
    expect(result.totalFiles).toBe(4);
  });

  it('returns low scores when clusters are completely misaligned with directories', () => {
    // cluster-0 wants [a1, b1] but a1 is in src/auth, b1 is in src/api
    // cluster-1 wants [a2, b2] but a2 is in src/auth, b2 is in src/api
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('b1', 'src/api/routes.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
      makeFile('b2', 'src/api/handler.ts'),
    ];
    const clusters = [
      makeCommunity('c0', ['a1', 'b1']),
      makeCommunity('c1', ['a2', 'b2']),
    ];

    const result = computeFilesystemFit(files, clusters);

    // Each cluster has one file per directory — directory and cluster
    // partitions are independent, so ARI and NMI should be low
    expect(result.adjustedRandIndex).toBeLessThan(0.5);
    expect(result.normalizedMutualInfo).toBeLessThan(0.5);
    expect(result.mojoFmScore).toBeLessThan(100);
    expect(result.filesToMove).toBeGreaterThan(0);
  });

  it('builds correct per-directory breakdown', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
      makeFile('a3', 'src/auth/stray.ts'), // different cluster
      makeFile('b1', 'src/api/routes.ts'),
    ];
    const clusters = [
      makeCommunity('c0', ['a1', 'a2']),
      makeCommunity('c1', ['a3', 'b1']),
    ];

    const result = computeFilesystemFit(files, clusters);
    const authDir = result.perDirectory.find((d) => d.directory === 'src/auth');
    const apiDir = result.perDirectory.find((d) => d.directory === 'src/api');

    expect(authDir).toBeDefined();
    expect(authDir!.fileCount).toBe(3);
    expect(authDir!.clusterCount).toBe(2);
    expect(authDir!.dominantClusterId).toBe('c0');
    expect(authDir!.dominantClusterRatio).toBeCloseTo(2 / 3, 2);
    expect(authDir!.misplacedFiles).toHaveLength(1);
    expect(authDir!.misplacedFiles[0].fileId).toBe('a3');

    expect(apiDir).toBeDefined();
    expect(apiDir!.fileCount).toBe(1);
    expect(apiDir!.clusterCount).toBe(1);
    expect(apiDir!.dominantClusterId).toBe('c1');
  });

  it('correctly identifies misplaced files with suggested directory', () => {
    // src/auth has 3 files: 2 from c0, 1 from c1
    // The c1 file (x1) is misplaced within src/auth — it should move to src/api
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
      makeFile('x1', 'src/auth/stray.ts'),   // cluster c1 member stuck in auth/
      makeFile('b1', 'src/api/routes.ts'),
      makeFile('b2', 'src/api/handler.ts'),
    ];
    const clusters = [
      makeCommunity('c0', ['a1', 'a2']),
      makeCommunity('c1', ['x1', 'b1', 'b2']),
    ];

    const result = computeFilesystemFit(files, clusters);

    expect(result.filesToMove).toBe(1);

    const authDir = result.perDirectory.find((d) => d.directory === 'src/auth');
    expect(authDir).toBeDefined();
    expect(authDir!.misplacedFiles).toHaveLength(1);
    expect(authDir!.misplacedFiles[0].fileId).toBe('x1');
    expect(authDir!.misplacedFiles[0].suggestedDirectory).toBe('src/api');
    expect(authDir!.misplacedFiles[0].currentClusterId).toBe('c1');
  });

  it('handles empty input gracefully', () => {
    const result = computeFilesystemFit([], []);
    expect(result.adjustedRandIndex).toBe(1);
    expect(result.mojoFmScore).toBe(100);
    expect(result.totalFiles).toBe(0);
  });

  it('handles unclustered files as singletons', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('b1', 'src/api/routes.ts'),
    ];
    // No clusters — all files are singletons
    const result = computeFilesystemFit(files, []);

    expect(result.totalFiles).toBe(2);
    // Each file is its own "cluster" and its own directory — trivially aligned
    expect(result.mojoFmScore).toBe(100);
  });

  it('filters to code files only', () => {
    const files: FileClassificationEntry[] = [
      makeFile('a1', 'src/auth/login.ts'),
      {
        fileId: 'cfg',
        filePath: 'tsconfig.json',
        category: 'config',
        fileClassification: { category: 'config', confidence: 1, reason: 'test' },
      },
    ];
    const clusters = [makeCommunity('c0', ['a1'])];

    const result = computeFilesystemFit(files, clusters);
    expect(result.totalFiles).toBe(1);
  });
});
