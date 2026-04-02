/**
 * @aspect/engine — Analysis orchestrator
 *
 * Main entry point that runs all calculators and produces a combined
 * analysis result with timing and summary.
 */

import type {
  Entity,
  Relationship,
  ModuleBoundary,
  DuplicationSignal,
  CoverageSignal,
  LintSignal,
} from '@aspect/contracts';

import { calculateComplexity } from './complexity.js';
import type { ComplexityResults } from './complexity.js';
import {
  calculateCoupling,
  calculateModuleDependencyMatrix,
  calculateModuleCohesion,
} from './coupling.js';
import type {
  CouplingResult,
  ModuleDependencyMatrix,
  ModuleCohesion,
  CouplingOptions,
} from './coupling.js';
import { calculateGraphMetrics } from './graph-metrics.js';
import type { GraphMetricsResult } from './graph-metrics.js';
import { calculateLcom4 } from './cohesion.js';
import type { Lcom4Result } from './cohesion.js';
import { calculateSolidIndicators } from './solid.js';
import type { SolidResults } from './solid.js';
import { calculateDuplication } from './duplication.js';
import type { DuplicationResults } from './duplication.js';
import { calculateModuleMetrics } from './module-metrics.js';
import type { ModuleMetricsSummary } from './module-metrics.js';
import { calculateHierarchyMetrics } from './hierarchy.js';
import type { HierarchyMetrics, HierarchyOptions } from './hierarchy.js';
import { calculateCoherence } from './coherence.js';
import type { CoherenceResult, CoherenceOptions } from './coherence.js';
import {
  buildReferenceGrouping,
  buildDirectoryGrouping,
  buildBoundaryGrouping,
  compareGroupings,
} from './grouping.js';
import type { Grouping, GroupingComparison } from './grouping.js';
import { classifyCodeRoles } from './code-roles.js';
import type { CodeRoleResult, CodeRoleOptions } from './code-roles.js';
import { calculateGroupCoupling } from './group-coupling.js';
import type { GroupCouplingResult, GroupCouplingOptions } from './group-coupling.js';
import { generateRecommendations } from './recommendations.js';
import type { ArchitecturalSummary } from './recommendations.js';

// ── Public input / output types ─────────────────────────────────────────

export interface AnalysisInput {
  entities: Entity[];
  relationships: Relationship[];
  moduleBoundaries: ModuleBoundary[];
  duplicationSignals?: DuplicationSignal[];
  coverageSignals?: CoverageSignal[];
  lintSignals?: LintSignal[];
}

export type CalculatorGroup =
  | 'complexity'
  | 'coupling'
  | 'graph'
  | 'cohesion'
  | 'solid'
  | 'duplication'
  | 'module'
  | 'hierarchy'
  | 'coherence'
  | 'codeRoles'
  | 'groupCoupling'
  | 'recommendations';

export interface AnalysisOptions {
  /** Which calculator groups to run (default: all). */
  include?: CalculatorGroup[];
  /** Coupling filter options. */
  couplingOptions?: CouplingOptions;
  /** Hierarchy analysis options. */
  hierarchyOptions?: HierarchyOptions;
  /** Number of duplication hotspots to report (default: 10). */
  hotspotCount?: number;
  /** Coherence analysis options. */
  coherence?: CoherenceOptions;
  /** Code role classification options. */
  codeRoles?: CodeRoleOptions;
  /** Group coupling analysis options. */
  groupCoupling?: GroupCouplingOptions;
}

export interface CouplingSection {
  entities: CouplingResult[];
  moduleDependencyMatrix: ModuleDependencyMatrix;
  moduleCohesion: ModuleCohesion[];
}

export interface AnalysisResult {
  complexity?: ComplexityResults;
  coupling?: CouplingSection;
  graph?: GraphMetricsResult;
  cohesion?: Lcom4Result[];
  solid?: SolidResults;
  duplication?: DuplicationResults;
  moduleMetrics?: ModuleMetricsSummary;
  hierarchy?: HierarchyMetrics;
  coherence?: CoherenceResult;
  codeRoles?: CodeRoleResult;
  groupCoupling?: GroupCouplingResult;
  architecturalSummary?: ArchitecturalSummary;
  referenceGrouping?: Grouping;
  directoryGrouping?: Grouping;
  boundaryGrouping?: Grouping;
  groupingComparison?: GroupingComparison;
  summary: AnalysisSummary;
  timing: { totalMs: number; perCalculator: Record<string, number> };
}

export interface AnalysisSummary {
  entityCount: number;
  relationshipCount: number;
  moduleCount: number;

  maxCyclomaticComplexity: number;
  avgCyclomaticComplexity: number;
  cycleCount: number;
  communityCount: number;
  overallDuplicationPercentage: number;

  mostComplexEntities: Array<{ entityId: string; cyclomatic: number }>;
  mostCoupledEntities: Array<{ entityId: string; totalCoupling: number }>;
  worstSrpEntities: Array<{ entityId: string; lcom4: number }>;

  overallCoherenceScore: number;
  misplacedFileCount: number;
  tangledDirectoryCount: number;

  modulesInZoneOfPain: string[];
  modulesInZoneOfUselessness: string[];

  codeRoleCounts: {
    utility: number;
    contract: number;
    business_logic: number;
    presentation: number;
    unknown: number;
  };

  groupingSimilarityScore: number;
  groupingNmi: number;

  healthScore: number;
  recommendationCount: number;
  separableGroupCount: number;
  mergeCandidateCount: number;
}

// ── Constants ───────────────────────────────────────────────────────────

const ALL_GROUPS: CalculatorGroup[] = [
  'complexity',
  'coupling',
  'graph',
  'cohesion',
  'solid',
  'duplication',
  'module',
  'hierarchy',
  'coherence',
  'codeRoles',
  'groupCoupling',
  'recommendations',
];

const TOP_N = 5;

// ── Helpers ─────────────────────────────────────────────────────────────

function timed<T>(fn: () => T): { result: T; ms: number } {
  const t0 = performance.now();
  const result = fn();
  return { result, ms: performance.now() - t0 };
}

function topN<T>(items: T[], key: (item: T) => number, n: number): T[] {
  return [...items].sort((a, b) => key(b) - key(a)).slice(0, n);
}

// ── Summary builder ─────────────────────────────────────────────────────

function buildSummary(
  input: AnalysisInput,
  complexityResult?: ComplexityResults,
  couplingEntities?: CouplingResult[],
  graphResult?: GraphMetricsResult,
  cohesionResult?: Lcom4Result[],
  solidResult?: SolidResults,
  duplicationResult?: DuplicationResults,
  moduleResult?: ModuleMetricsSummary,
  coherenceResult?: CoherenceResult,
  codeRolesResult?: CodeRoleResult,
  groupingComparisonResult?: GroupingComparison,
  architecturalSummaryResult?: ArchitecturalSummary,
  groupCouplingResult?: GroupCouplingResult,
): AnalysisSummary {
  // Complexity aggregates
  const cyclomatics = complexityResult?.cyclomatic ?? [];
  const maxCyclomaticComplexity =
    cyclomatics.length > 0
      ? Math.max(...cyclomatics.map((c) => c.cyclomaticComplexity))
      : 0;
  const avgCyclomaticComplexity =
    cyclomatics.length > 0
      ? cyclomatics.reduce((s, c) => s + c.cyclomaticComplexity, 0) /
        cyclomatics.length
      : 0;

  // Top 5 most complex
  const mostComplexEntities = topN(
    cyclomatics,
    (c) => c.cyclomaticComplexity,
    TOP_N,
  ).map((c) => ({ entityId: c.entityId, cyclomatic: c.cyclomaticComplexity }));

  // Top 5 most coupled
  const mostCoupledEntities = topN(
    couplingEntities ?? [],
    (c) => c.totalCoupling,
    TOP_N,
  ).map((c) => ({ entityId: c.entityId, totalCoupling: c.totalCoupling }));

  // Top 5 worst SRP (highest LCOM4)
  const lcom4ForSummary = cohesionResult ?? [];
  const worstSrpEntities = topN(lcom4ForSummary, (c) => c.lcom4, TOP_N).map(
    (c) => ({ entityId: c.entityId, lcom4: c.lcom4 }),
  );

  return {
    entityCount: input.entities.length,
    relationshipCount: input.relationships.length,
    moduleCount: input.moduleBoundaries.length,

    maxCyclomaticComplexity,
    avgCyclomaticComplexity,
    cycleCount: graphResult?.cycles.cycleCount ?? 0,
    communityCount: graphResult?.communities.communityCount ?? 0,
    overallDuplicationPercentage:
      duplicationResult?.project.duplicationPercentage ?? 0,

    mostComplexEntities,
    mostCoupledEntities,
    worstSrpEntities,

    overallCoherenceScore: coherenceResult?.overallCoherenceScore ?? 0,
    misplacedFileCount: coherenceResult?.misplacedFiles.length ?? 0,
    tangledDirectoryCount: coherenceResult?.tangledDirectories.length ?? 0,

    modulesInZoneOfPain: moduleResult?.zoneOfPain ?? [],
    modulesInZoneOfUselessness: moduleResult?.zoneOfUselessness ?? [],

    codeRoleCounts: codeRolesResult?.summary ?? {
      utility: 0,
      contract: 0,
      business_logic: 0,
      presentation: 0,
      unknown: 0,
    },

    groupingSimilarityScore: groupingComparisonResult?.similarityScore ?? 0,
    groupingNmi: groupingComparisonResult?.nmi ?? 0,

    healthScore: architecturalSummaryResult?.healthScore ?? 0,
    recommendationCount: architecturalSummaryResult?.recommendations.length ?? 0,
    separableGroupCount:
      groupCouplingResult?.profiles.filter((p) => p.separabilityIndex > 0.7).length ?? 0,
    mergeCandidateCount: groupCouplingResult?.mergeCandidates.length ?? 0,
  };
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Run all (or selected) analysis calculators over the provided input and
 * return a combined result with per-calculator timing and a summary.
 */
export async function analyze(
  input: AnalysisInput,
  options?: AnalysisOptions,
): Promise<AnalysisResult> {
  const start = performance.now();
  const timing: Record<string, number> = {};
  const include = new Set(options?.include ?? ALL_GROUPS);

  let complexityResult: ComplexityResults | undefined;
  let couplingEntities: CouplingResult[] | undefined;
  let couplingMatrix: ModuleDependencyMatrix | undefined;
  let couplingCohesion: ModuleCohesion[] | undefined;
  let graphResult: GraphMetricsResult | undefined;
  let cohesionResult: Lcom4Result[] | undefined;
  let solidResult: SolidResults | undefined;
  let duplicationResult: DuplicationResults | undefined;
  let moduleResult: ModuleMetricsSummary | undefined;
  let hierarchyResult: HierarchyMetrics | undefined;
  let coherenceResult: CoherenceResult | undefined;
  let codeRolesResult: CodeRoleResult | undefined;
  let groupCouplingResult: GroupCouplingResult | undefined;
  let architecturalSummaryResult: ArchitecturalSummary | undefined;

  // --- Complexity ---
  if (include.has('complexity')) {
    const t = timed(() => calculateComplexity(input.entities as any));
    complexityResult = t.result;
    timing.complexity = t.ms;
  }

  // --- Coupling ---
  if (include.has('coupling')) {
    const couplingOpts = options?.couplingOptions;
    const tEntities = timed(() =>
      calculateCoupling(input.entities, input.relationships, couplingOpts),
    );
    couplingEntities = tEntities.result;

    const tMatrix = timed(() =>
      calculateModuleDependencyMatrix(
        input.relationships,
        input.moduleBoundaries,
        input.entities,
        couplingOpts,
      ),
    );
    couplingMatrix = tMatrix.result;

    const tCohesion = timed(() =>
      calculateModuleCohesion(
        input.relationships,
        input.moduleBoundaries,
        input.entities,
        couplingOpts,
      ),
    );
    couplingCohesion = tCohesion.result;

    timing.coupling = tEntities.ms + tMatrix.ms + tCohesion.ms;
  }

  // --- Graph metrics ---
  if (include.has('graph')) {
    const t = timed(() =>
      calculateGraphMetrics(input.entities, input.relationships),
    );
    graphResult = t.result;
    timing.graph = t.ms;
  }

  // --- Cohesion (LCOM4) — must run before SOLID ---
  if (include.has('cohesion') || include.has('solid')) {
    const t = timed(() => {
      const results: Lcom4Result[] = [];
      for (const entity of input.entities) {
        if (entity.methodFieldAccessMatrix != null) {
          results.push(
            calculateLcom4(entity.id, entity.methodFieldAccessMatrix),
          );
        }
      }
      return results;
    });
    cohesionResult = t.result;
    timing.cohesion = t.ms;
  }

  // --- SOLID ---
  if (include.has('solid')) {
    const t = timed(() =>
      calculateSolidIndicators(
        input.entities as any,
        input.relationships as any,
        input.moduleBoundaries as any,
        cohesionResult ?? [],
      ),
    );
    solidResult = t.result;
    timing.solid = t.ms;
  }

  // --- Duplication ---
  if (include.has('duplication')) {
    const t = timed(() =>
      calculateDuplication(
        input.duplicationSignals ?? [],
        input.entities,
        input.moduleBoundaries,
        { hotspotCount: options?.hotspotCount },
      ),
    );
    duplicationResult = t.result;
    timing.duplication = t.ms;
  }

  // --- Module metrics ---
  if (include.has('module')) {
    const t = timed(() =>
      calculateModuleMetrics(
        input.entities,
        input.relationships,
        input.moduleBoundaries,
      ),
    );
    moduleResult = t.result;
    timing.module = t.ms;
  }

  // --- Hierarchy ---
  if (include.has('hierarchy')) {
    const t = timed(() =>
      calculateHierarchyMetrics(
        input.entities,
        input.relationships,
        options?.hierarchyOptions,
      ),
    );
    hierarchyResult = t.result;
    timing.hierarchy = t.ms;
  }

  // --- Coherence ---
  if (include.has('coherence')) {
    const t = timed(() =>
      calculateCoherence(
        input.entities,
        input.relationships,
        options?.coherence,
      ),
    );
    coherenceResult = t.result;
    timing.coherence = t.ms;
  }

  // --- Code roles ---
  if (include.has('codeRoles')) {
    const t = timed(() =>
      classifyCodeRoles(
        input.entities,
        input.relationships,
        options?.codeRoles,
      ),
    );
    codeRolesResult = t.result;
    timing.codeRoles = t.ms;
  }

  // --- Groupings (always computed, uses graph-metrics internally) ---
  const tGrouping = timed(() => {
    const refGrouping = buildReferenceGrouping(input.entities, input.relationships);
    const dirGrouping = buildDirectoryGrouping(input.entities);
    const bndGrouping = input.moduleBoundaries.length > 0
      ? buildBoundaryGrouping(input.entities, input.moduleBoundaries)
      : undefined;
    const comparison = compareGroupings(refGrouping, dirGrouping, input.entities);
    return { refGrouping, dirGrouping, bndGrouping, comparison };
  });
  const { refGrouping, dirGrouping, bndGrouping, comparison: groupingComparison } = tGrouping.result;
  timing.grouping = tGrouping.ms;

  // --- Group coupling (requires grouping + code roles) ---
  if (include.has('groupCoupling')) {
    const primaryGrouping = bndGrouping ?? refGrouping;
    const t = timed(() =>
      calculateGroupCoupling(
        primaryGrouping,
        input.entities,
        input.relationships,
        {
          mergeCouplingThreshold: options?.groupCoupling?.mergeCouplingThreshold,
          codeRoles: codeRolesResult?.classifications,
        },
      ),
    );
    groupCouplingResult = t.result;
    timing.groupCoupling = t.ms;
  }

  // --- Build combined result ---
  const couplingSection: CouplingSection | undefined =
    couplingEntities != null
      ? {
          entities: couplingEntities,
          moduleDependencyMatrix: couplingMatrix!,
          moduleCohesion: couplingCohesion!,
        }
      : undefined;

  const summary = buildSummary(
    input,
    complexityResult,
    couplingEntities,
    graphResult,
    cohesionResult,
    solidResult,
    duplicationResult,
    moduleResult,
    coherenceResult,
    codeRolesResult,
    groupingComparison,
    undefined, // architecturalSummary — filled after recommendations
    groupCouplingResult,
  );

  const result: AnalysisResult = {
    complexity: complexityResult,
    coupling: couplingSection,
    graph: graphResult,
    cohesion: include.has('cohesion') ? cohesionResult : undefined,
    solid: solidResult,
    duplication: duplicationResult,
    moduleMetrics: moduleResult,
    hierarchy: hierarchyResult,
    coherence: coherenceResult,
    codeRoles: codeRolesResult,
    groupCoupling: groupCouplingResult,
    referenceGrouping: refGrouping,
    directoryGrouping: dirGrouping,
    boundaryGrouping: bndGrouping,
    groupingComparison,
    summary,
    timing: { totalMs: performance.now() - start, perCalculator: timing },
  };

  // --- Recommendations (requires full result) ---
  if (include.has('recommendations')) {
    const t = timed(() => generateRecommendations(result, groupCouplingResult));
    architecturalSummaryResult = t.result;
    timing.recommendations = t.ms;
    result.architecturalSummary = architecturalSummaryResult;
    // Update summary with recommendation-derived fields
    result.summary = {
      ...result.summary,
      healthScore: architecturalSummaryResult.healthScore,
      recommendationCount: architecturalSummaryResult.recommendations.length,
    };
  }

  result.timing = { totalMs: performance.now() - start, perCalculator: timing };
  return result;
}
