import { describe, it, expect } from 'vitest';
import { generateRecommendations } from './recommendations.js';
import type {
  Recommendation,
  ArchitecturalSummary,
  RecommendationPriority,
} from './recommendations.js';
import type { AnalysisResult, AnalysisSummary } from './orchestrator.js';

// ── Factories ───────────────────────────────────────────────────────────

function baseSummary(overrides?: Partial<AnalysisSummary>): AnalysisSummary {
  return {
    entityCount: 50,
    relationshipCount: 120,
    moduleCount: 5,
    maxCyclomaticComplexity: 8,
    avgCyclomaticComplexity: 4,
    cycleCount: 0,
    communityCount: 3,
    overallDuplicationPercentage: 2,
    mostComplexEntities: [],
    mostCoupledEntities: [],
    worstSrpEntities: [],
    overallCoherenceScore: 0.85,
    misplacedFileCount: 0,
    tangledDirectoryCount: 0,
    modulesInZoneOfPain: [],
    modulesInZoneOfUselessness: [],
    codeRoleCounts: {
      utility: 5,
      contract: 5,
      business_logic: 30,
      presentation: 5,
      unknown: 5,
    },
    groupingSimilarityScore: 0.8,
    groupingNmi: 0.75,
    ...overrides,
  };
}

function healthyResult(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    summary: baseSummary(),
    timing: { totalMs: 100, perCalculator: {} },
    ...overrides,
  };
}

function problematicResult(): AnalysisResult {
  return {
    summary: baseSummary({
      entityCount: 200,
      relationshipCount: 800,
      moduleCount: 10,
      maxCyclomaticComplexity: 45,
      avgCyclomaticComplexity: 18,
      cycleCount: 5,
      communityCount: 8,
      overallDuplicationPercentage: 22,
      overallCoherenceScore: 0.3,
      misplacedFileCount: 12,
      tangledDirectoryCount: 4,
      groupingSimilarityScore: 0.25,
      groupingNmi: 0.2,
      mostComplexEntities: [
        { entityId: 'src/god-object.ts', cyclomatic: 45 },
        { entityId: 'src/monster.ts', cyclomatic: 38 },
        { entityId: 'src/complex.ts', cyclomatic: 30 },
        { entityId: 'src/moderate.ts', cyclomatic: 20 },
      ],
      mostCoupledEntities: [
        { entityId: 'src/hub.ts', totalCoupling: 40 },
      ],
      worstSrpEntities: [
        { entityId: 'src/god-object.ts', lcom4: 7 },
      ],
    }),
    graph: {
      cycles: {
        cycleCount: 5,
        largestCycleSize: 4,
        totalEntitiesInCycles: 12,
        cycles: [
          { id: 'c1', entityIds: ['src/a.ts', 'src/b.ts'], size: 2 },
          { id: 'c2', entityIds: ['src/c.ts', 'src/d.ts', 'src/e.ts'], size: 3 },
          { id: 'c3', entityIds: ['src/f.ts', 'src/g.ts', 'src/h.ts', 'src/i.ts'], size: 4 },
        ],
      },
      centrality: [],
      pageRank: [],
      communities: { communityCount: 8, communities: [], modularity: 0.4 },
    },
    coherence: {
      overallCoherenceScore: 0.3,
      directoryGroups: [],
      crossReferences: [],
      couplingMatrix: { directories: [], matrix: [] },
      communityMappings: [],
      misplacedFiles: [
        {
          entityId: 'src/utils/lost.ts',
          filePath: 'src/utils/lost.ts',
          currentDirectory: 'src/utils',
          communityId: 'c1',
          suggestedDirectory: 'src/core',
          peersInCurrentDir: 1,
          peersInSuggestedDir: 8,
        },
        {
          entityId: 'src/lib/stray.ts',
          filePath: 'src/lib/stray.ts',
          currentDirectory: 'src/lib',
          communityId: 'c2',
          suggestedDirectory: 'src/api',
          peersInCurrentDir: 2,
          peersInSuggestedDir: 6,
        },
      ],
      tangledDirectories: [],
      isolatedDirectories: [],
    },
    codeRoles: {
      classifications: [],
      summary: {
        utility: 10,
        contract: 15,
        business_logic: 150,
        presentation: 15,
        unknown: 10,
      },
      contractViolations: [
        {
          entityId: 'src/contracts/api.ts',
          filePath: 'src/contracts/api.ts',
          implementationImports: ['src/services/impl.ts', 'src/db/client.ts'],
        },
      ],
      overloadedBusinessLogic: [],
    },
    solid: {
      srp: [],
      ocp: [],
      isp: [],
      dip: [
        {
          entityId: 'src/services/handler.ts',
          dipScore: 0.15,
          abstractionDependencyRatio: 0.15,
          concreteDependencyCount: 8,
          layerViolationCount: 2,
        },
        {
          entityId: 'src/services/processor.ts',
          dipScore: 0.25,
          abstractionDependencyRatio: 0.25,
          concreteDependencyCount: 6,
          layerViolationCount: 1,
        },
      ],
      lsp: [],
    },
    groupingComparison: {
      sourceGroupingId: 'ref',
      targetGroupingId: 'dir',
      similarityScore: 0.25,
      nmi: 0.2,
      groupOverlaps: [],
      mismatches: [],
      suggestions: [
        {
          entityId: 'src/extra/orphan.ts',
          filePath: 'src/extra/orphan.ts',
          fromGroup: 'extra',
          toGroup: 'core',
          reason: 'Strongly coupled to core entities.',
          impactEstimate: 0.04,
        },
      ],
    },
    timing: { totalMs: 500, perCalculator: {} },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('generateRecommendations', () => {
  describe('healthy codebase', () => {
    it('returns a high health score with few recommendations', () => {
      const result = healthyResult();
      const summary = generateRecommendations(result);

      expect(summary.healthScore).toBeGreaterThanOrEqual(70);
      expect(summary.recommendations.length).toBeLessThanOrEqual(5);
    });

    it('generates a meaningful overview', () => {
      const result = healthyResult();
      const summary = generateRecommendations(result);

      expect(summary.overview).toContain('50 code entities');
      expect(summary.overview).toContain('5 modules');
      expect(summary.overview).toMatch(/\d+\/100/);
    });

    it('produces key metrics with good assessments', () => {
      const result = healthyResult();
      const summary = generateRecommendations(result);

      const coherenceMetric = summary.keyMetrics.find(
        (m) => m.label === 'Structural Coherence',
      );
      expect(coherenceMetric).toBeDefined();
      expect(coherenceMetric!.assessment).toBe('good');

      const cycleMetric = summary.keyMetrics.find(
        (m) => m.label === 'Dependency Cycles',
      );
      expect(cycleMetric).toBeDefined();
      expect(cycleMetric!.value).toBe('0');
      expect(cycleMetric!.assessment).toBe('good');
    });

    it('health score is always in 0–100 range', () => {
      const result = healthyResult();
      const summary = generateRecommendations(result);

      expect(summary.healthScore).toBeGreaterThanOrEqual(0);
      expect(summary.healthScore).toBeLessThanOrEqual(100);
    });
  });

  describe('problematic codebase', () => {
    it('returns a low health score', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      expect(summary.healthScore).toBeLessThan(50);
    });

    it('generates many recommendations', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      expect(summary.recommendations.length).toBeGreaterThan(5);
    });

    it('places critical cycle-break recommendations first', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const firstRec = summary.recommendations[0];
      expect(firstRec.priority).toBe('critical');
      expect(firstRec.category).toBe('cycle-break');
    });

    it('generates file-move recommendations from misplaced files', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const fileMoves = summary.recommendations.filter(
        (r) => r.category === 'file-move',
      );
      expect(fileMoves.length).toBeGreaterThanOrEqual(2);
      expect(fileMoves[0].title).toContain('Move');
    });

    it('generates contract-extraction recommendations', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const contracts = summary.recommendations.filter(
        (r) => r.category === 'contract-extraction',
      );
      expect(contracts.length).toBe(1);
      expect(contracts[0].title).toContain('api.ts');
      expect(contracts[0].priority).toBe('high');
    });

    it('generates dependency-inversion recommendations', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const dipRecs = summary.recommendations.filter(
        (r) => r.category === 'dependency-inversion',
      );
      expect(dipRecs.length).toBe(2);
      expect(dipRecs[0].title).toContain('concrete implementations');
    });

    it('generates complexity-hotspot recommendations', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const hotspots = summary.recommendations.filter(
        (r) => r.category === 'complexity-hotspot',
      );
      expect(hotspots.length).toBe(4);
      // Top 3 should be 'high' priority
      expect(hotspots[0].priority).toBe('high');
      expect(hotspots[1].priority).toBe('high');
      expect(hotspots[2].priority).toBe('high');
      expect(hotspots[3].priority).toBe('medium');
    });

    it('boosts complexity impact for entities with SRP violations', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const hotspots = summary.recommendations.filter(
        (r) => r.category === 'complexity-hotspot',
      );
      const godObject = hotspots.find((r) =>
        r.entityIds.includes('src/god-object.ts'),
      );
      expect(godObject).toBeDefined();
      expect(godObject!.description).toContain('Single-Responsibility');
    });

    it('generates key metrics with critical/warning assessments', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const coherenceMetric = summary.keyMetrics.find(
        (m) => m.label === 'Structural Coherence',
      );
      expect(coherenceMetric!.assessment).toBe('critical');

      const dupMetric = summary.keyMetrics.find(
        (m) => m.label === 'Code Duplication',
      );
      expect(dupMetric!.assessment).toBe('critical');

      const complexityMetric = summary.keyMetrics.find(
        (m) => m.label === 'Average Complexity',
      );
      expect(complexityMetric!.assessment).toBe('warning');
    });

    it('includes misplaced-files and tangled-directory metrics', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const misplaced = summary.keyMetrics.find(
        (m) => m.label === 'Misplaced Files',
      );
      expect(misplaced).toBeDefined();
      expect(misplaced!.value).toBe('12');

      const tangled = summary.keyMetrics.find(
        (m) => m.label === 'Tangled Directories',
      );
      expect(tangled).toBeDefined();
      expect(tangled!.value).toBe('4');
    });

    it('overview mentions top issues', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      expect(summary.overview).toContain('dependency cycle');
      expect(summary.overview).toMatch(/200 code entities/);
    });
  });

  describe('group coupling integration', () => {
    it('generates group-separation recommendations for high separability', () => {
      const result = healthyResult();
      const groupCoupling = {
        profiles: [
          {
            groupId: 'core',
            groupLabel: 'Core',
            memberCount: 20,
            internalCohesion: 0.9,
            separabilityIndex: 0.85,
            outboundEdges: 2,
            inboundEdges: 15,
            apiSurfaceRatio: 0.3,
            outboundTypeOnlyRatio: 0.5,
            inboundTypeOnlyRatio: 0.6,
          },
          {
            groupId: 'utils',
            groupLabel: 'Utilities',
            memberCount: 10,
            internalCohesion: 0.4,
            separabilityIndex: 0.3,
            outboundEdges: 8,
            inboundEdges: 12,
            apiSurfaceRatio: 0.8,
            outboundTypeOnlyRatio: 0.2,
            inboundTypeOnlyRatio: 0.3,
          },
        ],
      };

      const summary = generateRecommendations(result, groupCoupling);
      const sepRecs = summary.recommendations.filter(
        (r) => r.category === 'group-separation',
      );
      expect(sepRecs.length).toBe(1);
      expect(sepRecs[0].title).toContain('Core');
      expect(sepRecs[0].priority).toBe('medium');
    });

    it('generates group-merge recommendations', () => {
      const result = healthyResult();
      const groupCoupling = {
        mergeCandidates: [
          {
            groupIdA: 'auth',
            groupIdB: 'session',
            couplingDensity: 0.85,
            reason: 'Auth and session share most of their internal state.',
          },
        ],
      };

      const summary = generateRecommendations(result, groupCoupling);
      const mergeRecs = summary.recommendations.filter(
        (r) => r.category === 'group-merge',
      );
      expect(mergeRecs.length).toBe(1);
      expect(mergeRecs[0].priority).toBe('high');
      expect(mergeRecs[0].title).toContain('auth');
      expect(mergeRecs[0].title).toContain('session');
    });

    it('finds well-structured groups', () => {
      const result = healthyResult();
      const groupCoupling = {
        profiles: [
          {
            groupId: 'core',
            groupLabel: 'Core',
            memberCount: 20,
            internalCohesion: 0.85,
            separabilityIndex: 0.75,
            outboundEdges: 3,
            inboundEdges: 15,
            apiSurfaceRatio: 0.3,
            outboundTypeOnlyRatio: 0.5,
            inboundTypeOnlyRatio: 0.6,
          },
        ],
      };

      const summary = generateRecommendations(result, groupCoupling);
      expect(summary.wellStructuredGroups.length).toBe(1);
      expect(summary.wellStructuredGroups[0].groupId).toBe('core');
      expect(summary.wellStructuredGroups[0].reason).toContain('cohesion');
    });
  });

  describe('edge cases', () => {
    it('handles minimal result with only required fields', () => {
      const result: AnalysisResult = {
        summary: baseSummary({
          entityCount: 0,
          relationshipCount: 0,
          moduleCount: 0,
          mostComplexEntities: [],
          mostCoupledEntities: [],
          worstSrpEntities: [],
        }),
        timing: { totalMs: 0, perCalculator: {} },
      };

      const summary = generateRecommendations(result);

      expect(summary.healthScore).toBeGreaterThanOrEqual(0);
      expect(summary.healthScore).toBeLessThanOrEqual(100);
      expect(summary.recommendations).toEqual([]);
      expect(summary.keyMetrics.length).toBeGreaterThanOrEqual(5);
      expect(summary.overview).toBeTruthy();
    });

    it('handles missing optional analysis sections', () => {
      const result: AnalysisResult = {
        summary: baseSummary(),
        timing: { totalMs: 50, perCalculator: {} },
        // All optional sections omitted
      };

      const summary = generateRecommendations(result);
      expect(summary.healthScore).toBeGreaterThan(0);
      expect(summary.recommendations.length).toBe(0);
    });

    it('does not duplicate file-move recommendations from coherence and grouping', () => {
      const result: AnalysisResult = {
        summary: baseSummary({ misplacedFileCount: 1 }),
        timing: { totalMs: 50, perCalculator: {} },
        coherence: {
          overallCoherenceScore: 0.5,
          directoryGroups: [],
          crossReferences: [],
          couplingMatrix: { directories: [], matrix: [] },
          communityMappings: [],
          misplacedFiles: [
            {
              entityId: 'src/a.ts',
              filePath: 'src/a.ts',
              currentDirectory: 'src',
              communityId: 'c1',
              suggestedDirectory: 'lib',
              peersInCurrentDir: 1,
              peersInSuggestedDir: 5,
            },
          ],
          tangledDirectories: [],
          isolatedDirectories: [],
        },
        groupingComparison: {
          sourceGroupingId: 'ref',
          targetGroupingId: 'dir',
          similarityScore: 0.6,
          nmi: 0.5,
          groupOverlaps: [],
          mismatches: [],
          suggestions: [
            {
              entityId: 'src/a.ts',  // same entity as above
              filePath: 'src/a.ts',
              fromGroup: 'src',
              toGroup: 'lib',
              reason: 'Coupled to lib.',
              impactEstimate: 0.03,
            },
          ],
        },
      };

      const summary = generateRecommendations(result);
      const fileMoves = summary.recommendations.filter(
        (r) => r.category === 'file-move',
      );
      // Should have exactly 1 — no duplication
      expect(fileMoves.length).toBe(1);
    });

    it('limits recommendations to 20', () => {
      const cycles = Array.from({ length: 25 }, (_, i) => ({
        id: `c${i}`,
        entityIds: [`src/a${i}.ts`, `src/b${i}.ts`],
        size: 2,
      }));

      const result: AnalysisResult = {
        summary: baseSummary({ cycleCount: 25 }),
        graph: {
          cycles: {
            cycleCount: 25,
            largestCycleSize: 2,
            totalEntitiesInCycles: 50,
            cycles,
          },
          centrality: [],
          pageRank: [],
          communities: { communityCount: 1, communities: [], modularity: 0 },
        },
        timing: { totalMs: 50, perCalculator: {} },
      };

      const summary = generateRecommendations(result);
      expect(summary.recommendations.length).toBeLessThanOrEqual(20);
    });

    it('all recommendations have valid priorities', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const validPriorities: RecommendationPriority[] = [
        'critical',
        'high',
        'medium',
        'low',
      ];
      for (const rec of summary.recommendations) {
        expect(validPriorities).toContain(rec.priority);
      }
    });

    it('all recommendations have non-empty IDs and titles', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      for (const rec of summary.recommendations) {
        expect(rec.id).toBeTruthy();
        expect(rec.title).toBeTruthy();
        expect(rec.impact).toBeGreaterThanOrEqual(0);
        expect(rec.impact).toBeLessThanOrEqual(1);
      }
    });

    it('recommendations are sorted by priority then impact', () => {
      const result = problematicResult();
      const summary = generateRecommendations(result);

      const priorityOrder: Record<RecommendationPriority, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };

      for (let i = 1; i < summary.recommendations.length; i++) {
        const prev = summary.recommendations[i - 1];
        const curr = summary.recommendations[i];
        const pDiff =
          priorityOrder[prev.priority] - priorityOrder[curr.priority];
        if (pDiff === 0) {
          expect(prev.impact).toBeGreaterThanOrEqual(curr.impact);
        } else {
          expect(pDiff).toBeLessThanOrEqual(0);
        }
      }
    });
  });

  describe('health score calculation', () => {
    it('gives maximum score for a perfect codebase', () => {
      const result = healthyResult({
        summary: baseSummary({
          overallCoherenceScore: 1.0,
          groupingSimilarityScore: 1.0,
          cycleCount: 0,
          avgCyclomaticComplexity: 3,
          overallDuplicationPercentage: 0,
          mostCoupledEntities: [],
        }),
      });

      const summary = generateRecommendations(result);
      expect(summary.healthScore).toBe(100);
    });

    it('gives very low score for worst-case codebase', () => {
      const result = healthyResult({
        summary: baseSummary({
          overallCoherenceScore: 0,
          groupingSimilarityScore: 0,
          cycleCount: 20,
          avgCyclomaticComplexity: 50,
          overallDuplicationPercentage: 80,
          mostCoupledEntities: [{ entityId: 'x', totalCoupling: 100 }],
        }),
      });

      const summary = generateRecommendations(result);
      expect(summary.healthScore).toBeLessThanOrEqual(10);
    });
  });
});
