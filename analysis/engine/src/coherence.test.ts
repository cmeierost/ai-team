import { describe, it, expect } from 'vitest';
import type { Entity, Relationship } from '@aspect/contracts';
import { calculateCoherence } from './coherence.js';

// ── Test helpers ────────────────────────────────────────────────────────

function entity(
  id: string,
  filePath: string,
  overrides?: Partial<Entity>,
): Entity {
  return {
    id,
    kind: 'file',
    name: filePath.split('/').pop()!,
    filePath,
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
  } as Relationship;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('calculateCoherence', () => {
  it('Test 1: perfect coherence — single directory cluster', () => {
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('a2', 'src/auth/logout.ts'),
      entity('a3', 'src/auth/token.ts'),
    ];
    const relationships = [
      rel('a1', 'a2'),
      rel('a2', 'a3'),
      rel('a3', 'a1'),
    ];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
    });

    expect(result.overallCoherenceScore).toBe(1);
    expect(result.crossReferences).toHaveLength(0);
    expect(result.misplacedFiles).toHaveLength(0);
    expect(result.tangledDirectories).toHaveLength(0);
    expect(result.directoryGroups).toHaveLength(1);
    expect(result.directoryGroups[0].directory).toBe('src/auth');
  });

  it('Test 2: clear split — two independent clusters match two directories', () => {
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('a2', 'src/auth/logout.ts'),
      entity('a3', 'src/auth/token.ts'),
      entity('d1', 'src/data/query.ts'),
      entity('d2', 'src/data/schema.ts'),
      entity('d3', 'src/data/migrate.ts'),
    ];
    const relationships = [
      // auth cluster
      rel('a1', 'a2'),
      rel('a2', 'a3'),
      rel('a3', 'a1'),
      // data cluster
      rel('d1', 'd2'),
      rel('d2', 'd3'),
      rel('d3', 'd1'),
    ];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
    });

    expect(result.overallCoherenceScore).toBe(1);
    expect(result.directoryGroups).toHaveLength(2);
    expect(result.crossReferences).toHaveLength(0);
    expect(result.misplacedFiles).toHaveLength(0);
    expect(result.communityMappings.length).toBeGreaterThanOrEqual(2);
    // Each community spans exactly 1 directory
    for (const cm of result.communityMappings) {
      expect(cm.directorySpread).toBe(1);
      expect(cm.concentrationRatio).toBe(1);
    }
  });

  it('Test 3: tangled directory — two communities in one folder', () => {
    // All files in src/ but two distinct groups of imports
    const entities = [
      entity('a1', 'src/login.ts'),
      entity('a2', 'src/logout.ts'),
      entity('a3', 'src/token.ts'),
      entity('b1', 'src/query.ts'),
      entity('b2', 'src/schema.ts'),
      entity('b3', 'src/migrate.ts'),
    ];
    const relationships = [
      // Group A: tightly connected
      rel('a1', 'a2'),
      rel('a2', 'a3'),
      rel('a3', 'a1'),
      // Group B: tightly connected
      rel('b1', 'b2'),
      rel('b2', 'b3'),
      rel('b3', 'b1'),
    ];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 1,
      tangledThreshold: 0.6,
    });

    // Two communities detected, both in one directory → tangled
    expect(result.tangledDirectories.length).toBeGreaterThanOrEqual(1);
    const tangled = result.tangledDirectories.find(
      (t) => t.directory === 'src',
    );
    expect(tangled).toBeDefined();
    expect(tangled!.communityCount).toBeGreaterThanOrEqual(2);
    expect(tangled!.dominantCommunityRatio).toBeLessThanOrEqual(0.6);
  });

  it('Test 4: misplaced file — one file in wrong directory', () => {
    // Three auth files, one data file that only imports from auth
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('a2', 'src/auth/logout.ts'),
      entity('a3', 'src/auth/token.ts'),
      entity('m1', 'src/data/auth-helper.ts'),
    ];
    const relationships = [
      // auth cluster
      rel('a1', 'a2'),
      rel('a2', 'a3'),
      rel('a3', 'a1'),
      // misplaced file connects to auth
      rel('m1', 'a1'),
      rel('m1', 'a2'),
      rel('a3', 'm1'),
    ];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
      minCommunitySize: 2,
    });

    // m1 should be flagged as misplaced
    expect(result.misplacedFiles.length).toBeGreaterThanOrEqual(1);
    const misplaced = result.misplacedFiles.find((f) => f.entityId === 'm1');
    expect(misplaced).toBeDefined();
    expect(misplaced!.currentDirectory).toBe('src/data');
    expect(misplaced!.suggestedDirectory).toBe('src/auth');
    expect(misplaced!.peersInSuggestedDir).toBeGreaterThan(
      misplaced!.peersInCurrentDir,
    );
  });

  it('Test 5: cross-reference matrix correctness', () => {
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('a2', 'src/auth/logout.ts'),
      entity('d1', 'src/data/query.ts'),
      entity('d2', 'src/data/schema.ts'),
    ];
    const relationships = [
      // auth → data: 2 refs
      rel('a1', 'd1'),
      rel('a2', 'd2'),
      // data → auth: 1 ref
      rel('d1', 'a1'),
    ];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
    });

    const { directories, matrix } = result.couplingMatrix;
    const authIdx = directories.indexOf('src/auth');
    const dataIdx = directories.indexOf('src/data');
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(dataIdx).toBeGreaterThanOrEqual(0);

    // auth → data = 2
    expect(matrix[authIdx][dataIdx]).toBe(2);
    // data → auth = 1
    expect(matrix[dataIdx][authIdx]).toBe(1);
    // self-refs = 0
    expect(matrix[authIdx][authIdx]).toBe(0);
    expect(matrix[dataIdx][dataIdx]).toBe(0);

    // Cross-references sorted by count descending
    expect(result.crossReferences[0].referenceCount).toBeGreaterThanOrEqual(
      result.crossReferences[result.crossReferences.length - 1].referenceCount,
    );
  });

  it('Test 6: isolated directory', () => {
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('a2', 'src/auth/logout.ts'),
      entity('d1', 'src/data/query.ts'),
      entity('u1', 'src/utils/helpers.ts'),
    ];
    // auth and data reference each other, utils is isolated
    const relationships = [rel('a1', 'd1'), rel('d1', 'a2')];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
    });

    expect(result.isolatedDirectories).toContain('src/utils');
    expect(result.isolatedDirectories).not.toContain('src/auth');
    expect(result.isolatedDirectories).not.toContain('src/data');
  });

  it('Test 7: auto-depth detection', () => {
    // Files at varying depths; auto should pick depth where ≥3 groups
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('a2', 'src/auth/logout.ts'),
      entity('d1', 'src/data/query.ts'),
      entity('u1', 'src/utils/helpers.ts'),
      entity('c1', 'src/core/engine.ts'),
    ];
    const relationships = [rel('a1', 'a2')];

    // No directoryDepth specified → auto-detect
    const result = calculateCoherence(entities, relationships);

    // Should have grouped at depth 2 (src/auth, src/data, src/utils, src/core = 4 groups ≥ 3)
    expect(result.directoryGroups.length).toBeGreaterThanOrEqual(3);
    // Verify actual directory paths
    const dirs = result.directoryGroups.map((g) => g.directory);
    expect(dirs).toContain('src/auth');
    expect(dirs).toContain('src/data');
    expect(dirs).toContain('src/utils');
    expect(dirs).toContain('src/core');
  });

  it('Test 8: empty input', () => {
    const result = calculateCoherence([], []);

    expect(result.overallCoherenceScore).toBe(1);
    expect(result.directoryGroups).toHaveLength(0);
    expect(result.crossReferences).toHaveLength(0);
    expect(result.communityMappings).toHaveLength(0);
    expect(result.misplacedFiles).toHaveLength(0);
    expect(result.tangledDirectories).toHaveLength(0);
    expect(result.isolatedDirectories).toHaveLength(0);
    expect(result.couplingMatrix.directories).toHaveLength(0);
    expect(result.couplingMatrix.matrix).toHaveLength(0);
  });

  it('filters out non-file entities', () => {
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('f1', 'src/auth/login.ts', { kind: 'function', name: 'doLogin' }),
      entity('c1', 'src/auth/login.ts', { kind: 'class', name: 'AuthService' }),
    ];
    const relationships = [rel('a1', 'f1')];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
    });

    // Only the file entity should be included in directory groups
    expect(result.directoryGroups).toHaveLength(1);
    expect(result.directoryGroups[0].fileCount).toBe(1);
  });

  it('filters out node_modules entities', () => {
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('n1', 'node_modules/lodash/index.ts'),
    ];
    const relationships = [rel('a1', 'n1')];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
    });

    const dirs = result.directoryGroups.map((g) => g.directory);
    expect(dirs).not.toContain('node_modules/lodash');
  });

  it('respects minGroupSize option', () => {
    const entities = [
      entity('a1', 'src/auth/login.ts'),
      entity('a2', 'src/auth/logout.ts'),
      entity('a3', 'src/auth/token.ts'),
      entity('u1', 'src/utils/helper.ts'),
    ];
    const relationships: Relationship[] = [];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
      minGroupSize: 2,
    });

    // src/utils only has 1 file → filtered out
    const dirs = result.directoryGroups.map((g) => g.directory);
    expect(dirs).toContain('src/auth');
    expect(dirs).not.toContain('src/utils');
  });

  it('normalizes backslash paths', () => {
    const entities = [
      entity('a1', 'src\\auth\\login.ts'),
      entity('a2', 'src\\auth\\logout.ts'),
    ];
    const relationships = [rel('a1', 'a2')];

    const result = calculateCoherence(entities, relationships, {
      directoryDepth: 2,
    });

    // Backslash paths contain '/' after normalization, so they pass the filter
    expect(result.directoryGroups).toHaveLength(1);
    expect(result.directoryGroups[0].directory).toBe('src/auth');
  });
});
