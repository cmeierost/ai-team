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
export { analysePackageAlignment, matchCommunityGroupsToPackages, comparePackages } from './6-package-comparison.js';
export { analyseFolderFocus, assessFolder } from './7-folder-comparison.js';
export { computeCommunityGlobs } from './7-community-globs.js';
export { compareContexts } from './10-context-comparison.js';
export {
  analyseClusterQuality, findSplitCandidates,
  generateWarnings, analyseStructuralAlignment,
} from './8-optimization.js';

// ── New enrichment modules ──────────────────────────────────────────────

export { detectCommunities } from './community-detection.js';
export {
  buildCommunityGrouping, buildDirectoryGrouping, buildBoundaryGrouping,
  compareGroupings, compareAllGroupings,
  computeARI, computeNMI,
} from './grouping-comparison.js';
export { computeCentrality } from './centrality.js';
export { generateRecommendations, calculateHealthScore } from './9-recommendations.js';
export { computeFilesystemFit } from './filesystem-fit.js';
export { generateMoveSuggestions } from './move-suggestions.js';
export { analyseExports } from './export-analysis.js';
export {
  discoverAppEntryPoints, analyseReachability, analyseEntryPoints,
} from './entry-point-analysis.js';
export { computeFileInterfaceMetrics } from './file-metrics.js';
export { computeReferenceDiagnostics } from './reference-diagnostics.js';
export { computeCanonicalLocMetrics } from './loc-metrics.js';
export { computeNonQualifiedDiagnostics } from './nonqualified-diagnostics.js';
export { computeRoleSeparation } from './role-separation.js';
export { computeHierarchySummary } from './hierarchy-analysis.js';
export { computeInventorySummary } from './inventory-summary.js';
export { computeCoverageValidation } from './coverage-validation.js';
export { classifyEntityConcern, classifyAllEntities } from './entity-classification.js';

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
  EntityGraphArtefact, CommunityMapArtefact, CrossGroupEdge,
  PackageAlignment, SpilledCluster,
  CommunityGroupPackageMatch, PackageComparisonResult,
  FolderFocus, FolderAssessment,
  StructuralFileInfo, ClusterQuality,
  FileSplitCandidate,
  StructuralWarning, WarningKind, WarningThresholds,
  StructuralAlignmentResult,
  FileClassificationEntry, StructuralPipelineResult,
  PipelineSummary, StructuralPipelineOptions,
  // New types
   Community, CommunityGroup, MisplacedFile, TangledDirectory, CommunityDetectionResult,
   CommunityGroupChild, ClusterExposure, SplitFileCandidate,
  PipelineGrouping, PipelineGroup,
  PipelineGroupingComparison, PipelineGroupMismatch, PipelineMoveSuggestion,
   FileCentrality,
   PipelineRecommendation, RecommendationPriority, RecommendationCategory,
   FileInterfaceMetrics, InterfaceChangeRiskBand,
   ExportAnalysis, FileExportInfo, ExportedSymbol, BarrelViolation,
} from './types.js';
export type {
  CommunityGlobFingerprint, CommunityGlobResult,
} from './7-community-globs.js';
export type {
  FileContextInput, ContextComparisonResult, ContextComparisonEntry,
  ContextCommunityCoverage, ContextGroupCoverage,
} from './10-context-comparison.js';
export type {
  FilesystemFitResult, DirectoryFitInfo, MisplacedFileInfo,
} from './filesystem-fit.js';
export type {
  MoveSuggestion, MoveImpact, MoveSuggestionResult,
} from './move-suggestions.js';
export type {
  ReferenceDiagnostics, FileReferenceDiagnostic,
} from './reference-diagnostics.js';
export type {
  CanonicalLocMetrics, FileLocMetrics,
} from './loc-metrics.js';
export type {
  NonQualifiedDiagnostics, FileNonQualifiedInfo,
} from './nonqualified-diagnostics.js';
export type {
  RoleSeparationMetrics, ClusterRoleSeparation, RepoRoleSummary,
} from './role-separation.js';
export type {
  EntityHierarchySummary, FileHierarchyInfo,
} from './hierarchy-analysis.js';
export type {
  InventorySummary, FileInventoryInput,
} from './inventory-summary.js';
export type {
  CoverageValidation,
} from './coverage-validation.js';
export type {
  EntityConcern, EntityConcernResult, EntityClassificationSummary,
} from './entity-classification.js';
export type {
  ComplexityResults, MaintainabilityResults, MaintainabilityResult,
  FileMaintainabilitySummary, MIRiskBand,
  FileComplexitySummary, HalsteadResult, HalsteadMetrics,
  CyclomaticResult, CognitiveResult,
} from '@aspect/complexity';
export type {
  AppEntryPoint, EntryPointEvidence, FileReachability, FileScope, EntryPointAnalysis,
} from './entry-point-analysis.js';
export { DEFAULT_THRESHOLDS, round3, parentDir, buildFileCommunityIndex } from './types.js';
