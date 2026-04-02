import { describe, it, expect } from 'vitest';
import type { Entity } from '@aspect/contracts';
import type { AnalysisResult } from '../orchestrator.js';
import type { CollectedData } from './types.js';
import { toSonarQube } from './sonarqube.js';

// ── Mock factories ──────────────────────────────────────────────────────

function mockEntity(overrides: Partial<Entity> & { id: string; filePath: string }): Entity {
  return {
    kind: 'class',
    name: overrides.id.split('::')[1] ?? overrides.id,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 50, endColumn: 1 },
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: true,
      visibility: 'public',
    },
    ...overrides,
  };
}

function createMockCollectedData(): CollectedData {
  return {
    entities: [
      mockEntity({ id: 'a', filePath: 'src/a.ts', sourceRange: { startLine: 5, startColumn: 0, endLine: 40, endColumn: 1 } }),
      mockEntity({ id: 'b', filePath: 'src/b.ts', sourceRange: { startLine: 10, startColumn: 2, endLine: 80, endColumn: 1 } }),
    ],
    relationships: [],
    moduleBoundaries: [],
  };
}

function createMockAnalysisResult(): AnalysisResult {
  return {
    complexity: {
      cyclomatic: [
        { entityId: 'a', cyclomaticComplexity: 5 },
        { entityId: 'b', cyclomaticComplexity: 15 },
      ],
      cognitive: [],
      halstead: [],
      fileSummaries: [],
    },
    graph: {
      cycles: {
        cycleCount: 1,
        largestCycleSize: 2,
        totalEntitiesInCycles: 2,
        cycles: [{ id: 'c1', entityIds: ['a', 'b'], size: 2 }],
      },
      centrality: [],
      pageRank: [],
      communities: { communityCount: 0, communities: [], modularity: 0 },
    },
    solid: {
      srp: [{ entityId: 'b', lcom4: 3, importSourceDiversity: 0.8, responsibilityGroupCount: 3, nameSemanticClusters: [], srpScore: 0.3 }],
      ocp: [],
      isp: [],
      dip: [{ entityId: 'a', abstractionDependencyRatio: 0.2, concreteDependencyCount: 4, layerViolationCount: 1, dipScore: 0.4 }],
      lsp: [],
    },
    duplication: {
      project: { totalLines: 500, duplicatedLines: 150, duplicationPercentage: 30, totalClones: 3 },
      files: [
        { filePath: 'src/b.ts', duplicatedLines: 40, totalLines: 80, duplicationPercentage: 50, cloneCount: 2 },
      ],
      crossModule: [],
      hotspots: [],
    },
    coupling: undefined,
    summary: {
      entityCount: 2, relationshipCount: 0, moduleCount: 0,
      maxCyclomaticComplexity: 15, avgCyclomaticComplexity: 10,
      cycleCount: 1, communityCount: 0, overallDuplicationPercentage: 30,
      mostComplexEntities: [], mostCoupledEntities: [], worstSrpEntities: [],
      modulesInZoneOfPain: [], modulesInZoneOfUselessness: [],
    },
    timing: { totalMs: 20, perCalculator: {} },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('toSonarQube', () => {
  it('produces valid structure with issues array', () => {
    const report = toSonarQube(createMockAnalysisResult(), createMockCollectedData());

    expect(report).toHaveProperty('issues');
    expect(Array.isArray(report.issues)).toBe(true);
    expect(report.issues.length).toBeGreaterThan(0);
    for (const issue of report.issues) {
      expect(issue).toHaveProperty('engineId', 'aspect');
      expect(issue).toHaveProperty('ruleId');
      expect(issue).toHaveProperty('severity');
      expect(issue).toHaveProperty('type');
      expect(issue).toHaveProperty('primaryLocation');
    }
  });

  it('maps dependency cycles to CRITICAL BUG severity', () => {
    const report = toSonarQube(createMockAnalysisResult(), createMockCollectedData());
    const cycleIssues = report.issues.filter((i) => i.ruleId === 'dependency-cycle');

    expect(cycleIssues).toHaveLength(1);
    expect(cycleIssues[0].severity).toBe('CRITICAL');
    expect(cycleIssues[0].type).toBe('BUG');
  });

  it('includes correct file paths in primaryLocation', () => {
    const report = toSonarQube(createMockAnalysisResult(), createMockCollectedData());
    const complexityIssues = report.issues.filter(
      (i) => i.ruleId === 'high-cyclomatic-complexity',
    );

    expect(complexityIssues).toHaveLength(1);
    expect(complexityIssues[0].primaryLocation.filePath).toBe('src/b.ts');
    expect(complexityIssues[0].primaryLocation.textRange.startLine).toBe(10);
  });

  it('returns empty issues array for empty analysis', () => {
    const emptyResult: AnalysisResult = {
      summary: {
        entityCount: 0, relationshipCount: 0, moduleCount: 0,
        maxCyclomaticComplexity: 0, avgCyclomaticComplexity: 0,
        cycleCount: 0, communityCount: 0, overallDuplicationPercentage: 0,
        mostComplexEntities: [], mostCoupledEntities: [], worstSrpEntities: [],
        modulesInZoneOfPain: [], modulesInZoneOfUselessness: [],
      },
      timing: { totalMs: 0, perCalculator: {} },
    };

    const report = toSonarQube(emptyResult, { entities: [], relationships: [], moduleBoundaries: [] });
    expect(report.issues).toHaveLength(0);
  });

  it('maps high duplication to CODE_SMELL MAJOR', () => {
    const report = toSonarQube(createMockAnalysisResult(), createMockCollectedData());
    const dupIssues = report.issues.filter((i) => i.ruleId === 'high-duplication');

    expect(dupIssues).toHaveLength(1);
    expect(dupIssues[0].severity).toBe('MAJOR');
    expect(dupIssues[0].type).toBe('CODE_SMELL');
    expect(dupIssues[0].primaryLocation.filePath).toBe('src/b.ts');
  });

  it('maps low DIP to CODE_SMELL MINOR', () => {
    const report = toSonarQube(createMockAnalysisResult(), createMockCollectedData());
    const dipIssues = report.issues.filter((i) => i.ruleId === 'low-dip');

    expect(dipIssues).toHaveLength(1);
    expect(dipIssues[0].severity).toBe('MINOR');
    expect(dipIssues[0].type).toBe('CODE_SMELL');
  });
});
