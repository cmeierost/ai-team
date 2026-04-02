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
