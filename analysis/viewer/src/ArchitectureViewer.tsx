/**
 * @aspect/viewer — Main ArchitectureViewer component.
 *
 * Cluster-centric structural visualization: clusters as group nodes,
 * weighted inter-cluster edges, click-to-drilldown file view, side panel.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { StructuralPipelineResult } from './types.js';
import type { Selection, SidePanel } from './types.js';
import { useClusterGraph, deriveGroupLabel } from './hooks/useClusterGraph.js';
import { useClusterDrilldown } from './hooks/useClusterDrilldown.js';
import { ClusterNode } from './components/ClusterNode.js';
import { FileNode } from './components/FileNode.js';
import { OverviewBar } from './components/OverviewBar.js';
import { DetailPanel } from './components/DetailPanel.js';
import { ProblemsPanel } from './components/ProblemsPanel.js';
import { StatsPanel } from './components/StatsPanel.js';

import './styles/viewer.css';

export interface ArchitectureViewerProps {
  data: StructuralPipelineResult;
  className?: string;
}

const nodeTypes: NodeTypes = {
  cluster: ClusterNode,
  file: FileNode,
};

export function ArchitectureViewer({ data, className }: ArchitectureViewerProps) {
  const [selection, setSelection] = useState<Selection>({ type: null, id: '' });
  const [sidePanel, setSidePanel] = useState<SidePanel>('detail');
  const [drilldownGroupId, setDrilldownGroupId] = useState<string | null>(null);
  const [hideTypeOnly, setHideTypeOnly] = useState(false);
  const [showFullPath, setShowFullPath] = useState(false);

  const graphOptions = useMemo(
    () => ({ hideTypeOnly, showFullPath }),
    [hideTypeOnly, showFullPath],
  );

  // Compute cluster file IDs for scoped panels
  const clusterFileIds = useMemo(() => {
    if (!drilldownGroupId) return undefined;
    const community = data.communities?.communities?.find((c) => c.id === drilldownGroupId);
    const cluster = data.clusters.find((c) => c.id === drilldownGroupId);
    const fileIds = community?.memberFileIds ?? cluster?.fileIds ?? [];
    return new Set(fileIds);
  }, [drilldownGroupId, data.communities, data.clusters]);

  // Overview graph (always computed, only rendered when not in drilldown)
  const overview = useClusterGraph(data, selection, graphOptions);

  // Drilldown graph (only meaningful when drilldownGroupId is set)
  const drilldown = useClusterDrilldown(data, drilldownGroupId ?? '', selection, graphOptions);

  const isDrilldown = drilldownGroupId != null;
  const activeGraph = isDrilldown ? drilldown : overview;

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'cluster') {
      setSelection({ type: 'cluster', id: node.id });
      setSidePanel('detail');
      setDrilldownGroupId(node.id);
    } else if (node.type === 'file') {
      setSelection({ type: 'file', id: node.id });
      setSidePanel('detail');
    }
  }, []);

  const handleBack = useCallback(() => {
    setDrilldownGroupId(null);
    setSelection({ type: null, id: '' });
  }, []);

  const handleSelectFile = useCallback((fileId: string) => {
    setSelection({ type: 'file', id: fileId });
    setSidePanel('detail');
  }, []);

  const handleSelectCluster = useCallback((clusterId: string) => {
    setSelection({ type: 'cluster', id: clusterId });
    setSidePanel('detail');
    setDrilldownGroupId(clusterId);
  }, []);

  // Derive drilldown label
  const drilldownLabel = isDrilldown
    ? (() => {
        const community = data.communities?.communities?.find((c) => c.id === drilldownGroupId);
        const cluster = data.clusters.find((c) => c.id === drilldownGroupId);
        const fileIds = community?.memberFileIds ?? cluster?.fileIds ?? [];
        return `${deriveGroupLabel(fileIds)} — ${fileIds.length} files`;
      })()
    : '';

  return (
    <div className={`av-root ${className ?? ''}`}>
      <OverviewBar
        data={data}
        hideTypeOnly={hideTypeOnly}
        onToggleHideTypeOnly={() => setHideTypeOnly((v) => !v)}
        showFullPath={showFullPath}
        onToggleShowFullPath={() => setShowFullPath((v) => !v)}
      />

      <div className="av-body">
        <div className="av-graph">
          {/* Drilldown back bar */}
          {isDrilldown && (
            <div className="av-drilldown-bar">
              <button className="av-drilldown-back" onClick={handleBack}>
                ← Back to overview
              </button>
              <span className="av-drilldown-label">{drilldownLabel}</span>
            </div>
          )}

          <ReactFlow
            key={isDrilldown ? `drill-${drilldownGroupId}` : 'overview'}
            nodes={activeGraph.nodes}
            edges={activeGraph.edges}
            nodeTypes={nodeTypes}
            onNodesChange={activeGraph.onNodesChange}
            onNodeClick={handleNodeClick}
            fitView
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="#3e3e42" />
            <Controls position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              nodeColor={() => '#4a4a4e'}
              nodeStrokeColor="#555"
              nodeStrokeWidth={1}
              style={{ background: '#252526', border: '1px solid #3e3e42' }}
              maskColor="rgba(30,30,30,0.85)"
            />
          </ReactFlow>
        </div>

        <div className="av-sidebar">
          <div className="av-sidebar-tabs">
            <button
              className={`av-sidebar-tab ${sidePanel === 'detail' ? 'av-sidebar-tab--active' : ''}`}
              onClick={() => setSidePanel('detail')}
            >
              Detail
            </button>
            <button
              className={`av-sidebar-tab ${sidePanel === 'problems' ? 'av-sidebar-tab--active' : ''}`}
              onClick={() => setSidePanel('problems')}
            >
              Issues
              {data.summary.warningCount > 0 && (
                <span className="av-sidebar-badge">{data.summary.warningCount}</span>
              )}
            </button>
            <button
              className={`av-sidebar-tab ${sidePanel === 'stats' ? 'av-sidebar-tab--active' : ''}`}
              onClick={() => setSidePanel('stats')}
            >
              Stats
            </button>
          </div>

          <div className="av-sidebar-content">
            {sidePanel === 'detail' ? (
              <DetailPanel data={data} selection={selection} />
            ) : sidePanel === 'problems' ? (
              <ProblemsPanel
                data={data}
                onSelectFile={handleSelectFile}
                onSelectCluster={handleSelectCluster}
                clusterFileIds={clusterFileIds}
              />
            ) : (
              <StatsPanel data={data} clusterFileIds={clusterFileIds} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
