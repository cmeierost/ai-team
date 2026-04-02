/**
 * @aspect/viewer — Main ArchitectureViewer component
 *
 * Combines the graph view, overview dashboard, recommendations panel,
 * and detail panel into a unified architecture visualization.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { GroupNode } from './components/GroupNode.js';
import { FileNode } from './components/FileNode.js';
import { OverviewPanel } from './components/OverviewPanel.js';
import { RecommendationsPanel } from './components/RecommendationsPanel.js';
import { DetailPanel } from './components/DetailPanel.js';
import { useGraphLayout } from './hooks/useGraphLayout.js';
import type { ArchitectureViewerProps } from './types.js';
import { COLORS } from './types.js';

import './styles/viewer.css';

const nodeTypes: NodeTypes = {
  groupNode: GroupNode,
  fileNode: FileNode,
};

type SidebarTab = 'overview' | 'recommendations' | 'detail';
type GroupingMode = 'boundary' | 'reference' | 'directory';

export function ArchitectureViewer({
  data,
  className,
  defaultGrouping = 'boundary',
  defaultPanel = 'overview',
  onNodeSelect,
}: ArchitectureViewerProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>(defaultPanel);
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(defaultGrouping);

  const {
    nodes,
    edges,
    toggleGroup,
    selectedNodeId,
    selectNode,
  } = useGraphLayout(data, groupingMode);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectNode(node.id);
      setActiveTab('detail');
      onNodeSelect?.(node.id, node.type === 'fileNode' ? 'file' : 'group');
    },
    [selectNode, onNodeSelect],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'groupNode') {
        toggleGroup(node.id);
      }
    },
    [toggleGroup],
  );

  const handleHighlight = useCallback(
    (entityIds: string[], _filePaths: string[]) => {
      if (entityIds.length > 0) {
        selectNode(entityIds[0]);
      }
    },
    [selectNode],
  );

  const tabs: { id: SidebarTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'recommendations', label: 'Recs' },
    { id: 'detail', label: 'Detail' },
  ];

  const groupingButtons: { mode: GroupingMode; label: string; available: boolean }[] = useMemo(() => [
    { mode: 'boundary', label: 'Packages', available: !!data.boundaryGrouping },
    { mode: 'reference', label: 'Reference', available: !!data.referenceGrouping },
    { mode: 'directory', label: 'Directory', available: !!data.directoryGrouping },
  ], [data]);

  return (
    <div className={`aspect-viewer ${className ?? ''}`}>
      {/* Sidebar */}
      <div className="aspect-viewer__sidebar">
        <div className="aspect-viewer__sidebar-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`aspect-viewer__sidebar-tab ${activeTab === tab.id ? 'aspect-viewer__sidebar-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="aspect-viewer__sidebar-content">
          {activeTab === 'overview' && (
            <OverviewPanel
              summary={data.summary}
              architecturalSummary={data.architecturalSummary}
              groupCoupling={data.groupCoupling}
            />
          )}
          {activeTab === 'recommendations' && (
            <RecommendationsPanel
              recommendations={data.architecturalSummary?.recommendations ?? []}
              onHighlight={handleHighlight}
            />
          )}
          {activeTab === 'detail' && (
            <DetailPanel
              selectedNodeId={selectedNodeId}
              data={data}
            />
          )}
        </div>
      </div>

      {/* Graph */}
      <div className="aspect-viewer__graph">
        <div className="aspect-viewer__toolbar">
          {groupingButtons.map((btn) => (
            btn.available && (
              <button
                key={btn.mode}
                className={`aspect-viewer__toolbar-btn ${groupingMode === btn.mode ? 'aspect-viewer__toolbar-btn--active' : ''}`}
                onClick={() => setGroupingMode(btn.mode)}
              >
                {btn.label}
              </button>
            )
          ))}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={3}
          defaultEdgeOptions={{
            style: { stroke: COLORS.edgeNormal, strokeWidth: 1.5 },
            type: 'smoothstep',
          }}
        >
          <Background color="#e2e8f0" gap={20} />
          <Controls />
          <MiniMap
            nodeStrokeWidth={1}
            nodeColor={(node) => {
              if (node.type === 'fileNode') return COLORS.neutral;
              const health = (node.data as any)?.healthIndicator;
              return health === 'good' ? COLORS.good : health === 'critical' ? COLORS.critical : COLORS.warning;
            }}
            style={{ borderRadius: 8 }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
