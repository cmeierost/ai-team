import { describe, it, expect } from 'vitest';
import {
  calculateCyclomatic,
  calculateCognitive,
  calculateHalstead,
  calculateComplexity,
  summarizeFileComplexity,
  type Entity,
} from './complexity.js';

// ── Cyclomatic Complexity ──

describe('calculateCyclomatic', () => {
  it('returns 1 for zero branch points', () => {
    expect(calculateCyclomatic(0)).toBe(1);
  });

  it('returns branchPoints + 1 for a simple function', () => {
    expect(calculateCyclomatic(3)).toBe(4);
  });

  it('returns branchPoints + 1 for a complex function', () => {
    expect(calculateCyclomatic(15)).toBe(16);
  });
});

// ── Cognitive Complexity ──

describe('calculateCognitive', () => {
  it('returns 0 for empty contributions', () => {
    expect(calculateCognitive([])).toBe(0);
  });

  it('sums increments for flat structure (all depth 0)', () => {
    const contributions = [
      { depth: 0, increment: 1 },
      { depth: 0, increment: 1 },
    ];
    expect(calculateCognitive(contributions)).toBe(2);
  });

  it('adds depth penalty for nested structure', () => {
    // (1+0) + (1+1) + (1+2) = 1 + 2 + 3 = 6
    const contributions = [
      { depth: 0, increment: 1 },
      { depth: 1, increment: 1 },
      { depth: 2, increment: 1 },
    ];
    expect(calculateCognitive(contributions)).toBe(6);
  });

  it('handles deep nesting', () => {
    // depth 5, increment 1 → 1 + 5 = 6
    expect(calculateCognitive([{ depth: 5, increment: 1 }])).toBe(6);
  });
});

// ── Halstead Metrics ──

describe('calculateHalstead', () => {
  it('computes correct metrics for a simple function', () => {
    const ops = { distinct: 5, total: 10 };
    const opnds = { distinct: 3, total: 8 };

    const h = calculateHalstead(ops, opnds);

    expect(h.vocabulary).toBe(8); // 5 + 3
    expect(h.length).toBe(18); // 10 + 8
    expect(h.volume).toBeCloseTo(18 * Math.log2(8), 10); // 18 * 3 = 54
    expect(h.difficulty).toBeCloseTo((5 / 2) * (8 / 3), 10); // 2.5 * 2.667 ≈ 6.667
    expect(h.effort).toBeCloseTo(h.difficulty * h.volume, 10);
    expect(h.time).toBeCloseTo(h.effort / 18, 10);
    expect(h.estimatedBugs).toBeCloseTo(h.volume / 3000, 10);
  });

  it('returns difficulty 0 when distinct operands is 0', () => {
    const h = calculateHalstead(
      { distinct: 4, total: 10 },
      { distinct: 0, total: 5 },
    );
    expect(h.difficulty).toBe(0);
    expect(h.effort).toBe(0);
    expect(Number.isFinite(h.difficulty)).toBe(true);
  });

  it('returns all zeros when everything is zero', () => {
    const h = calculateHalstead(
      { distinct: 0, total: 0 },
      { distinct: 0, total: 0 },
    );
    expect(h.vocabulary).toBe(0);
    expect(h.length).toBe(0);
    expect(h.volume).toBe(0);
    expect(h.difficulty).toBe(0);
    expect(h.effort).toBe(0);
    expect(h.time).toBe(0);
    expect(h.estimatedBugs).toBe(0);
  });

  it('matches a known hand-calculated example', () => {
    // Classic "swap" example: a = b; b = temp; temp = a;
    // operators: =, ; → distinct 2, total 6
    // operands: a, b, temp → distinct 3, total 6
    const h = calculateHalstead(
      { distinct: 2, total: 6 },
      { distinct: 3, total: 6 },
    );

    expect(h.vocabulary).toBe(5);
    expect(h.length).toBe(12);
    expect(h.volume).toBeCloseTo(12 * Math.log2(5), 6); // ≈ 27.863
    expect(h.difficulty).toBeCloseTo((2 / 2) * (6 / 3), 6); // 1 * 2 = 2
    expect(h.effort).toBeCloseTo(2 * 12 * Math.log2(5), 6);
    expect(h.time).toBeCloseTo(h.effort / 18, 6);
    expect(h.estimatedBugs).toBeCloseTo(h.volume / 3000, 6);
  });
});

// ── File Complexity Summaries ──

describe('summarizeFileComplexity', () => {
  it('returns matching summary for a single function in a file', () => {
    const entities: Entity[] = [
      { id: 'fn1', kind: 'function', name: 'foo', filePath: 'a.ts' },
    ];
    const cyclomatic = [{ entityId: 'fn1', cyclomaticComplexity: 5 }];
    const cognitive = [{ entityId: 'fn1', cognitiveComplexity: 8 }];

    const [summary] = summarizeFileComplexity(entities, cyclomatic, cognitive);

    expect(summary.filePath).toBe('a.ts');
    expect(summary.functionCount).toBe(1);
    expect(summary.maxCyclomatic).toBe(5);
    expect(summary.avgCyclomatic).toBe(5);
    expect(summary.totalCyclomatic).toBe(5);
    expect(summary.maxCognitive).toBe(8);
    expect(summary.avgCognitive).toBe(8);
    expect(summary.totalCognitive).toBe(8);
  });

  it('aggregates multiple functions correctly', () => {
    const entities: Entity[] = [
      { id: 'fn1', kind: 'function', name: 'a', filePath: 'b.ts' },
      { id: 'fn2', kind: 'method', name: 'b', filePath: 'b.ts' },
      { id: 'fn3', kind: 'function', name: 'c', filePath: 'b.ts' },
    ];
    const cyclomatic = [
      { entityId: 'fn1', cyclomaticComplexity: 2 },
      { entityId: 'fn2', cyclomaticComplexity: 10 },
      { entityId: 'fn3', cyclomaticComplexity: 6 },
    ];
    const cognitive = [
      { entityId: 'fn1', cognitiveComplexity: 1 },
      { entityId: 'fn2', cognitiveComplexity: 15 },
      { entityId: 'fn3', cognitiveComplexity: 5 },
    ];

    const [summary] = summarizeFileComplexity(entities, cyclomatic, cognitive);

    expect(summary.functionCount).toBe(3);
    expect(summary.maxCyclomatic).toBe(10);
    expect(summary.avgCyclomatic).toBeCloseTo(18 / 3);
    expect(summary.totalCyclomatic).toBe(18);
    expect(summary.maxCognitive).toBe(15);
    expect(summary.avgCognitive).toBeCloseTo(21 / 3);
    expect(summary.totalCognitive).toBe(21);
  });

  it('returns zeros for a file with no function entities', () => {
    const entities: Entity[] = [
      { id: 'cls1', kind: 'class', name: 'MyClass', filePath: 'c.ts' },
    ];

    const [summary] = summarizeFileComplexity(entities, [], []);

    expect(summary.filePath).toBe('c.ts');
    expect(summary.functionCount).toBe(0);
    expect(summary.maxCyclomatic).toBe(0);
    expect(summary.totalCyclomatic).toBe(0);
    expect(summary.avgCyclomatic).toBe(0);
    expect(summary.maxCognitive).toBe(0);
    expect(summary.totalCognitive).toBe(0);
    expect(summary.avgCognitive).toBe(0);
  });

  it('counts only function-like kinds', () => {
    const entities: Entity[] = [
      { id: 'fn1', kind: 'function', name: 'a', filePath: 'd.ts' },
      { id: 'cls1', kind: 'class', name: 'B', filePath: 'd.ts' },
      { id: 'mt1', kind: 'method', name: 'c', filePath: 'd.ts' },
      { id: 'mod1', kind: 'module', name: 'D', filePath: 'd.ts' },
      { id: 'ar1', kind: 'arrow-function', name: 'e', filePath: 'd.ts' },
    ];
    const cyclomatic = [
      { entityId: 'fn1', cyclomaticComplexity: 3 },
      { entityId: 'mt1', cyclomaticComplexity: 7 },
      { entityId: 'ar1', cyclomaticComplexity: 1 },
    ];
    const cognitive = [
      { entityId: 'fn1', cognitiveComplexity: 2 },
      { entityId: 'mt1', cognitiveComplexity: 10 },
      { entityId: 'ar1', cognitiveComplexity: 0 },
    ];

    const [summary] = summarizeFileComplexity(entities, cyclomatic, cognitive);

    expect(summary.functionCount).toBe(3);
    expect(summary.maxCyclomatic).toBe(7);
    expect(summary.totalCyclomatic).toBe(11);
  });
});

// ── Integration: calculateComplexity ──

describe('calculateComplexity', () => {
  it('processes mixed entities and skips those without rawCounts', () => {
    const entities: Entity[] = [
      {
        id: 'fn1',
        kind: 'function',
        name: 'simple',
        filePath: 'file.ts',
        rawCounts: {
          branchPoints: 3,
          nestingContributions: [
            { depth: 0, increment: 1 },
            { depth: 1, increment: 1 },
          ],
          operators: { distinct: 5, total: 10 },
          operands: { distinct: 3, total: 8 },
        },
      },
      {
        id: 'fn2',
        kind: 'function',
        name: 'noData',
        filePath: 'file.ts',
        rawCounts: null,
      },
      {
        id: 'fn3',
        kind: 'method',
        name: 'partial',
        filePath: 'file.ts',
        rawCounts: {
          branchPoints: 0,
        },
      },
      {
        id: 'cls1',
        kind: 'class',
        name: 'MyClass',
        filePath: 'file.ts',
      },
    ];

    const result = calculateComplexity(entities);

    // Cyclomatic: fn1 (4) and fn3 (1)
    expect(result.cyclomatic).toHaveLength(2);
    expect(result.cyclomatic[0]).toEqual({
      entityId: 'fn1',
      cyclomaticComplexity: 4,
    });
    expect(result.cyclomatic[1]).toEqual({
      entityId: 'fn3',
      cyclomaticComplexity: 1,
    });

    // Cognitive: fn1 only (1+0 + 1+1 = 3)
    expect(result.cognitive).toHaveLength(1);
    expect(result.cognitive[0]).toEqual({
      entityId: 'fn1',
      cognitiveComplexity: 3,
    });

    // Halstead: fn1 only
    expect(result.halstead).toHaveLength(1);
    expect(result.halstead[0].entityId).toBe('fn1');
    expect(result.halstead[0].halstead.vocabulary).toBe(8);

    // File summaries: one file with 2 function-like entities (fn1, fn3)
    // cls1 is not function-like, fn2 has null rawCounts but is still a "function" kind
    expect(result.fileSummaries).toHaveLength(1);
    const summary = result.fileSummaries[0];
    expect(summary.filePath).toBe('file.ts');
    expect(summary.functionCount).toBe(3); // fn1, fn2, fn3 are all function/method kinds
    expect(summary.maxCyclomatic).toBe(4);
  });

  it('handles entities with undefined rawCounts', () => {
    const entities: Entity[] = [
      { id: 'fn1', kind: 'function', name: 'x', filePath: 'a.ts' },
    ];

    const result = calculateComplexity(entities);

    expect(result.cyclomatic).toHaveLength(0);
    expect(result.cognitive).toHaveLength(0);
    expect(result.halstead).toHaveLength(0);
    expect(result.fileSummaries).toHaveLength(1);
    expect(result.fileSummaries[0].functionCount).toBe(1);
    expect(result.fileSummaries[0].maxCyclomatic).toBe(0);
  });
});
