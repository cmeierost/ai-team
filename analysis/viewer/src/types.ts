/**
 * @aspect/viewer — Types and constants for the structural viewer.
 */

import type {
  StructuralPipelineResult,
  FileClassificationEntry,
  FileCluster,
  ClusterQuality,
  StructuralWarning,
  PipelineSummary,
  PipelineRecommendation,
  MisplacedFile,
  FileSplitCandidate,
  TangledDirectory,
  FileCentrality,
  WeightedEdge,
  CodeContentRole,
  Community,
  SuperCluster,
  SuperClusterChild,
  ClusterExposure,
  ExportAnalysis,
  FileExportInfo,
  ExportedSymbol,
  FileInterfaceMetrics,
  InterfaceChangeRiskBand,
  MaintainabilityResult,
  FileMaintainabilitySummary,
  MIRiskBand,
} from '@aspect/structural';

export type {
  StructuralPipelineResult,
  FileClassificationEntry,
  FileCluster,
  ClusterQuality,
  StructuralWarning,
  PipelineSummary,
  PipelineRecommendation,
  MisplacedFile,
  FileSplitCandidate,
  TangledDirectory,
  FileCentrality,
  WeightedEdge,
  CodeContentRole,
  Community,
  SuperCluster,
  SuperClusterChild,
  ClusterExposure,
  ExportAnalysis,
  FileExportInfo,
  ExportedSymbol,
  FileInterfaceMetrics,
  InterfaceChangeRiskBand,
  MaintainabilityResult,
  FileMaintainabilitySummary,
  MIRiskBand,
};

// ── Viewer props ────────────────────────────────────────────────────────

export interface ViewerProps {
  data: StructuralPipelineResult;
  className?: string;
}

export interface EntityRefLite {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  parentEntityId?: string | null;
  classification?: {
    isExported?: boolean;
    isTypeOnly?: boolean;
    isConcrete?: boolean;
    visibility?: string | null;
    codeConcern?: 'contract' | 'presentation' | 'logic' | 'unknown';
  };
  rawCounts?: {
    linesOfCode?: number | null;
    parameterCount?: number | null;
    returnStatements?: number | null;
    branchPoints?: number | null;
    publicPropertyCount?: number | null;
    publicMethodCount?: number | null;
    jsxElementCount?: number | null;
  };
}

export interface RelationshipRefLite {
  sourceEntityId: string;
  targetEntityId: string;
  kind: string;
  typeOnly?: boolean;
  crossPackage?: boolean;
  dynamic?: boolean;
}

export type SidePanel = 'detail' | 'problems' | 'stats';

export interface Selection {
  type: 'cluster' | 'file' | 'supercluster' | null;
  id: string;
}

// ── Aggregated inter-cluster edge (for the graph) ───────────────────────

export interface ClusterEdge {
  sourceClusterId: string;
  targetClusterId: string;
  totalWeight: number;
  edgeCount: number;
  typeOnlyCount: number;
  reexportCount: number;
}

/**
 * Unified group representation for the graph.
 * A group can come from union-find clusters or Louvain communities.
 */
export interface ViewerGroup {
  id: string;
  label: string;
  fileIds: string[];
  source: 'cluster' | 'community';
  /** Only set for cluster groups */
  cohesionRatio?: number;
  /** Only set for cluster groups */
  cohesionType?: string;
}

// ── Problem categories ──────────────────────────────────────────────────

export type ProblemCategory =
  | 'misplaced'
  | 'split-candidate'
  | 'tangled-dir'
  | 'mixed-concerns'
  | 'warnings';

export interface ProblemItem {
  id: string;
  category: ProblemCategory;
  severity: 'critical' | 'warning' | 'info';
  target: string;
  targetType: 'file' | 'cluster' | 'directory';
  title: string;
  detail: string;
}

// ── Colors ──────────────────────────────────────────────────────────────

export const ROLE_COLORS: Record<string, string> = {
  contract:       '#06b6d4',
  logic:          '#3b82f6',
  presentation:   '#ec4899',
  infrastructure: '#8b5cf6',
  entry_point:    '#f59e0b',
  barrel:         '#78716c',
  reexport:       '#a8a29e',
  unknown:        '#94a3b8',
};

/** Colors for non-code file categories. */
export const CATEGORY_COLORS: Record<string, string> = {
  test:           '#22c55e',
  config:         '#6b7280',
  documentation:  '#60a5fa',
  ai_config:      '#a78bfa',
  binary:         '#374151',
  style:          '#f472b6',
  markup:         '#fb923c',
  data:           '#2dd4bf',
  script:         '#fbbf24',
  unknown:        '#d1d5db',
};

/** Emoji shorthand for category badges. */
export const CATEGORY_ICONS: Record<string, string> = {
  test:           '🧪',
  config:         '⚙️',
  documentation:  '📄',
  ai_config:      '🤖',
  binary:         '📦',
  style:          '🎨',
  markup:         '📝',
  data:           '💾',
  script:         '📜',
  unknown:        '❓',
};

export const SEVERITY_COLORS = {
  critical: '#f44336',
  warning:  '#ff9800',
  info:     '#3794ff',
} as const;

/** Non-code files associated with a group by path. */
export interface NonCodeBreakdown {
  total: number;
  byCategory: { category: string; count: number; files: string[] }[];
}

export function healthColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 50) return '#ff9800';
  return '#f44336';
}

// ── Helpers ─────────────────────────────────────────────────────────────

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function shortPath(path: string, maxSegments = 3): string {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= maxSegments) return parts.join('/');
  return '…/' + parts.slice(-maxSegments).join('/');
}

export function shortName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1];
}
