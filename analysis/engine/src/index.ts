// @aspect/engine — Technology-agnostic code analysis calculation engine

export {
  analyze,
  type AnalysisInput,
  type AnalysisOptions,
  type AnalysisResult,
  type AnalysisSummary,
  type CalculatorGroup,
  type CouplingSection,
} from './orchestrator.js';

export {
  calculateCyclomatic,
  calculateCognitive,
  calculateHalstead,
  calculateComplexity,
  summarizeFileComplexity,
  type Entity,
  type CyclomaticResult,
  type CognitiveResult,
  type HalsteadMetrics,
  type HalsteadResult,
  type FileComplexitySummary,
  type ComplexityResults,
} from './complexity.js';

export {
  calculateCoupling,
  calculateModuleDependencyMatrix,
  calculateModuleCohesion,
  type CouplingResult,
  type ModuleDependencyMatrix,
  type ModuleCohesion,
  type CouplingOptions,
} from './coupling.js';

export {
  calculateGraphMetrics,
  buildDependencyGraph,
  detectCycles,
  calculateCentrality,
  calculatePageRank,
  detectCommunities,
  type GraphMetricsResult,
  type CycleInfo,
  type CentralityResult,
  type PageRankResult,
  type CommunityResult,
} from './graph-metrics.js';

export {
  calculateLcom4,
  type Lcom4Result,
} from './cohesion.js';

export {
  calculateSolidIndicators,
  type SrpIndicator,
  type OcpIndicator,
  type IspIndicator,
  type DipIndicator,
  type LspIndicator,
  type SolidResults,
} from './solid.js';

export {
  calculateDuplication,
  type FileDuplicationResult,
  type ProjectDuplicationResult,
  type CrossModuleDuplication,
  type DuplicationResults,
  type DuplicationOptions,
} from './duplication.js';

export {
  calculateModuleMetrics,
  type ModuleMetricsResult,
  type ModuleMetricsSummary,
} from './module-metrics.js';

export {
  calculateFolderDistance,
  calculateHierarchyMetrics,
  type HierarchyMetrics,
  type RelationshipDistance,
  type DistanceDistribution,
  type UtilityFile,
  type LongDistanceImport,
  type HierarchyOptions,
} from './hierarchy.js';

export {
  calculateCoherence,
  type CoherenceResult,
  type CoherenceOptions,
  type DirectoryGroup,
  type CrossReference,
  type CommunityMapping,
  type MisplacedFile,
  type TangledDirectory,
  type DirectoryCouplingMatrix,
} from './coherence.js';

export {
  classifyCodeRoles,
  type CodeRole,
  type CodeRoleClassification,
  type RoleSignal,
  type CodeRoleResult,
  type CodeRoleOptions,
} from './code-roles.js';

export {
  buildReferenceGrouping,
  buildDirectoryGrouping,
  buildBoundaryGrouping,
  buildCustomGrouping,
  compareGroupings,
  matchFileList,
  type GroupingKind,
  type Group,
  type Grouping,
  type GroupingComparison,
  type GroupOverlap,
  type GroupingMismatch,
  type MoveSuggestion,
  type FileListMatch,
} from './grouping.js';

export {
  calculateGroupCoupling,
  type GroupPairCoupling,
  type GroupCouplingProfile,
  type MergeCandidate,
  type GroupCouplingResult,
  type GroupCouplingOptions,
} from './group-coupling.js';

export {
  generateRecommendations,
  type ArchitecturalSummary,
  type Recommendation,
  type RecommendationPriority,
  type RecommendationCategory,
} from './recommendations.js';

export {
  buildLocationMap,
  type SourceLocation,
} from './location.js';

export {
  toSarif,
  toDot,
  toGraphML,
  toSonarQube,
  toJson,
  type SarifOptions,
  type SarifLog,
  type SarifRun,
  type SarifRule,
  type SarifResult,
  type SarifLocation,
  type DotOptions,
  type SonarQubeReport,
  type SonarQubeIssue,
  type JsonExportOptions,
  type CollectedData,
} from './output/index.js';
