/**
 * @aspect/viewer — Shared types for viewer components.
 *
 * Re-exports engine types and adds viewer-specific ones.
 */

import type {
  AnalysisResult,
  AnalysisSummary,
  GroupCouplingResult,
  GroupCouplingProfile,
  GroupPairCoupling,
  MergeCandidate,
  ArchitecturalSummary,
  Recommendation,
  Grouping,
  Group,
  CoherenceResult,
  MisplacedFile,
  CodeRoleClassification,
  CodeRole,
} from '@aspect/engine';

export type {
  AnalysisResult,
  AnalysisSummary,
  GroupCouplingResult,
  GroupCouplingProfile,
  GroupPairCoupling,
  MergeCandidate,
  ArchitecturalSummary,
  Recommendation,
  Grouping,
  Group,
  CoherenceResult,
  MisplacedFile,
  CodeRoleClassification,
  CodeRole,
};

/** Props for the main ArchitectureViewer component */
export interface ArchitectureViewerProps {
  /** Full analysis result from the engine */
  data: AnalysisResult;
  /** CSS class name for the root container */
  className?: string;
  /** Which grouping to display ('boundary' | 'reference' | 'directory') */
  defaultGrouping?: 'boundary' | 'reference' | 'directory';
  /** Initial panel to show */
  defaultPanel?: 'overview' | 'recommendations' | 'detail';
  /** Callback when a node (group or file) is selected */
  onNodeSelect?: (nodeId: string, type: 'group' | 'file') => void;
}

/** A node in the architecture graph (either a group or a file) */
export interface GraphNode {
  id: string;
  label: string;
  type: 'group' | 'file';
  parentId?: string;
  metrics: GroupNodeMetrics | FileNodeMetrics;
}

export interface GroupNodeMetrics {
  memberCount: number;
  internalCohesion: number;
  separabilityIndex: number;
  outboundEdges: number;
  inboundEdges: number;
  isMergeCandidate: boolean;
  isWellStructured: boolean;
  healthIndicator: 'good' | 'warning' | 'critical';
}

export interface FileNodeMetrics {
  codeRole: CodeRole;
  isMisplaced: boolean;
  suggestedGroup?: string;
  complexity?: number;
}

/** An edge in the architecture graph */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  typeOnlyRatio: number;
  isCycle: boolean;
  isMergeCandidate: boolean;
}

/** Currently selected item for detail panel */
export interface Selection {
  type: 'group' | 'file' | 'edge' | null;
  id: string;
}

/** Color palette */
export const COLORS = {
  good: '#22c55e',
  warning: '#f59e0b',
  critical: '#ef4444',
  neutral: '#94a3b8',
  // Code role colors
  utility: '#8b5cf6',
  contract: '#06b6d4',
  business_logic: '#3b82f6',
  presentation: '#ec4899',
  unknown: '#94a3b8',
  // Edge colors
  edgeNormal: '#94a3b8',
  edgeTypeOnly: '#06b6d4',
  edgeCycle: '#ef4444',
  edgeMerge: '#f59e0b',
  // Backgrounds
  groupBg: '#f8fafc',
  groupBorder: '#e2e8f0',
  fileBg: '#ffffff',
} as const;

/** Health indicator thresholds */
export function healthIndicator(separability: number, cohesion: number): 'good' | 'warning' | 'critical' {
  if (cohesion >= 0.7 && separability >= 0.6) return 'good';
  if (cohesion >= 0.4 || separability >= 0.4) return 'warning';
  return 'critical';
}

/** Format a 0-1 ratio as percentage */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Truncate file path for display */
export function shortPath(path: string, maxSegments = 3): string {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= maxSegments) return parts.join('/');
  return '…/' + parts.slice(-maxSegments).join('/');
}
