/* eslint-disable */
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Analysis results produced by the @aspect/engine orchestrator after running all calculators over collected code data.
 */
export interface AnalyzedCodeData {
  complexity?: ComplexityResults;
  maintainability?: MaintainabilityResults;
  coupling?: CouplingSection;
  graph?: GraphMetricsResult;
  /**
   * Per-entity LCOM4 cohesion results.
   */
  cohesion?: Lcom4Result[];
  solid?: SolidResults;
  duplication?: DuplicationResults;
  moduleMetrics?: ModuleMetricsSummary;
  summary: AnalysisSummary;
  timing: Timing;
}
/**
 * Per-entity cyclomatic, cognitive, and Halstead complexity plus file-level summaries.
 */
export interface ComplexityResults {
  cyclomatic: CyclomaticResult[];
  cognitive: CognitiveResult[];
  halstead: HalsteadResult[];
  fileSummaries: FileComplexitySummary[];
}
export interface CyclomaticResult {
  entityId: string;
  cyclomaticComplexity: number;
}
export interface CognitiveResult {
  entityId: string;
  cognitiveComplexity: number;
}
export interface HalsteadResult {
  entityId: string;
  halstead: HalsteadMetrics;
}
export interface HalsteadMetrics {
  vocabulary: number;
  length: number;
  volume: number;
  difficulty: number;
  effort: number;
  time: number;
  estimatedBugs: number;
}
export interface FileComplexitySummary {
  filePath: string;
  maxCyclomatic: number;
  avgCyclomatic: number;
  totalCyclomatic: number;
  maxCognitive: number;
  avgCognitive: number;
  totalCognitive: number;
  functionCount: number;
}
/**
 * Maintainability Index (MI) results at entity, file, and aggregate levels. Uses the VS-style formula: MI = MAX(0, (171 - 5.2·ln(HV) - 0.23·CC - 16.2·ln(LOC)) × 100 / 171). Thresholds: 0-9 = red (low), 10-19 = yellow (moderate), 20-100 = green (good).
 */
export interface MaintainabilityResults {
  /**
   * Per-entity MI scores for function-like entities.
   */
  entities: MaintainabilityResult[];
  /**
   * Per-file MI aggregates.
   */
  fileSummaries: FileMaintainabilitySummary[];
}
export interface MaintainabilityResult {
  entityId: string;
  /**
   * 0-100 MI score.
   */
  maintainabilityIndex: number;
  /**
   * green (20-100), yellow (10-19), red (0-9).
   */
  riskBand: 'green' | 'yellow' | 'red';
  /**
   * Halstead Volume (HV) used in the MI formula.
   */
  halsteadVolume: number;
  /**
   * Cyclomatic Complexity (CC) used in the MI formula.
   */
  cyclomaticComplexity: number;
  /**
   * Lines of Code (LOC) used in the MI formula.
   */
  linesOfCode: number;
}
export interface FileMaintainabilitySummary {
  filePath: string;
  /**
   * Minimum MI across entities in the file.
   */
  minMI: number;
  /**
   * Average MI across entities in the file.
   */
  avgMI: number;
  /**
   * Overall risk band based on minMI.
   */
  riskBand: 'green' | 'yellow' | 'red';
  /**
   * Number of entities with MI scores.
   */
  entityCount: number;
  /**
   * Entities in red band (0-9).
   */
  redCount: number;
  /**
   * Entities in yellow band (10-19).
   */
  yellowCount: number;
  /**
   * Entities in green band (20-100).
   */
  greenCount: number;
}
/**
 * Per-entity coupling metrics, module dependency matrix, and module cohesion.
 */
export interface CouplingSection {
  entities: CouplingResult[];
  moduleDependencyMatrix: ModuleDependencyMatrix;
  moduleCohesion: ModuleCohesion[];
}
export interface CouplingResult {
  entityId: string;
  /**
   * Ca: number of incoming dependencies.
   */
  afferentCoupling: number;
  /**
   * Ce: number of outgoing dependencies.
   */
  efferentCoupling: number;
  /**
   * Ce / (Ca + Ce), range 0–1.
   */
  instability: number;
  /**
   * Ca + Ce.
   */
  totalCoupling: number;
}
export interface ModuleDependencyMatrix {
  /**
   * Ordered list of module IDs (row/column labels).
   */
  moduleIds: string[];
  /**
   * NxN matrix where matrix[i][j] is the number of edges from moduleIds[i] to moduleIds[j].
   */
  matrix: number[][];
  crossModuleEdgeCount: number;
}
export interface ModuleCohesion {
  moduleId: string;
  internalEdges: number;
  externalEdges: number;
  /**
   * internalEdges / (internalEdges + externalEdges), range 0–1.
   */
  cohesionRatio: number;
}
/**
 * Cycle detection, centrality, PageRank, and community detection results.
 */
export interface GraphMetricsResult {
  cycles: CycleInfo;
  centrality: CentralityResult[];
  pageRank: PageRankResult[];
  communities: CommunityResult;
}
export interface CycleInfo {
  cycleCount: number;
  largestCycleSize: number;
  totalEntitiesInCycles: number;
  cycles: {
    id: string;
    entityIds: string[];
    size: number;
  }[];
}
export interface CentralityResult {
  entityId: string;
  betweennessCentrality: number;
}
export interface PageRankResult {
  entityId: string;
  pageRank: number;
}
export interface CommunityResult {
  communityCount: number;
  communities: {
    id: string;
    entityIds: string[];
    size: number;
  }[];
  modularity: number;
}
/**
 * Per-entity LCOM4 cohesion metric with cohesion group breakdown.
 */
export interface Lcom4Result {
  entityId: string;
  /**
   * Number of connected components in the method-field graph.
   */
  lcom4: number;
  cohesionGroups: {
    methods: string[];
    /**
     * Fields accessed by two or more methods in this group.
     */
    sharedFields: string[];
  }[];
}
/**
 * SOLID principle indicator scores per entity.
 */
export interface SolidResults {
  srp: SrpIndicator[];
  ocp: OcpIndicator[];
  isp: IspIndicator[];
  dip: DipIndicator[];
  lsp: LspIndicator[];
}
export interface SrpIndicator {
  entityId: string;
  lcom4: number;
  importSourceDiversity: number;
  responsibilityGroupCount: number;
  nameSemanticClusters: string[][];
  /**
   * 0–1 composite score (lower = worse SRP).
   */
  srpScore: number;
}
export interface OcpIndicator {
  entityId: string;
  typeCheckingDensity: number;
  conditionalDispatchCount: number;
  extensionPointRatio: number;
  concreteTargetRatio: number;
  /**
   * 0–1 (lower = worse OCP).
   */
  ocpScore: number;
}
export interface IspIndicator {
  entityId: string;
  avgUsageRatio: number;
  minUsageRatio: number;
  consumerCount: number;
  suggestedSplits: {
    members: string[];
    consumers: string[];
  }[];
  /**
   * 0–1 (lower = fatter interface).
   */
  ispScore: number;
}
export interface DipIndicator {
  entityId: string;
  abstractionDependencyRatio: number;
  concreteDependencyCount: number;
  layerViolationCount: number;
  /**
   * 0–1 (lower = more concrete deps).
   */
  dipScore: number;
}
export interface LspIndicator {
  entityId: string;
  overrideCount: number;
  signatureMismatches: {
    methodName: string;
    baseParams: string[];
    overrideParams: string[];
    baseReturn: string | null;
    overrideReturn: string | null;
  }[];
  /**
   * 1.0 minus penalty per mismatch.
   */
  lspScore: number;
}
/**
 * Project-level, per-file, cross-module duplication metrics and hotspots.
 */
export interface DuplicationResults {
  project: ProjectDuplicationResult;
  files: FileDuplicationResult[];
  crossModule: CrossModuleDuplication[];
  /**
   * Top N files by duplication percentage.
   */
  hotspots: FileDuplicationResult[];
}
export interface ProjectDuplicationResult {
  totalLines: number;
  duplicatedLines: number;
  /**
   * 0–100 duplication percentage.
   */
  duplicationPercentage: number;
  totalClones: number;
}
export interface FileDuplicationResult {
  filePath: string;
  /**
   * Lines involved in at least one clone.
   */
  duplicatedLines: number;
  totalLines: number;
  /**
   * 0–100 duplication percentage.
   */
  duplicationPercentage: number;
  /**
   * Distinct clone pairs involving this file.
   */
  cloneCount: number;
}
export interface CrossModuleDuplication {
  sourceModule: string;
  targetModule: string;
  cloneCount: number;
  totalDuplicatedLines: number;
}
/**
 * Per-module abstractness, instability, distance from main sequence, and zone classification.
 */
export interface ModuleMetricsSummary {
  modules: ModuleMetricsResult[];
  averageAbstractness: number;
  averageInstability: number;
  averageDistance: number;
  /**
   * Module IDs with low abstractness and low instability.
   */
  zoneOfPain: string[];
  /**
   * Module IDs with high abstractness and high instability.
   */
  zoneOfUselessness: string[];
}
export interface ModuleMetricsResult {
  moduleId: string;
  /**
   * Ratio of abstract/interface entities to total type entities, 0–1.
   */
  abstractness: number;
  /**
   * Ce / (Ca + Ce), range 0–1.
   */
  instability: number;
  /**
   * |A + I − 1|, 0 means on the main sequence.
   */
  distanceFromMainSequence: number;
  size: ModuleSize;
  /**
   * Ca: incoming edges from other modules.
   */
  afferentCoupling: number;
  /**
   * Ce: outgoing edges to other modules.
   */
  efferentCoupling: number;
}
export interface ModuleSize {
  fileCount: number;
  totalLoc: number;
  entityCount: number;
  classCount: number;
  interfaceCount: number;
  functionCount: number;
}
/**
 * Aggregate statistics and top offenders across all calculators.
 */
export interface AnalysisSummary {
  entityCount: number;
  relationshipCount: number;
  moduleCount: number;
  maxCyclomaticComplexity: number;
  avgCyclomaticComplexity: number;
  cycleCount: number;
  communityCount: number;
  overallDuplicationPercentage: number;
  mostComplexEntities: {
    entityId: string;
    cyclomatic: number;
  }[];
  mostCoupledEntities: {
    entityId: string;
    totalCoupling: number;
  }[];
  worstSrpEntities: {
    entityId: string;
    lcom4: number;
  }[];
  modulesInZoneOfPain: string[];
  modulesInZoneOfUselessness: string[];
}
/**
 * Execution timing for the analysis run.
 */
export interface Timing {
  totalMs: number;
  /**
   * Milliseconds spent in each calculator group.
   */
  perCalculator: {
    [k: string]: number | undefined;
  };
}
