import { describe, it, expect } from 'vitest';
import { generateMoveSuggestions } from './move-suggestions.js';
import type { FileClassificationEntry, Community, WeightedEdge } from './types.js';

// ── Test helpers ────────────────────────────────────────────────────────

function makeFile(id: string, path: string, loc?: number): FileClassificationEntry {
  return {
    fileId: id,
    filePath: path,
    category: 'code',
    linesOfCode: loc,
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

function makeEdge(src: string, tgt: string, weight = 1): WeightedEdge {
  return {
    sourceFileId: src,
    targetFileId: tgt,
    isTypeOnly: false,
    weight,
    weightReason: 'test',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('generateMoveSuggestions', () => {
  it('suggests moving a file that is in the wrong directory', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
      makeFile('x1', 'src/utils/helper.ts'), // should be in src/auth
    ];
    const clusters = [makeCommunity('c0', ['a1', 'a2', 'x1'])];
    const edges = [
      makeEdge('x1', 'a1'),
      makeEdge('x1', 'a2'),
    ];

    const result = generateMoveSuggestions(files, clusters, edges);

    expect(result.totalFilesToMove).toBe(1);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].fileId).toBe('x1');
    expect(result.suggestions[0].currentDirectory).toBe('src/utils');
    expect(result.suggestions[0].suggestedDirectory).toBe('src/auth');
  });

  it('does not suggest moving a file already in the correct directory', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
    ];
    const clusters = [makeCommunity('c0', ['a1', 'a2'])];
    const edges = [makeEdge('a1', 'a2')];

    const result = generateMoveSuggestions(files, clusters, edges);

    expect(result.totalFilesToMove).toBe(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it('produces a human-readable rationale', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
      makeFile('x1', 'src/utils/helper.ts'),
    ];
    const clusters = [makeCommunity('c0', ['a1', 'a2', 'x1'])];
    const edges: WeightedEdge[] = [];

    const result = generateMoveSuggestions(files, clusters, edges);

    expect(result.suggestions).toHaveLength(1);
    const rationale = result.suggestions[0].rationale;
    expect(rationale).toContain('src/auth');
    expect(rationale).toContain('src/utils');
    expect(rationale).toContain('2 of 3');
  });

  it('orders suggestions by priority (higher first)', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
      makeFile('a3', 'src/auth/token.ts'),
      makeFile('x1', 'src/utils/helper.ts', 500), // large file
      makeFile('y1', 'src/lib/tiny.ts', 10),       // small file
    ];
    const clusters = [makeCommunity('c0', ['a1', 'a2', 'a3', 'x1', 'y1'])];
    const edges = [
      makeEdge('x1', 'a1', 3),
      makeEdge('x1', 'a2', 3),
    ];

    const result = generateMoveSuggestions(files, clusters, edges);

    expect(result.suggestions.length).toBe(2);
    // The large file with more edges should generally have higher priority
    expect(result.suggestions[0].priority).toBeGreaterThanOrEqual(result.suggestions[1].priority);
  });

  it('computes impact metrics for suggested moves', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts', 100),
      makeFile('a2', 'src/auth/logout.ts', 50),
      makeFile('x1', 'src/utils/helper.ts', 200),
      makeFile('z1', 'src/utils/other.ts', 30),
    ];
    const clusters = [
      makeCommunity('c0', ['a1', 'a2', 'x1']),
      makeCommunity('c1', ['z1']),
    ];
    const edges = [
      makeEdge('x1', 'a1', 2),
      makeEdge('x1', 'a2', 2),
      makeEdge('x1', 'z1', 1), // cross-cluster edge from same dir
    ];

    const result = generateMoveSuggestions(files, clusters, edges);
    const suggestion = result.suggestions.find((s) => s.fileId === 'x1');

    expect(suggestion).toBeDefined();
    expect(suggestion!.impact.fileLoc).toBe(200);
    expect(suggestion!.impact.sameClusterEdgesAdded).toBeGreaterThanOrEqual(0);
    expect(suggestion!.impact.crossClusterEdgesRemoved).toBeGreaterThanOrEqual(0);
    expect(typeof suggestion!.impact.deltaModularity).toBe('number');
  });

  it('assigns confidence based on cluster directory dominance', () => {
    // High confidence: 5 of 6 files in src/auth (>80%)
    const files = [
      makeFile('a1', 'src/auth/a.ts'),
      makeFile('a2', 'src/auth/b.ts'),
      makeFile('a3', 'src/auth/c.ts'),
      makeFile('a4', 'src/auth/d.ts'),
      makeFile('a5', 'src/auth/e.ts'),
      makeFile('x1', 'src/utils/stray.ts'),
    ];
    const clusters = [makeCommunity('c0', ['a1', 'a2', 'a3', 'a4', 'a5', 'x1'])];

    const result = generateMoveSuggestions(files, clusters, []);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].confidence).toBe('high');
  });

  it('returns empty result for no clusters', () => {
    const files = [makeFile('a1', 'src/auth/login.ts')];
    const result = generateMoveSuggestions(files, [], []);

    expect(result.totalFilesToMove).toBe(0);
    expect(result.suggestions).toHaveLength(0);
    expect(result.estimatedModularityGain).toBe(0);
  });

  it('skips unclustered files', () => {
    const files = [
      makeFile('a1', 'src/auth/login.ts'),
      makeFile('a2', 'src/auth/logout.ts'),
      makeFile('lone', 'src/orphan/lonely.ts'), // not in any cluster
    ];
    const clusters = [makeCommunity('c0', ['a1', 'a2'])];

    const result = generateMoveSuggestions(files, clusters, []);

    // lone is unclustered, should not appear in suggestions
    expect(result.suggestions.every((s) => s.fileId !== 'lone')).toBe(true);
  });
});
