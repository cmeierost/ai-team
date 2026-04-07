/**
 * @aspect/engine — Structural pipeline shared types
 *
 * All types used across the structural analysis pipeline live here.
 * This avoids circular imports between step modules and gives one
 * place to understand the full data model.
 *
 * Pipeline stages:
 *   1. File classification    → FileCategory, FileClassification
 *   2. Code classification    → CodeContentRole, ContentClassification
 *   3. Import analysis        → RawDependencyEdge, FileCouplingStats
 *   4. Edge weighting         → WeightedEdge
 *   5. Clustering             → FilePairCoupling, FileCluster
 *   6. Package comparison     → PackageAlignment
 *   7. Folder comparison      → FolderFocus
 *   8. Optimization           → ClusterQuality, warnings, split candidates
 */

// ── Re-export from step 1 ───────────────────────────────────────────────

// FileCategory and FileClassification are defined in 1-file-classification.ts
// (self-contained, no cross-dependencies)

// ── Re-export from step 2 ───────────────────────────────────────────────

// CodeContentRole, ContentClassification etc are defined in 2-code-classification.ts
// (self-contained, no cross-dependencies)

// ── Step 3: Import analysis ─────────────────────────────────────────────

import type { FileCategory } from './1-file-classification.js';
import type { CodeContentRole } from './2-code-classification.js';
import type { EntryPointAnalysis } from './entry-point-analysis.js';
import type { FilesystemFitResult } from './filesystem-fit.js';
import type { MoveSuggestionResult } from './move-suggestions.js';
import type {
  MaintainabilityResults, ComplexityResults,
} from '@aspect/complexity';

/** A raw dependency edge extracted from collector relationships. */
export interface RawDependencyEdge {
  sourceFileId: string;
  targetFileId: string;
  isTypeOnly: boolean;
  relationshipKind?: string;
  sourceEntityKind?: string;
  targetEntityKind?: string;
  targetIsAbstraction?: boolean;
  /** Signature surface of the target entity (paramCount + typeComplexity). */
  targetSignatureSurface?: number;
  /** When the source entity narrows the target type via Pick/Omit/etc. */
  sourceNarrowingKind?: string;
  /** For Pick/Omit: number of fields selected/excluded from the target. */
  sourceNarrowedFieldCount?: number;
}

/** Per-file import statistics. */
export interface FileCouplingStats {
  fanIn: number;
  fanOut: number;
  incomingTotal: number;
  incomingTypeOnly: number;
  incomingValue: number;
  typeOnlyInRatio: number;
  outgoingTotal: number;
  outgoingTypeOnly: number;
  outgoingValue: number;
  typeOnlyOutRatio: number;
}

// ── Step 4: Edge weighting ──────────────────────────────────────────────

/** Info about a file for weighting. */
export interface FileInfo {
  fileId: string;
  filePath?: string;
  category: FileCategory;
  contentRole?: CodeContentRole;
}

/** A dependency edge with computed weight. */
export interface WeightedEdge {
  sourceFileId: string;
  targetFileId: string;
  isTypeOnly: boolean;
  weight: number;
  weightReason: string;
}

// ── Step 5: Clustering ──────────────────────────────────────────────────

/** Aggregated coupling between two files (both directions). */
export interface FilePairCoupling {
  fileA: string;
  fileB: string;
  edgesAtoB: number;
  edgesBtoA: number;
  typeOnlyAtoB: number;
  typeOnlyBtoA: number;
  couplingScore: number;
  /** 0 = fully unidirectional, 1 = perfectly symmetric */
  directionality: number;
  isConcern: boolean;
  pattern: CouplingPattern;
}

export type CouplingPattern =
  | 'healthy-unidirectional'
  | 'contract-consumer'
  | 'mutual-type-coupling'
  | 'mutual-value-coupling'
  | 'tight-bidirectional'
  | 'negligible';

/** A cluster of files that belong together by mutual coupling. */
export interface FileCluster {
  id: string;
  fileIds: string[];
  cohesionType: ClusterCohesionType;
  internalCoupling: number;
  externalCoupling: number;
  /** internalCoupling / (internal + external) — higher = better */
  cohesionRatio: number;
}

export type ClusterCohesionType =
  | 'mutual-dependencies'
  | 'shared-consumers'
  | 'shared-providers'
  | 'directory-proximity';

// ── Step 6: Package comparison ──────────────────────────────────────────

/** How well a package boundary aligns with natural clusters. */
export interface PackageAlignment {
  packageId: string;
  fileCount: number;
  clusterIds: string[];
  unclusteredCount: number;
  alignmentScore: number;
  spilledClusters: SpilledCluster[];
}

export interface SpilledCluster {
  clusterId: string;
  insideCount: number;
  outsideCount: number;
  containment: number;
}

// ── Step 7: Folder comparison ───────────────────────────────────────────

/** Analysis result for a single directory. */
export interface FolderFocus {
  folderPath: string;
  fileCount: number;
  clusterCount: number;
  roleCount: number;
  roleMix: Record<string, number>;
  clusterMix: Record<string, number>;
  unclusteredCount: number;
  focusScore: number;
  assessment: FolderAssessment;
}

export type FolderAssessment =
  | 'focused'
  | 'role-mixed'
  | 'cluster-scattered'
  | 'mixed'
  | 'unclustered'
  | 'trivial';

// ── Step 8: Optimization ────────────────────────────────────────────────

/** What we know about each file for alignment analysis. */
export interface StructuralFileInfo {
  fileId: string;
  filePath: string;
  category: FileCategory;
  contentRole?: CodeContentRole;
  packageId?: string;
  linesOfCode?: number;
}

/** Quality assessment for a cluster. */
export interface ClusterQuality {
  clusterId: string;
  fileCount: number;
  roleMix: Record<string, number>;
  dominantRole: CodeContentRole | 'unknown';
  dominantRoleRatio: number;
  hasMixedConcerns: boolean;
  concernConflict?: string;
  packageCount: number;
  packages: string[];
  spansPackages: boolean;
  folderCount: number;
  folders: string[];
  folderSeparated?: boolean;
}

/** A file that bridges multiple clusters — split candidate. */
export interface FileSplitCandidate {
  fileId: string;
  filePath: string;
  clusterIds: string[];
  edgesPerCluster: Record<string, number>;
  splitConfidence: number;
  contentRole?: CodeContentRole;
}

export interface StructuralWarning {
  kind: WarningKind;
  severity: 'info' | 'warning' | 'critical';
  target: string;
  message: string;
  value: number;
  threshold: number;
}

export type WarningKind =
  | 'file-too-large'
  | 'cluster-too-large'
  | 'cluster-mixed-concerns'
  | 'cluster-spans-packages'
  | 'package-needs-subfolders'
  | 'folder-unfocused'
  | 'package-misaligned'
  | 'bridge-file'
  | 'low-cohesion'
  | 'misplaced-file'
  | 'tangled-directory';

export interface WarningThresholds {
  maxFileLoc: number;
  maxClusterSize: number;
  minFolderFocus: number;
  minPackageAlignment: number;
}

export const DEFAULT_THRESHOLDS: WarningThresholds = {
  maxFileLoc: 300,
  maxClusterSize: 30,
  minFolderFocus: 0.5,
  minPackageAlignment: 0.7,
};

// ── Full result types ───────────────────────────────────────────────────

/** Full structural alignment result. */
export interface StructuralAlignmentResult {
  folderFocus: FolderFocus[];
  splitCandidates: FileSplitCandidate[];
  packageAlignment: PackageAlignment[];
  clusterQuality: ClusterQuality[];
  warnings: StructuralWarning[];
}

/** Classification for a single file (steps 1 + 2 combined). */
export interface FileClassificationEntry {
  fileId: string;
  filePath: string;
  category: FileCategory;
  contentRole?: CodeContentRole;
  linesOfCode?: number;
  packageId?: string;
  /** LCOM4 score (worst across classes in this file). 1 = cohesive, >1 = split candidate. */
  lcom4?: number;
  fileClassification: import('./1-file-classification.js').FileClassification;
  contentClassification?: import('./2-code-classification.js').ContentClassification;
}

/** Full result of the structural pipeline. */
export interface StructuralPipelineResult {
  fileClassifications: FileClassificationEntry[];
  weightedEdges: WeightedEdge[];
  pairCouplings: FilePairCoupling[];
  clusters: FileCluster[];
  alignment: StructuralAlignmentResult;
  communities?: CommunityDetectionResult;
  filesystemFit?: FilesystemFitResult;
  moveSuggestions?: MoveSuggestionResult;
  groupingComparisons?: PipelineGroupingComparison[];
  centrality?: FileCentrality[];
  exportAnalysis?: ExportAnalysis;
  fileMetrics?: FileInterfaceMetrics[];
  entryPointAnalysis?: EntryPointAnalysis;
  referenceDiagnostics?: import('./reference-diagnostics.js').ReferenceDiagnostics;
  locMetrics?: import('./loc-metrics.js').CanonicalLocMetrics;
  nonQualifiedDiagnostics?: import('./nonqualified-diagnostics.js').NonQualifiedDiagnostics;
  roleSeparation?: import('./role-separation.js').RoleSeparationMetrics;
  hierarchySummary?: import('./hierarchy-analysis.js').EntityHierarchySummary;
  inventorySummary?: import('./inventory-summary.js').InventorySummary;
  coverageValidation?: import('./coverage-validation.js').CoverageValidation;
  entityClassification?: import('./entity-classification.js').EntityClassificationSummary;
  recommendations?: PipelineRecommendation[];
  healthScore?: number;
  complexity?: ComplexityResults & { maintainability: MaintainabilityResults };
  summary: PipelineSummary;
}

// ── Export analysis ─────────────────────────────────────────────────────

/** A single exported symbol from a file. */
export interface ExportedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type-alias' | 'enum' | 'namespace' | 'field' | 'method' | 'property' | 'other';
  nature: 'logic' | 'contract';
  /** Number of files that import from this file (file-level, not per-symbol). */
  fileRefs: number;
  linesOfCode?: number;
}

/** Per-file export summary. */
export interface FileExportInfo {
  fileId: string;
  filePath: string;
  exports: ExportedSymbol[];
  totalExports: number;
  logicExports: number;
  contractExports: number;
  /** Number of distinct files that import from this file. */
  consumerCount: number;
  /** True when no other tracked file imports this file. */
  isDeadFile: boolean;
  /** File paths this file re-exports from (barrel files). */
  reexportSources?: string[];
  /** Re-export targets that are outside the barrel's ancestor chain (violations). */
  reexportViolations?: BarrelViolation[];
}

/** A barrel file re-exporting from outside its folder lineage/branch. */
export interface BarrelViolation {
  /** The barrel file path. */
  barrelPath: string;
  /** The imported file that is outside the barrel's lineage. */
  targetPath: string;
  /** The barrel's directory. */
  barrelDir: string;
}

/** Top-level export analysis result. */
export interface ExportAnalysis {
  files: FileExportInfo[];
  totalExports: number;
  totalLogicExports: number;
  totalContractExports: number;
  deadFileCount: number;
  deadExportLoc: number;
  /** Barrel files re-exporting across unrelated branches. */
  barrelViolations: BarrelViolation[];
}

export type InterfaceChangeRiskBand = 'low' | 'medium' | 'high' | 'critical';

/** Canonical per-file interface-change and shared-responsibility metrics. */
export interface FileInterfaceMetrics {
  fileId: string;
  filePath: string;
  linesOfCode: number;
  exportedEntityCount: number;
  exportedFunctionLikeCount: number;
  exportedTypeLikeCount: number;
  exportedClassCount: number;
  exportedParameterCount: number;
  exportedPublicPropertyCount: number;
  incomingTypeRefs: number;
  incomingValueRefs: number;
  outgoingTypeRefs: number;
  outgoingValueRefs: number;
  consumerFileCount: number;
  consumerClusterCount: number;
  consumerSuperclusterCount: number;
  singleConsumerExportCount: number;
  singleConsumerExportRatio: number;
  interfaceSurfaceComplexityScore: number;
  implementationComplexityScore: number;
  hiddenComplexityRatio: number;
  sharedResponsibilityLeakScore: number;
  interfaceChangeCostScore: number;
  interfaceChangeRiskBand: InterfaceChangeRiskBand;
}

/** Exposure summary for one dependency group boundary. */
export interface ClusterExposure {
  clusterId: string;
  totalLoc: number;
  exposedLoc: number;
  exposureRatio: number;
  exposedFileCount: number;
  directExposureLoc: number;
  barrelExposureLoc: number;
}

export interface PipelineSummary {
  totalFiles: number;
  codeFiles: number;
  categoryCounts: Record<string, number>;
  roleCounts: Record<string, number>;
  clusterCount: number;
  avgClusterSize: number;
  maxClusterSize: number;
  warningCount: number;
  criticalWarningCount: number;
  focusedFolderCount: number;
  unfocusedFolderCount: number;
  splitCandidateCount: number;
  oversizedFileCount: number;
  communityCount?: number;
  misplacedFileCount?: number;
  tangledDirectoryCount?: number;
  bridgeFileCount?: number;
  filesystemFitScore?: number;
  moveSuggestionCount?: number;
  healthScore?: number;
  recommendationCount?: number;
  appEntryPointCount?: number;
  exclusiveFileCount?: number;
  sharedFileCount?: number;
  unreachableFileCount?: number;
  resolutionRate?: number;
  totalCanonicalLoc?: number;
  nonQualifiedRatio?: number;
  avgClusterSeparation?: number;
  /** Average Maintainability Index across all function-like entities */
  avgMaintainabilityIndex?: number;
  /** Count of entities with MI in red band (0-9) */
  miRedCount?: number;
  /** Count of entities with MI in yellow band (10-19) */
  miYellowCount?: number;
  /** Count of entities with MI in green band (20-100) */
  miGreenCount?: number;
  /** Entity-level concern distribution: count of entities per concern */
  entityConcernCounts?: Record<string, number>;
  /** Entity-level concern LOC distribution */
  entityConcernLoc?: Record<string, number>;
}

export interface StructuralPipelineOptions {
  thresholds?: Partial<WarningThresholds>;
  /** Language profiles for classification. Defaults to [TYPESCRIPT_PROFILE]. */
  profiles?: import('./language-profile.js').LanguageProfile[];
  /** File inventory from collectors (optional enrichment) */
  fileInventory?: Array<{
    filePath: string;
    fileCategory: string;
    isAnalyzedLanguage: boolean;
    fileSizeBytes: number;
    totalLines?: number;
    blankLines?: number;
    commentLines?: number;
  }>;
}

// ── Step 5b: Community detection (Louvain) ──────────────────────────────

/** A community of files detected by the Louvain algorithm. */
export interface Community {
  id: string;
  memberFileIds: string[];
  totalLoc?: number;
  dominantTechnology?: string;
  dominantRole?: CodeContentRole;
  exposureRatio?: number;
}

export type SuperClusterChild =
  | { kind: 'supercluster'; cluster: SuperCluster }
  | { kind: 'community'; communityId: string };

/** A supercluster groups related communities for high-level navigation. */
export interface SuperCluster {
  id: string;
  label: string;
  /** LOC of shared contract/infrastructure code between this node's children. */
  sharedContractLoc: number;
  /** File IDs of shared contract/infrastructure code this scope coordinates. */
  sharedContractFileIds: string[];
  totalFiles: number;
  dominantTechnology?: string;
  dominantRole?: CodeContentRole;
  coordinatorScope: string;
  exposureRatio?: number;
  children: SuperClusterChild[];
}

/** A file whose dependency community doesn't match its directory. */
export interface MisplacedFile {
  fileId: string;
  filePath: string;
  currentDirectory: string;
  communityId: string;
  /** The directory where most community members live. */
  suggestedDirectory: string;
  /** How many community peers live in the suggested directory. */
  peerCount: number;
}

/** A directory that contains files from many different communities. */
export interface TangledDirectory {
  directory: string;
  communityCount: number;
  communityIds: string[];
  fileCount: number;
}

export interface CommunityDetectionResult {
  communities: Community[];
  superClusters: SuperCluster[];
  clusterExposure?: ClusterExposure[];
  superClusterExposure?: ClusterExposure[];
  modularity: number;
  misplacedFiles: MisplacedFile[];
  tangledDirectories: TangledDirectory[];
}

// ── Steps 6–7 enrichment: Grouping comparison (ARI / NMI) ──────────────

/** A named partition of files into groups. */
export interface PipelineGrouping {
  id: string;
  label: string;
  groups: PipelineGroup[];
}

export interface PipelineGroup {
  id: string;
  label: string;
  memberFileIds: string[];
}

/** Result of comparing two groupings with ARI and NMI. */
export interface PipelineGroupingComparison {
  sourceId: string;
  targetId: string;
  /** Adjusted Rand Index (chance-corrected, 0–1). */
  ari: number;
  /** Normalized Mutual Information (0–1). */
  nmi: number;
  mismatches: PipelineGroupMismatch[];
  suggestions: PipelineMoveSuggestion[];
}

export interface PipelineGroupMismatch {
  fileId: string;
  filePath: string;
  sourceGroupId: string;
  targetGroupId: string;
}

export interface PipelineMoveSuggestion {
  fileId: string;
  filePath: string;
  fromGroup: string;
  toGroup: string;
  reason: string;
}

// ── Step 8 enrichment: Centrality ───────────────────────────────────────

/** Centrality scores for a single file. */
export interface FileCentrality {
  fileId: string;
  filePath: string;
  betweenness: number;
  pageRank: number;
  /** True when this file bridges two or more clusters. */
  isBridge: boolean;
  bridgeBetween?: [string, string];
}

// ── Step 9: Recommendations ─────────────────────────────────────────────

export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low';
export type RecommendationCategory =
  | 'file-move'
  | 'cluster-split'
  | 'folder-cleanup'
  | 'bridge-decouple'
  | 'cohesion-split'
  | 'cycle-break';

/** A single actionable recommendation from the pipeline. */
export interface PipelineRecommendation {
  id: string;
  priority: RecommendationPriority;
  category: RecommendationCategory;
  title: string;
  description: string;
  fileIds: string[];
  filePaths: string[];
  impact: number;
}

// ── Helpers shared across steps ─────────────────────────────────────────

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function parentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.substring(0, lastSlash) : '.';
}

export function buildFileClusterIndex(clusters: FileCluster[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const cluster of clusters) {
    for (const fileId of cluster.fileIds) {
      let list = index.get(fileId);
      if (!list) { list = []; index.set(fileId, list); }
      list.push(cluster.id);
    }
  }
  return index;
}
