/**
 * @aspect/engine — Structural pipeline public API
 *
 * Re-exports everything that consumers need from the structural
 * analysis subsystem. Import from here rather than individual files.
 */

// ── Step modules (for direct use / testing) ─────────────────────────────

export {
  classifyByFilename,
  CODE_EXTENSIONS, STYLE_EXTENSIONS, MARKUP_EXTENSIONS,
  DATA_EXTENSIONS, BINARY_EXTENSIONS, DOC_EXTENSIONS,
  CONFIG_FILE_NAMES, CONFIG_FILE_PATTERNS,
  TEST_FILE_PATTERNS, TEST_DIR_PATTERNS,
  AI_CONFIG_PATTERNS,
  type FileCategory, type FileClassification,
} from './1-file-classification.js';
export {
  classifyCodeContent, computeComposition, collectCouplingSignals,
  type CodeContentRole, type ContentClassification, type ContentSignal,
  type ClassifyContentInput, type ClassifiableEntity, type FileCouplingInfo,
} from './2-code-classification.js';
export { buildRawEdges, computeFileCouplingStats } from './3-import-analysis.js';
export { weightEdge, weightAllEdges, WEIGHTS } from './4-edge-weighting.js';
export { analysePairCoupling, classifyPattern, buildClusters } from './5-clustering.js';
export { analysePackageAlignment } from './6-package-comparison.js';
export { analyseFolderFocus, assessFolder } from './7-folder-comparison.js';
export {
  analyseClusterQuality, findSplitCandidates,
  generateWarnings, analyseStructuralAlignment,
} from './8-optimization.js';

// ── New enrichment modules ──────────────────────────────────────────────

export { detectCommunities } from './community-detection.js';
export {
  buildCommunityGrouping, buildDirectoryGrouping, buildBoundaryGrouping,
  compareGroupings, compareAllGroupings,
} from './grouping-comparison.js';
export { computeCentrality } from './centrality.js';
export { generateRecommendations, calculateHealthScore } from './9-recommendations.js';
export { analyseExports } from './export-analysis.js';
export {
  discoverAppEntryPoints, analyseReachability, analyseEntryPoints,
} from './entry-point-analysis.js';
export { computeFileInterfaceMetrics } from './file-metrics.js';

// ── Pipeline orchestrator ───────────────────────────────────────────────

export { runStructuralPipeline } from './pipeline.js';

// ── Language profiles ────────────────────────────────────────────────────

export type { LanguageProfile, MergedFileHints } from './language-profile.js';
export { mergeFileHints, findProfileForExtension } from './language-profile.js';
export { TYPESCRIPT_PROFILE } from './profiles/typescript.js';

// ── All types ───────────────────────────────────────────────────────────

export type {
  RawDependencyEdge, FileCouplingStats,
  FileInfo, WeightedEdge,
  FilePairCoupling, CouplingPattern, FileCluster, ClusterCohesionType,
  PackageAlignment, SpilledCluster,
  FolderFocus, FolderAssessment,
  StructuralFileInfo, ClusterQuality,
  FileSplitCandidate,
  StructuralWarning, WarningKind, WarningThresholds,
  StructuralAlignmentResult,
  FileClassificationEntry, StructuralPipelineResult,
  PipelineSummary, StructuralPipelineOptions,
  // New types
   Community, SuperCluster, MisplacedFile, TangledDirectory, CommunityDetectionResult,
   SuperClusterChild, ClusterExposure,
  PipelineGrouping, PipelineGroup,
  PipelineGroupingComparison, PipelineGroupMismatch, PipelineMoveSuggestion,
   FileCentrality,
   PipelineRecommendation, RecommendationPriority, RecommendationCategory,
   FileInterfaceMetrics, InterfaceChangeRiskBand,
   ExportAnalysis, FileExportInfo, ExportedSymbol, BarrelViolation,
} from './types.js';
export type {
  AppEntryPoint, EntryPointEvidence, FileReachability, FileScope, EntryPointAnalysis,
} from './entry-point-analysis.js';
export { DEFAULT_THRESHOLDS, round3, parentDir, buildFileClusterIndex } from './types.js';
