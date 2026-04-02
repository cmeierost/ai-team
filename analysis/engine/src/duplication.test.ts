import { describe, it, expect } from 'vitest';
import type {
  DuplicationSignal,
  Clone,
  Entity,
  ModuleBoundary,
} from '@aspect/contracts';
import { calculateDuplication } from './duplication.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFileEntity(filePath: string, linesOfCode: number | null): Entity {
  return {
    id: `file:${filePath}`,
    kind: 'file',
    name: filePath.split('/').pop() ?? filePath,
    filePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: linesOfCode ?? 1, endColumn: 0 },
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: false,
      isTypeOnly: false,
      isExported: false,
      visibility: null,
    },
    rawCounts: linesOfCode != null ? { linesOfCode } : null,
  };
}

function makeClone(
  id: string,
  firstFile: { filePath: string; startLine: number; endLine: number },
  secondFile: { filePath: string; startLine: number; endLine: number },
): Clone {
  return {
    id,
    format: 'text',
    tokenCount: 100,
    lineCount: firstFile.endLine - firstFile.startLine + 1,
    firstFile: {
      filePath: firstFile.filePath,
      startLine: firstFile.startLine,
      endLine: firstFile.endLine,
    },
    secondFile: {
      filePath: secondFile.filePath,
      startLine: secondFile.startLine,
      endLine: secondFile.endLine,
    },
  };
}

function makeDuplicationSignal(
  clones: Clone[],
  statistics?: Partial<DuplicationSignal['statistics']>,
): DuplicationSignal {
  return {
    source: { tool: 'jscpd', version: '4.0.0' },
    clones,
    statistics: {
      totalLines: 1000,
      totalTokens: 5000,
      totalSources: 10,
      duplicatedLines: 0,
      duplicatedTokens: 0,
      ...statistics,
    },
  };
}

function makeModuleBoundary(
  moduleId: string,
  modulePath: string,
  files: string[] = [],
): ModuleBoundary {
  return { moduleId, modulePath, files, declaredLayer: null, isPackage: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculateDuplication', () => {
  // ------ Test 1 ------
  it('returns zero percentages when there are no clones', () => {
    const entities = [makeFileEntity('src/a.ts', 100)];
    const result = calculateDuplication([], entities, []);

    expect(result.project.totalClones).toBe(0);
    expect(result.project.duplicationPercentage).toBe(0);
    expect(result.project.totalLines).toBe(0);
    expect(result.crossModule).toEqual([]);
    expect(result.hotspots).toEqual([]);
  });

  // ------ Test 2 ------
  it('calculates per-file duplication for a single clone pair', () => {
    const entities = [
      makeFileEntity('src/a.ts', 100),
      makeFileEntity('src/b.ts', 200),
    ];
    const clone = makeClone(
      'c1',
      { filePath: 'src/a.ts', startLine: 10, endLine: 20 },
      { filePath: 'src/b.ts', startLine: 30, endLine: 40 },
    );
    const signal = makeDuplicationSignal([clone], {
      duplicatedLines: 22,
      totalLines: 300,
    });
    const result = calculateDuplication([signal], entities, []);

    const fileA = result.files.find((f) => f.filePath === 'src/a.ts')!;
    expect(fileA.duplicatedLines).toBe(11); // lines 10..20
    expect(fileA.totalLines).toBe(100);
    expect(fileA.duplicationPercentage).toBe(11);
    expect(fileA.cloneCount).toBe(1);

    const fileB = result.files.find((f) => f.filePath === 'src/b.ts')!;
    expect(fileB.duplicatedLines).toBe(11); // lines 30..40
    expect(fileB.totalLines).toBe(200);
    expect(fileB.duplicationPercentage).toBe(5.5);
    expect(fileB.cloneCount).toBe(1);
  });

  // ------ Test 3 ------
  it('counts overlapping clone ranges without double-counting', () => {
    const entities = [
      makeFileEntity('src/a.ts', 100),
      makeFileEntity('src/b.ts', 100),
      makeFileEntity('src/c.ts', 100),
    ];
    const clone1 = makeClone(
      'c1',
      { filePath: 'src/a.ts', startLine: 10, endLine: 20 },
      { filePath: 'src/b.ts', startLine: 1, endLine: 11 },
    );
    const clone2 = makeClone(
      'c2',
      { filePath: 'src/a.ts', startLine: 15, endLine: 25 },
      { filePath: 'src/c.ts', startLine: 1, endLine: 11 },
    );
    const signal = makeDuplicationSignal([clone1, clone2]);
    const result = calculateDuplication([signal], entities, []);

    const fileA = result.files.find((f) => f.filePath === 'src/a.ts')!;
    expect(fileA.duplicatedLines).toBe(16); // lines 10..25 = 16 unique
    expect(fileA.cloneCount).toBe(2);
  });

  // ------ Test 4 ------
  it('detects cross-module duplication', () => {
    const entities = [
      makeFileEntity('src/moduleA/a.ts', 100),
      makeFileEntity('src/moduleB/b.ts', 100),
    ];
    const boundaries = [
      makeModuleBoundary('modA', 'src/moduleA/'),
      makeModuleBoundary('modB', 'src/moduleB/'),
    ];
    const clone = makeClone(
      'c1',
      { filePath: 'src/moduleA/a.ts', startLine: 1, endLine: 10 },
      { filePath: 'src/moduleB/b.ts', startLine: 1, endLine: 10 },
    );
    const signal = makeDuplicationSignal([clone]);
    const result = calculateDuplication([signal], entities, boundaries);

    expect(result.crossModule).toHaveLength(1);
    expect(result.crossModule[0].cloneCount).toBe(1);
    expect(result.crossModule[0].totalDuplicatedLines).toBe(20);
  });

  // ------ Test 5 ------
  it('excludes same-module clones from cross-module results', () => {
    const entities = [
      makeFileEntity('src/moduleA/a.ts', 100),
      makeFileEntity('src/moduleA/b.ts', 100),
    ];
    const boundaries = [makeModuleBoundary('modA', 'src/moduleA/')];
    const clone = makeClone(
      'c1',
      { filePath: 'src/moduleA/a.ts', startLine: 1, endLine: 10 },
      { filePath: 'src/moduleA/b.ts', startLine: 1, endLine: 10 },
    );
    const signal = makeDuplicationSignal([clone]);
    const result = calculateDuplication([signal], entities, boundaries);

    expect(result.crossModule).toHaveLength(0);
  });

  // ------ Test 6 ------
  it('returns hotspots sorted by duplication percentage descending', () => {
    const entities = [
      makeFileEntity('src/a.ts', 100),
      makeFileEntity('src/b.ts', 50),
      makeFileEntity('src/c.ts', 200),
    ];
    const clones = [
      makeClone(
        'c1',
        { filePath: 'src/a.ts', startLine: 1, endLine: 10 },
        { filePath: 'src/b.ts', startLine: 1, endLine: 10 },
      ),
      makeClone(
        'c2',
        { filePath: 'src/b.ts', startLine: 20, endLine: 30 },
        { filePath: 'src/c.ts', startLine: 1, endLine: 11 },
      ),
    ];
    const signal = makeDuplicationSignal(clones);
    const result = calculateDuplication([signal], entities, []);

    // b: (10+11)/50 = 42%, a: 10/100 = 10%, c: 11/200 = 5.5%
    expect(result.hotspots).toHaveLength(3);
    expect(result.hotspots[0].filePath).toBe('src/b.ts');
    expect(result.hotspots[1].filePath).toBe('src/a.ts');
    expect(result.hotspots[2].filePath).toBe('src/c.ts');
  });

  // ------ Test 7 ------
  it('uses signal statistics for project-level results', () => {
    const signal = makeDuplicationSignal([], {
      totalLines: 5000,
      duplicatedLines: 500,
    });
    const result = calculateDuplication([signal], [], []);

    expect(result.project.totalLines).toBe(5000);
    expect(result.project.duplicatedLines).toBe(500);
    expect(result.project.duplicationPercentage).toBe(10);
    expect(result.project.totalClones).toBe(0);
  });

  // ------ Test 8 ------
  it('handles files without entity LOC gracefully', () => {
    const clone = makeClone(
      'c1',
      { filePath: 'src/unknown.ts', startLine: 1, endLine: 10 },
      { filePath: 'src/other.ts', startLine: 1, endLine: 10 },
    );
    const signal = makeDuplicationSignal([clone]);
    const result = calculateDuplication([signal], [], []);

    const file = result.files.find((f) => f.filePath === 'src/unknown.ts')!;
    expect(file.duplicatedLines).toBe(10);
    expect(file.totalLines).toBe(0);
    expect(file.duplicationPercentage).toBe(0); // can't calculate without total
  });

  // ------ Test 19 (integration) ------
  it('calculates complete duplication results with multiple signals and modules', () => {
    const entities = [
      makeFileEntity('src/core/utils.ts', 200),
      makeFileEntity('src/core/types.ts', 150),
      makeFileEntity('src/api/handler.ts', 300),
      makeFileEntity('src/api/routes.ts', 100),
    ];
    const boundaries = [
      makeModuleBoundary('core', 'src/core/'),
      makeModuleBoundary('api', 'src/api/'),
    ];
    const signal = makeDuplicationSignal(
      [
        makeClone(
          'c1',
          { filePath: 'src/core/utils.ts', startLine: 10, endLine: 30 },
          { filePath: 'src/api/handler.ts', startLine: 50, endLine: 70 },
        ),
        makeClone(
          'c2',
          { filePath: 'src/core/utils.ts', startLine: 25, endLine: 40 },
          { filePath: 'src/core/types.ts', startLine: 1, endLine: 16 },
        ),
      ],
      {
        totalLines: 750,
        duplicatedLines: 75,
        totalSources: 4,
        totalTokens: 3000,
        duplicatedTokens: 300,
      },
    );

    const result = calculateDuplication([signal], entities, boundaries);

    // Project level
    expect(result.project.totalLines).toBe(750);
    expect(result.project.duplicatedLines).toBe(75);
    expect(result.project.totalClones).toBe(2);

    // utils.ts: L10-L30 ∪ L25-L40 = L10-L40 = 31 unique lines
    const utils = result.files.find((f) => f.filePath === 'src/core/utils.ts')!;
    expect(utils.duplicatedLines).toBe(31);
    expect(utils.duplicationPercentage).toBeCloseTo(15.5);

    // types.ts: L1-L16 = 16 lines, 16/150 ≈ 10.67%
    const types = result.files.find((f) => f.filePath === 'src/core/types.ts')!;
    expect(types.duplicatedLines).toBe(16);
    expect(types.duplicationPercentage).toBeCloseTo(10.667, 1);

    // handler.ts: L50-L70 = 21 lines, 21/300 = 7%
    const handler = result.files.find((f) => f.filePath === 'src/api/handler.ts')!;
    expect(handler.duplicatedLines).toBe(21);
    expect(handler.duplicationPercentage).toBeCloseTo(7);

    // Cross-module: only c1 crosses api↔core
    expect(result.crossModule).toHaveLength(1);
    expect(result.crossModule[0].cloneCount).toBe(1);

    // Hotspots ordered by %
    expect(result.hotspots.length).toBeGreaterThan(0);
    expect(result.hotspots[0].duplicationPercentage).toBeGreaterThanOrEqual(
      result.hotspots[result.hotspots.length - 1].duplicationPercentage,
    );
  });
});
