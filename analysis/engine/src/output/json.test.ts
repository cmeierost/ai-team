import { describe, it, expect } from 'vitest';
import type { AnalysisResult } from '../orchestrator.js';
import { toJson } from './json.js';

// ── Mock factory ────────────────────────────────────────────────────────

function createMockAnalysisResult(): AnalysisResult {
  return {
    complexity: {
      cyclomatic: [{ entityId: 'a', cyclomaticComplexity: 5 }],
      cognitive: [],
      halstead: [],
      fileSummaries: [],
    },
    coupling: {
      entities: [],
      moduleDependencyMatrix: { moduleIds: [], matrix: [], crossModuleEdgeCount: 0 },
      moduleCohesion: [],
    },
    graph: {
      cycles: { cycleCount: 0, largestCycleSize: 0, totalEntitiesInCycles: 0, cycles: [] },
      centrality: [],
      pageRank: [],
      communities: { communityCount: 0, communities: [], modularity: 0 },
    },
    summary: {
      entityCount: 1, relationshipCount: 0, moduleCount: 0,
      maxCyclomaticComplexity: 5, avgCyclomaticComplexity: 5,
      cycleCount: 0, communityCount: 0, overallDuplicationPercentage: 0,
      mostComplexEntities: [], mostCoupledEntities: [], worstSrpEntities: [],
      modulesInZoneOfPain: [], modulesInZoneOfUselessness: [],
    },
    timing: { totalMs: 42, perCalculator: { complexity: 10 } },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('toJson', () => {
  it('produces pretty-printed output with newlines and indentation by default', () => {
    const json = toJson(createMockAnalysisResult());

    expect(json).toContain('\n');
    expect(json).toContain('  ');
    // Timing excluded by default
    expect(json).not.toContain('"timing"');
    // Valid JSON
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('produces compact output when pretty is false', () => {
    const json = toJson(createMockAnalysisResult(), { pretty: false });

    expect(json).not.toContain('\n');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('filters to selected sections only', () => {
    const json = toJson(createMockAnalysisResult(), {
      sections: ['complexity'],
    });

    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('complexity');
    expect(parsed).not.toHaveProperty('coupling');
    expect(parsed).not.toHaveProperty('graph');
    expect(parsed).not.toHaveProperty('summary');
    expect(parsed).not.toHaveProperty('timing');
  });

  it('includes timing when includeTimings is true', () => {
    const json = toJson(createMockAnalysisResult(), { includeTimings: true });
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('timing');
    expect(parsed.timing.totalMs).toBe(42);
  });

  it('includes timing in section mode when includeTimings is true', () => {
    const json = toJson(createMockAnalysisResult(), {
      sections: ['complexity'],
      includeTimings: true,
    });
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('complexity');
    expect(parsed).toHaveProperty('timing');
  });

  it('maps "module" section key to moduleMetrics result field', () => {
    const result = createMockAnalysisResult();
    result.moduleMetrics = {
      modules: [],
      averageAbstractness: 0.5,
      averageInstability: 0.5,
      averageDistance: 0,
      zoneOfPain: [],
      zoneOfUselessness: [],
    };

    const json = toJson(result, { sections: ['module'] });
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('module');
    expect(parsed.module.averageAbstractness).toBe(0.5);
  });
});
