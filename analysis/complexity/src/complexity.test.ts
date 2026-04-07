import { describe, it, expect } from 'vitest';
import {
  calculateMaintainabilityIndex,
  miRiskBand,
  calculateMaintainability,
  calculateCyclomatic,
  calculateHalstead,
  type Entity,
} from './complexity.js';

describe('calculateMaintainabilityIndex', () => {
  it('returns 100 for trivial code (low volume, low complexity, low LOC)', () => {
    // HV=1, CC=1, LOC=1 → raw ≈ 171 → MI ≈ 100
    const mi = calculateMaintainabilityIndex(1, 1, 1);
    expect(mi).toBeGreaterThan(95);
    expect(mi).toBeLessThanOrEqual(100);
  });

  it('returns 0 for extremely complex code', () => {
    // HV=1e12, CC=200, LOC=10000 → MI clamps to 0
    const mi = calculateMaintainabilityIndex(1e12, 200, 10000);
    expect(mi).toBe(0);
  });

  it('returns a moderate score for typical functions', () => {
    // Typical function: HV=300, CC=5, LOC=30
    const mi = calculateMaintainabilityIndex(300, 5, 30);
    expect(mi).toBeGreaterThan(20); // green zone
    expect(mi).toBeLessThan(80);
  });

  it('handles edge case of zero inputs gracefully', () => {
    // ln(0) would be -Infinity; formula floors inputs to 1
    const mi = calculateMaintainabilityIndex(0, 0, 0);
    expect(mi).toBeGreaterThan(0);
    expect(Number.isFinite(mi)).toBe(true);
  });

  it('matches the VS formula for known inputs', () => {
    // HV=100, CC=10, LOC=50
    // raw = 171 - 5.2*ln(100) - 0.23*10 - 16.2*ln(50)
    //      = 171 - 5.2*4.605 - 2.3 - 16.2*3.912
    //      = 171 - 23.946 - 2.3 - 63.374
    //      ≈ 81.38
    // MI = 81.38 * 100 / 171 ≈ 47.59
    const mi = calculateMaintainabilityIndex(100, 10, 50);
    expect(mi).toBeCloseTo(47.59, 0);
  });
});

describe('miRiskBand', () => {
  it('returns red for 0-9', () => {
    expect(miRiskBand(0)).toBe('red');
    expect(miRiskBand(5)).toBe('red');
    expect(miRiskBand(9.99)).toBe('red');
  });

  it('returns yellow for 10-19', () => {
    expect(miRiskBand(10)).toBe('yellow');
    expect(miRiskBand(15)).toBe('yellow');
    expect(miRiskBand(19.99)).toBe('yellow');
  });

  it('returns green for 20-100', () => {
    expect(miRiskBand(20)).toBe('green');
    expect(miRiskBand(50)).toBe('green');
    expect(miRiskBand(100)).toBe('green');
  });
});

describe('calculateMaintainability', () => {
  function makeEntity(id: string, filePath: string, kind: string, loc: number, branchPoints: number, operators: { distinct: number; total: number }, operands: { distinct: number; total: number }): Entity {
    return {
      id,
      kind,
      name: id,
      filePath,
      sourceRange: { startLine: 1, startColumn: 0, endLine: loc, endColumn: 0 },
      rawCounts: { linesOfCode: loc, branchPoints, operators, operands },
    };
  }

  it('computes MI for function-like entities and aggregates per file', () => {
    const entities: Entity[] = [
      makeEntity('fn1', 'a.ts', 'function', 30, 3, { distinct: 8, total: 20 }, { distinct: 10, total: 25 }),
      makeEntity('fn2', 'a.ts', 'function', 50, 8, { distinct: 12, total: 40 }, { distinct: 15, total: 50 }),
      makeEntity('fn3', 'b.ts', 'function', 10, 1, { distinct: 4, total: 8 }, { distinct: 5, total: 10 }),
    ];

    const cc = entities.map(e => ({
      entityId: e.id,
      cyclomaticComplexity: calculateCyclomatic(e.rawCounts!.branchPoints!),
    }));
    const halstead = entities.map(e => ({
      entityId: e.id,
      halstead: calculateHalstead(e.rawCounts!.operators!, e.rawCounts!.operands!),
    }));

    const result = calculateMaintainability(entities, cc, halstead);

    expect(result.entities).toHaveLength(3);
    expect(result.fileSummaries).toHaveLength(2);

    // All should be in green zone for reasonable functions
    for (const r of result.entities) {
      expect(r.maintainabilityIndex).toBeGreaterThan(0);
      expect(r.maintainabilityIndex).toBeLessThanOrEqual(100);
      expect(['green', 'yellow', 'red']).toContain(r.riskBand);
    }

    // File summary for a.ts should have 2 entities
    const aFile = result.fileSummaries.find(f => f.filePath === 'a.ts');
    expect(aFile).toBeDefined();
    expect(aFile!.entityCount).toBe(2);
    expect(aFile!.minMI).toBeLessThanOrEqual(aFile!.avgMI);

    // File summary for b.ts should have 1 entity
    const bFile = result.fileSummaries.find(f => f.filePath === 'b.ts');
    expect(bFile).toBeDefined();
    expect(bFile!.entityCount).toBe(1);
  });

  it('skips non-function entities', () => {
    const entities: Entity[] = [
      { id: 'cls1', kind: 'class', name: 'Foo', filePath: 'a.ts', rawCounts: { linesOfCode: 100 } },
      { id: 'iface1', kind: 'interface', name: 'Bar', filePath: 'a.ts' },
    ];

    const result = calculateMaintainability(entities, [], []);
    expect(result.entities).toHaveLength(0);
    expect(result.fileSummaries).toHaveLength(0);
  });
});
