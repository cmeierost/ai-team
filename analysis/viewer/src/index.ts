// @aspect/viewer — Public API

export { ArchitectureViewer } from './ArchitectureViewer.js';
export { GroupNode } from './components/GroupNode.js';
export { FileNode } from './components/FileNode.js';
export { OverviewPanel } from './components/OverviewPanel.js';
export { RecommendationsPanel } from './components/RecommendationsPanel.js';
export { DetailPanel } from './components/DetailPanel.js';
export { useGraphLayout } from './hooks/useGraphLayout.js';

export type { ArchitectureViewerProps } from './types.js';
export type { GroupNodeData, FileNodeData, GroupingMode, UseGraphLayoutResult } from './hooks/useGraphLayout.js';

// Re-export key engine types for convenience
export type {
  AnalysisResult,
  AnalysisSummary,
  GroupCouplingResult,
  GroupCouplingProfile,
  ArchitecturalSummary,
  Recommendation,
  Grouping,
  Group,
} from './types.js';
