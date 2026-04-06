/**
 * @aspect/viewer — Main ArchitectureViewer component.
 *
 * Cluster-centric structural visualization: clusters as group nodes,
 * weighted inter-cluster edges, click-to-drilldown file view, side panel.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { SuperClusterNode } from './components/SuperClusterNode.js';
import { FileCodePane } from './components/FileCodePane.js';
import { OverviewBar } from './components/OverviewBar.js';
import { DetailPanel } from './components/DetailPanel.js';
import { ProblemsPanel } from './components/ProblemsPanel.js';
import { StatsPanel } from './components/StatsPanel.js';

import './styles/viewer.css';

export interface ArchitectureViewerProps {
  data: StructuralPipelineResult;
  className?: string;
  fileContents?: Record<string, string>;
}

const nodeTypes: NodeTypes = {
  cluster: ClusterNode,
  file: FileNode,
  supercluster: SuperClusterNode,
};

function flattenSuperClusters(
  roots: NonNullable<StructuralPipelineResult['communities']>['superClusters'],
): NonNullable<StructuralPipelineResult['communities']>['superClusters'] {
  const all: NonNullable<StructuralPipelineResult['communities']>['superClusters'] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['superClusters'][number]) => {
    all.push(sc);
    for (const child of sc.children ?? []) {
      if (child.kind === 'supercluster') walk(child.cluster);
    }
  };
  for (const root of roots) walk(root);
  return all;
}

function collectSuperclusterCommunityIds(
  supercluster: NonNullable<StructuralPipelineResult['communities']>['superClusters'][number],
): string[] {
  const ids: string[] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['superClusters'][number]) => {
    for (const child of sc.children ?? []) {
      if (child.kind === 'community') ids.push(child.communityId);
      else walk(child.cluster);
    }
  };
  walk(supercluster);
  return ids;
}

export function ArchitectureViewer({ data, className, fileContents }: ArchitectureViewerProps) {
  const [selection, setSelection] = useState<Selection>({ type: null, id: '' });
  const [sidePanel, setSidePanel] = useState<SidePanel>('detail');
  const [drilldownGroupId, setDrilldownGroupId] = useState<string | null>(null);
  const [navigationPath, setNavigationPath] = useState<string[]>([]);
  const [hideTypeOnly, setHideTypeOnly] = useState(false);
  const [showFullPath, setShowFullPath] = useState(false);
  const [showSuperclusters, setShowSuperclusters] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const resizeState = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 340 });
  const focusedSuperClusterId = navigationPath[navigationPath.length - 1] ?? undefined;

  const graphOptions = useMemo(
    () => ({ hideTypeOnly, showFullPath, focusedSuperClusterId, showSuperclusters }),
    [hideTypeOnly, showFullPath, focusedSuperClusterId, showSuperclusters],
  );

  const resolveScope = useCallback((kind: Selection['type'], id: string) => {
    if (kind === 'cluster') {
      const community = data.communities?.communities?.find((c) => c.id === id);
      const cluster = data.clusters.find((c) => c.id === id);
      const fileIds = community?.memberFileIds ?? cluster?.fileIds ?? [];
      return {
        fileIds: fileIds.length > 0 ? new Set(fileIds) : undefined,
        groupIds: new Set([id]),
      };
    }
    if (kind === 'supercluster') {
      const allSuper = flattenSuperClusters(data.communities?.superClusters ?? []);
      const sc = allSuper.find((s) => s.id === id);
      if (!sc) return { fileIds: undefined, groupIds: undefined };
      const communityIds = new Set(collectSuperclusterCommunityIds(sc));
      const fileIds = (data.communities?.communities ?? [])
        .filter((c) => communityIds.has(c.id))
        .flatMap((c) => c.memberFileIds);
      return {
        fileIds: fileIds.length > 0 ? new Set(fileIds) : undefined,
        groupIds: communityIds,
      };
    }
    if (kind === 'file') {
      return { fileIds: new Set([id]), groupIds: undefined };
    }
    return { fileIds: undefined, groupIds: undefined };
  }, [data.communities, data.clusters]);

  // Selection scope (for detail/issues).
  const scope = useMemo(() => {
    return resolveScope(selection.type, selection.id);
  }, [selection, resolveScope]);

  // Stats scope follows the left view focus, even when nothing is selected.
  const statsScope = useMemo(() => {
    if (selection.type !== null) return resolveScope(selection.type, selection.id);
    if (drilldownGroupId) return resolveScope('cluster', drilldownGroupId);
    if (focusedSuperClusterId) return resolveScope('supercluster', focusedSuperClusterId);
    return { fileIds: undefined, groupIds: undefined };
  }, [selection, drilldownGroupId, focusedSuperClusterId, resolveScope]);

  const scopedIssueCount = useMemo(() => {
    const allWarnings = data.alignment.warnings ?? [];
    if (!scope.fileIds || scope.fileIds.size === 0) return allWarnings.length;
    const communityById = new Map((data.communities?.communities ?? []).map((c) => [c.id, c]));
    const clusterById = new Map(data.clusters.map((c) => [c.id, c]));
    return allWarnings.filter((w) => {
      if (scope.fileIds!.has(w.target)) return true;
      const community = communityById.get(w.target);
      if (community && community.memberFileIds.some((fid) => scope.fileIds!.has(fid))) return true;
      const cluster = clusterById.get(w.target);
      if (cluster && cluster.fileIds.some((fid) => scope.fileIds!.has(fid))) return true;
      return false;
    }).length;
  }, [data.alignment.warnings, data.communities?.communities, data.clusters, scope.fileIds]);

  // Overview graph (always computed, only rendered when not in drilldown)
  const overview = useClusterGraph(data, selection, graphOptions);

  // Drilldown graph (only meaningful when drilldownGroupId is set)
  const drilldown = useClusterDrilldown(data, drilldownGroupId ?? '', selection, graphOptions);

  const isDrilldown = drilldownGroupId != null;
  const activeGraph = isDrilldown ? drilldown : overview;
  const superClusterById = useMemo(() => {
    return new Map(flattenSuperClusters(data.communities?.superClusters ?? []).map((s) => [s.id, s]));
  }, [data.communities?.superClusters]);

  const clusterLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data.communities?.communities ?? []) {
      map.set(c.id, `${deriveGroupLabel(c.memberFileIds)} (${c.memberFileIds.length})`);
    }
    for (const c of data.clusters) {
      if (!map.has(c.id)) map.set(c.id, `${deriveGroupLabel(c.fileIds)} (${c.fileIds.length})`);
    }
    return map;
  }, [data.communities?.communities, data.clusters]);

  useEffect(() => {
    if (!isResizingSidebar) return;
    const onMouseMove = (event: MouseEvent) => {
      const delta = resizeState.current.startX - event.clientX;
      const next = Math.min(700, Math.max(280, resizeState.current.startWidth + delta));
      setSidebarWidth(next);
    };
    const onMouseUp = () => setIsResizingSidebar(false);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizingSidebar]);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if ((node.data as { contractHub?: boolean } | undefined)?.contractHub) {
      return;
    }
    if (node.type === 'supercluster') {
      setNavigationPath((prev) => [...prev, node.id]);
      setSelection({ type: 'supercluster', id: node.id });
      setSidePanel('detail');
      setDrilldownGroupId(null);
    } else if (node.type === 'cluster') {
      setSelection({ type: 'cluster', id: node.id });
      setSidePanel('detail');
      setDrilldownGroupId(node.id);
    } else if (node.type === 'file') {
      setSelection({ type: 'file', id: node.id });
      setSidePanel('detail');
    }
  }, []);

  const handleBack = useCallback(() => {
    if (drilldownGroupId) {
      setDrilldownGroupId(null);
      setSelection({ type: null, id: '' });
      return;
    }
    setNavigationPath((prev) => prev.slice(0, -1));
  }, [drilldownGroupId]);

  const handleSelectFile = useCallback((fileId: string) => {
    setSelection({ type: 'file', id: fileId });
    setSidePanel('detail');
  }, []);

  const handleSelectCluster = useCallback((clusterId: string) => {
    setSelection({ type: 'cluster', id: clusterId });
    setSidePanel('detail');
    setDrilldownGroupId(clusterId);
  }, []);

  const handleSidebarResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    resizeState.current = { startX: event.clientX, startWidth: sidebarWidth };
    setIsResizingSidebar(true);
    event.preventDefault();
  }, [sidebarWidth]);

  // Derive drilldown label
  const drilldownLabel = isDrilldown
    ? (() => {
        const community = data.communities?.communities?.find((c) => c.id === drilldownGroupId);
        const cluster = data.clusters.find((c) => c.id === drilldownGroupId);
        const fileIds = community?.memberFileIds ?? cluster?.fileIds ?? [];
        return `${deriveGroupLabel(fileIds)} — ${fileIds.length} files`;
      })()
    : '';

  const showNavBar = true;
  const breadcrumbs = useMemo(() => {
    const items: { key: string; label: string; onClick?: () => void; active?: boolean }[] = [
      {
        key: 'repo',
        label: 'Repo',
        onClick: () => {
          setNavigationPath([]);
          setDrilldownGroupId(null);
          setSelection({ type: null, id: '' });
        },
        active: navigationPath.length === 0 && !drilldownGroupId && selection.type == null,
      },
    ];

    navigationPath.forEach((id, index) => {
      items.push({
        key: `super-${id}`,
        label: superClusterById.get(id)?.label || id,
        onClick: () => {
          setNavigationPath(navigationPath.slice(0, index + 1));
          setDrilldownGroupId(null);
          setSelection({ type: 'supercluster', id });
        },
        active: !drilldownGroupId && selection.type === 'supercluster' && selection.id === id,
      });
    });

    if (drilldownGroupId) {
      items.push({
        key: `cluster-${drilldownGroupId}`,
        label: clusterLabelById.get(drilldownGroupId) || drilldownGroupId,
        onClick: () => {
          setSelection({ type: 'cluster', id: drilldownGroupId });
        },
        active: selection.type === 'cluster' && selection.id === drilldownGroupId,
      });
    } else if (selection.type === 'cluster') {
      items.push({
        key: `cluster-${selection.id}`,
        label: clusterLabelById.get(selection.id) || selection.id,
        active: true,
      });
    }

    if (selection.type === 'file') {
      const file = data.fileClassifications.find((f) => f.fileId === selection.id);
      items.push({
        key: `file-${selection.id}`,
        label: file?.filePath.split('/').slice(-1)[0] || selection.id,
        active: true,
      });
    }
    return items;
  }, [navigationPath, drilldownGroupId, selection, superClusterById, clusterLabelById, data.fileClassifications]);

  return (
    <div className={`av-root ${className ?? ''}`}>
      <OverviewBar
        data={data}
        hideTypeOnly={hideTypeOnly}
        onToggleHideTypeOnly={() => setHideTypeOnly((v) => !v)}
        showFullPath={showFullPath}
        onToggleShowFullPath={() => setShowFullPath((v) => !v)}
        showSuperclusters={showSuperclusters || !!focusedSuperClusterId}
        onToggleShowSuperclusters={() => setShowSuperclusters((v) => !v)}
      />

      <div className="av-body">
        <div className="av-graph">
          {/* Breadcrumb bar */}
          {showNavBar && (
            <div className="av-drilldown-bar">
              <button className="av-drilldown-back" onClick={handleBack}>
                {isDrilldown ? '← Back to supercluster' : '← Back'}
              </button>
              <div className="av-breadcrumbs">
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.key}>
                    <button
                      className={`av-breadcrumb ${crumb.active ? 'av-breadcrumb--active' : ''}`}
                      onClick={crumb.onClick}
                      disabled={!crumb.onClick}
                    >
                      {crumb.label}
                    </button>
                    {index < breadcrumbs.length - 1 && <span className="av-breadcrumb-sep">/</span>}
                  </React.Fragment>
                ))}
              </div>
              {isDrilldown && (
                <span className="av-drilldown-label">{drilldownLabel}</span>
              )}
            </div>
          )}

            {selection.type === 'file' ? (
              <div className="av-code-frame">
                <FileCodePane
                  file={data.fileClassifications.find((f) => f.fileId === selection.id)}
                  content={selection.id ? fileContents?.[selection.id] : undefined}
                />
              </div>
            ) : (
              <div className="av-graph-frame">
                <ReactFlow
                  key={isDrilldown
                    ? `drill-${drilldownGroupId}`
                    : `overview-${focusedSuperClusterId ?? 'root'}`}
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
            )}
          </div>

        <div
          className={`av-sidebar-resizer ${isResizingSidebar ? 'av-sidebar-resizer--active' : ''}`}
          onMouseDown={handleSidebarResizeStart}
        />
        <div className="av-sidebar" style={{ width: sidebarWidth }}>
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
              {scopedIssueCount > 0 && (
                <span className="av-sidebar-badge">{scopedIssueCount}</span>
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
              <DetailPanel data={data} selection={selection} clusterFileIds={scope.fileIds} />
            ) : sidePanel === 'problems' ? (
              <ProblemsPanel
                data={data}
                onSelectFile={handleSelectFile}
                onSelectCluster={handleSelectCluster}
                clusterFileIds={scope.fileIds}
                scopedGroupIds={scope.groupIds}
              />
            ) : (
              <StatsPanel data={data} clusterFileIds={statsScope.fileIds} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
