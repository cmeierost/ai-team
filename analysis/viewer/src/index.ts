/**
 * @aspect/viewer — Public API.
 */

export { ArchitectureViewer } from './ArchitectureViewer.js';
export type { ArchitectureViewerProps } from './ArchitectureViewer.js';

export { ClusterNode } from './components/ClusterNode.js';
export type { ClusterNodeData } from './components/ClusterNode.js';

export { FileNode } from './components/FileNode.js';
export type { FileNodeData } from './components/FileNode.js';
export { FileEntitiesPane } from './components/FileEntitiesPane.js';

export { OverviewBar } from './components/OverviewBar.js';
export { DetailPanel } from './components/DetailPanel.js';
export { ProblemsPanel } from './components/ProblemsPanel.js';
export { HelpTooltip } from './components/HelpTooltip.js';

export { StatsPanel } from './components/StatsPanel.js';
export type { StatsPanelProps } from './components/StatsPanel.js';

export { useClusterGraph } from './hooks/useClusterGraph.js';
export { useClusterDrilldown } from './hooks/useClusterDrilldown.js';

export type {
  StructuralPipelineResult,
  FileClassificationEntry,
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
  ViewerProps,
  SidePanel,
  Selection,
  ClusterEdge,
  ViewerGroup,
  NonCodeBreakdown,
  ProblemCategory,
  ProblemItem,
  EntityRefLite,
  RelationshipRefLite,
} from './types.js';

export {
  ROLE_COLORS, CATEGORY_COLORS, CATEGORY_ICONS, SEVERITY_COLORS,
  healthColor, pct, shortPath, shortName,
} from './types.js';
