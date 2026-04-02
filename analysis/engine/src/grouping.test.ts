import { describe, it, expect } from 'vitest';
import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';
import {
  buildReferenceGrouping,
  buildDirectoryGrouping,
  buildBoundaryGrouping,
  buildCustomGrouping,
  compareGroupings,
  matchFileList,
} from './grouping.js';
import type { Grouping } from './grouping.js';

// ── Helpers ─────────────────────────────────────────────────────────────

const fileEntity = (id: string, filePath: string): Entity =>
  ({
    id,
    kind: 'file',
    name: filePath.split('/').pop()!,
    filePath,
    language: 'typescript',
    sourceRange: { startLine: 1, startColumn: 0, endLine: 50, endColumn: 0 },
    rawCounts: null,
    methodFieldAccessMatrix: null,
    typeCheckingPatterns: null,
    extensionPoints: null,
    overriddenMethods: null,
  }) as unknown as Entity;

const rel = (source: string, target: string): Relationship =>
  ({
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
  }) as Relationship;

// ── buildReferenceGrouping ──────────────────────────────────────────────

describe('buildReferenceGrouping', () => {
  it('creates groups from dependency communities', () => {
    const entities = [
      fileEntity('a', 'src/auth/login.ts'),
      fileEntity('b', 'src/auth/logout.ts'),
      fileEntity('c', 'src/db/query.ts'),
      fileEntity('d', 'src/db/connect.ts'),
    ];
    const relationships = [rel('a', 'b'), rel('b', 'a'), rel('c', 'd'), rel('d', 'c')];

    const grouping = buildReferenceGrouping(entities, relationships);

    expect(grouping.id).toBe('reference');
    expect(grouping.kind).toBe('reference');
    expect(grouping.groups.length).toBeGreaterThanOrEqual(1);
    // All entities should appear somewhere
    const allMembers = grouping.groups.flatMap((g) => g.memberEntityIds);
    expect(new Set(allMembers)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('filters out node_modules and bare-name entities', () => {
    const entities = [
      fileEntity('a', 'src/app.ts'),
      fileEntity('b', 'node_modules/lodash/index.ts'),
      fileEntity('c', 'fs'), // bare name
      fileEntity('d', 'path'), // bare name
    ];
    const relationships = [rel('a', 'b')];

    const grouping = buildReferenceGrouping(entities, relationships);

    const allMembers = grouping.groups.flatMap((g) => g.memberEntityIds);
    expect(allMembers).toContain('a');
    expect(allMembers).not.toContain('b');
    expect(allMembers).not.toContain('c');
    expect(allMembers).not.toContain('d');
  });

  it('returns empty grouping for empty input', () => {
    const grouping = buildReferenceGrouping([], []);
    expect(grouping.groups).toEqual([]);
  });
});

// ── buildDirectoryGrouping ──────────────────────────────────────────────

describe('buildDirectoryGrouping', () => {
  it('groups by directory at auto-detected depth', () => {
    const entities = [
      fileEntity('a', 'src/auth/login.ts'),
      fileEntity('b', 'src/auth/logout.ts'),
      fileEntity('c', 'src/db/query.ts'),
      fileEntity('d', 'src/api/routes.ts'),
    ];

    const grouping = buildDirectoryGrouping(entities);

    expect(grouping.kind).toBe('directory');
    expect(grouping.groups.length).toBeGreaterThanOrEqual(2);
    // auth files should be in same group
    const authGroup = grouping.groups.find((g) =>
      g.memberEntityIds.includes('a') && g.memberEntityIds.includes('b'),
    );
    expect(authGroup).toBeDefined();
  });

  it('groups by directory at specified depth', () => {
    const entities = [
      fileEntity('a', 'src/auth/login.ts'),
      fileEntity('b', 'src/auth/logout.ts'),
      fileEntity('c', 'src/db/query.ts'),
    ];

    const grouping = buildDirectoryGrouping(entities, 1);

    // At depth 1, everything is under 'src'
    expect(grouping.groups.length).toBe(1);
    expect(grouping.groups[0].memberEntityIds).toHaveLength(3);
  });

  it('handles backslash paths', () => {
    const entities = [
      fileEntity('a', 'src\\auth\\login.ts'),
      fileEntity('b', 'src\\db\\query.ts'),
    ];

    const grouping = buildDirectoryGrouping(entities, 2);

    expect(grouping.groups.length).toBe(2);
  });
});

// ── buildCustomGrouping ─────────────────────────────────────────────────

describe('buildCustomGrouping', () => {
  it('maps file paths to entity IDs', () => {
    const entities = [
      fileEntity('a', 'src/auth/login.ts'),
      fileEntity('b', 'src/db/query.ts'),
      fileEntity('c', 'src/api/routes.ts'),
    ];

    const grouping = buildCustomGrouping(
      'my-grouping',
      'My Grouping',
      [
        { id: 'auth', label: 'Auth', files: ['src/auth/login.ts'] },
        { id: 'data', label: 'Data', files: ['src/db/query.ts', 'src/api/routes.ts'] },
      ],
      entities,
    );

    expect(grouping.kind).toBe('custom');
    expect(grouping.groups).toHaveLength(2);
    expect(grouping.groups[0].memberEntityIds).toEqual(['a']);
    expect(grouping.groups[1].memberEntityIds).toEqual(['b', 'c']);
  });

  it('handles path normalization (backslash/forward slash)', () => {
    const entities = [fileEntity('a', 'src/auth/login.ts')];

    const grouping = buildCustomGrouping(
      'test',
      'Test',
      [{ id: 'g1', label: 'G1', files: ['src\\auth\\login.ts'] }],
      entities,
    );

    expect(grouping.groups[0].memberEntityIds).toEqual(['a']);
  });
});

// ── buildBoundaryGrouping ───────────────────────────────────────────────

describe('buildBoundaryGrouping', () => {
  it('creates groups from module boundaries', () => {
    const entities = [
      fileEntity('a', 'src/auth/login.ts'),
      fileEntity('b', 'src/db/query.ts'),
    ];
    const boundaries: ModuleBoundary[] = [
      {
        moduleId: 'auth',
        modulePath: 'src/auth',
        files: ['src/auth/login.ts'],
        declaredLayer: null,
        isPackage: false,
        kind: 'directory',
      },
      {
        moduleId: 'db',
        modulePath: 'src/db',
        files: ['src/db/query.ts'],
        declaredLayer: null,
        isPackage: false,
        kind: 'directory',
      },
    ];

    const grouping = buildBoundaryGrouping(entities, boundaries);

    expect(grouping.kind).toBe('directory');
    expect(grouping.groups).toHaveLength(2);
    expect(grouping.groups[0].memberEntityIds).toEqual(['a']);
    expect(grouping.groups[1].memberEntityIds).toEqual(['b']);
  });
});

// ── compareGroupings ────────────────────────────────────────────────────

describe('compareGroupings', () => {
  const entities = [
    fileEntity('a', 'src/auth/login.ts'),
    fileEntity('b', 'src/auth/logout.ts'),
    fileEntity('c', 'src/db/query.ts'),
    fileEntity('d', 'src/db/connect.ts'),
  ];

  it('identical groupings → ARI = 1.0, NMI = 1.0, zero mismatches', () => {
    const grouping: Grouping = {
      id: 'g1',
      label: 'G1',
      kind: 'custom',
      groups: [
        { id: 'auth', label: 'Auth', memberEntityIds: ['a', 'b'] },
        { id: 'db', label: 'DB', memberEntityIds: ['c', 'd'] },
      ],
    };

    const result = compareGroupings(grouping, grouping, entities);

    expect(result.similarityScore).toBeCloseTo(1.0);
    expect(result.nmi).toBeCloseTo(1.0);
    expect(result.mismatches).toHaveLength(0);
  });

  it('completely different groupings → low ARI and NMI', () => {
    const source: Grouping = {
      id: 'source',
      label: 'Source',
      kind: 'custom',
      groups: [
        { id: 'g1', label: 'G1', memberEntityIds: ['a', 'b'] },
        { id: 'g2', label: 'G2', memberEntityIds: ['c', 'd'] },
      ],
    };
    const target: Grouping = {
      id: 'target',
      label: 'Target',
      kind: 'custom',
      groups: [
        { id: 'g3', label: 'G3', memberEntityIds: ['a', 'c'] },
        { id: 'g4', label: 'G4', memberEntityIds: ['b', 'd'] },
      ],
    };

    const result = compareGroupings(source, target, entities);

    expect(result.similarityScore).toBeLessThan(0.5);
    expect(result.nmi).toBeLessThan(0.5);
  });

  it('partial overlap → intermediate scores, mismatches detected', () => {
    // Use more entities for meaningful ARI
    const moreEntities = [
      fileEntity('a', 'src/auth/login.ts'),
      fileEntity('b', 'src/auth/logout.ts'),
      fileEntity('c', 'src/db/query.ts'),
      fileEntity('d', 'src/db/connect.ts'),
      fileEntity('e', 'src/api/routes.ts'),
      fileEntity('f', 'src/api/handler.ts'),
    ];
    const source: Grouping = {
      id: 'source',
      label: 'Source',
      kind: 'custom',
      groups: [
        { id: 'g1', label: 'G1', memberEntityIds: ['a', 'b', 'c'] },
        { id: 'g2', label: 'G2', memberEntityIds: ['d', 'e', 'f'] },
      ],
    };
    const target: Grouping = {
      id: 'target',
      label: 'Target',
      kind: 'custom',
      groups: [
        { id: 'g3', label: 'G3', memberEntityIds: ['a', 'b'] },
        { id: 'g4', label: 'G4', memberEntityIds: ['c', 'd', 'e', 'f'] },
      ],
    };

    const result = compareGroupings(source, target, moreEntities);

    expect(result.similarityScore).toBeGreaterThan(0);
    expect(result.similarityScore).toBeLessThan(1);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });

  it('suggestions generated for mismatched files', () => {
    const source: Grouping = {
      id: 'source',
      label: 'Source',
      kind: 'custom',
      groups: [
        { id: 'g1', label: 'G1', memberEntityIds: ['a', 'b'] },
        { id: 'g2', label: 'G2', memberEntityIds: ['c', 'd'] },
      ],
    };
    const target: Grouping = {
      id: 'target',
      label: 'Target',
      kind: 'custom',
      groups: [
        { id: 'g3', label: 'G3', memberEntityIds: ['a', 'c'] },
        { id: 'g4', label: 'G4', memberEntityIds: ['b', 'd'] },
      ],
    };

    const result = compareGroupings(source, target, entities);

    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const s of result.suggestions) {
      expect(s.entityId).toBeTruthy();
      expect(s.reason).toBeTruthy();
      expect(s.impactEstimate).toBeGreaterThan(0);
    }
  });

  it('empty groupings → score 1.0', () => {
    const empty: Grouping = {
      id: 'empty',
      label: 'Empty',
      kind: 'custom',
      groups: [],
    };

    const result = compareGroupings(empty, empty, []);

    expect(result.similarityScore).toBe(1.0);
    expect(result.nmi).toBe(1.0);
    expect(result.mismatches).toHaveLength(0);
  });
});

// ── matchFileList ───────────────────────────────────────────────────────

describe('matchFileList', () => {
  const entities = [
    fileEntity('a', 'src/auth/login.ts'),
    fileEntity('b', 'src/auth/logout.ts'),
    fileEntity('c', 'src/db/query.ts'),
    fileEntity('d', 'src/db/connect.ts'),
  ];

  const grouping: Grouping = {
    id: 'test',
    label: 'Test',
    kind: 'custom',
    groups: [
      { id: 'auth', label: 'Auth', memberEntityIds: ['a', 'b'] },
      { id: 'db', label: 'DB', memberEntityIds: ['c', 'd'] },
    ],
  };

  it('perfect match → jaccard = 1.0, coverage = 1.0, purity = 1.0', () => {
    const result = matchFileList(
      ['src/auth/login.ts', 'src/auth/logout.ts'],
      grouping,
      entities,
    );

    expect(result.bestMatchGroupId).toBe('auth');
    expect(result.bestMatchJaccard).toBeCloseTo(1.0);
    expect(result.coverage).toBeCloseTo(1.0);
    expect(result.purity).toBeCloseTo(1.0);
    expect(result.outliers).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it('partial match → correct coverage/purity, outliers/missing listed', () => {
    const result = matchFileList(
      ['src/auth/login.ts', 'src/db/query.ts'],
      grouping,
      entities,
    );

    // Best match depends on which group has higher jaccard
    expect(result.bestMatchJaccard).toBeGreaterThan(0);
    expect(result.bestMatchJaccard).toBeLessThan(1);
    expect(result.outliers.length).toBeGreaterThan(0);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('no match → jaccard = 0', () => {
    const result = matchFileList(
      ['src/unknown/file.ts'],
      grouping,
      entities,
    );

    expect(result.bestMatchJaccard).toBe(0);
    expect(result.coverage).toBe(0);
    expect(result.purity).toBe(0);
  });

  it('all group matches sorted by jaccard', () => {
    const result = matchFileList(
      ['src/auth/login.ts'],
      grouping,
      entities,
    );

    expect(result.allGroupMatches.length).toBe(2);
    for (let i = 1; i < result.allGroupMatches.length; i++) {
      expect(result.allGroupMatches[i - 1].jaccard).toBeGreaterThanOrEqual(
        result.allGroupMatches[i].jaccard,
      );
    }
  });
});
