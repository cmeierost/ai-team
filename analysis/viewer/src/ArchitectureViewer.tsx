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
import { useEntityReferenceGraph } from './hooks/useEntityReferenceGraph.js';
import { ClusterNode } from './components/ClusterNode.js';
import { FileNode } from './components/FileNode.js';
import { CommunityGroupNode } from './components/CommunityGroupNode.js';
import { EntityNode } from './components/EntityNode.js';
import { FileGroupNode } from './components/FileGroupNode.js';
import { FileCodePane } from './components/FileCodePane.js';
import { FileEntitiesPane } from './components/FileEntitiesPane.js';
import { OverviewBar } from './components/OverviewBar.js';
import { DetailPanel } from './components/DetailPanel.js';
import { ProblemsPanel } from './components/ProblemsPanel.js';
import { StatsPanel } from './components/StatsPanel.js';

import './styles/viewer.css';
import type { EntityRefLite, RelationshipRefLite } from './types.js';

export interface ArchitectureViewerProps {
  data: StructuralPipelineResult;
  className?: string;
  fileContents?: Record<string, string>;
  entities?: EntityRefLite[];
  relationships?: RelationshipRefLite[];
}

const nodeTypes: NodeTypes = {
  cluster: ClusterNode,
  file: FileNode,
  entity: EntityNode,
  communityGroup: CommunityGroupNode,
  fileGroup: FileGroupNode,
};
const VALID_SELECTION_TYPES: Selection['type'][] = ['cluster', 'file', 'entity', 'communityGroup', null];
const VALID_SIDE_PANELS: SidePanel[] = ['detail', 'problems', 'stats'];

function flattenCommunityGroups(
  roots: NonNullable<StructuralPipelineResult['communities']>['communityGroups'],
): NonNullable<StructuralPipelineResult['communities']>['communityGroups'] {
  const all: NonNullable<StructuralPipelineResult['communities']>['communityGroups'] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number]) => {
    all.push(sc);
    for (const child of sc.children ?? []) {
      if (child.kind === 'communityGroup') walk(child.cluster);
    }
  };
  for (const root of roots) walk(root);
  return all;
}

function collectCommunityGroupCommunityIds(
  CommunityGroup: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number],
): string[] {
  const ids: string[] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number]) => {
    for (const child of sc.children ?? []) {
      if (child.kind === 'community') ids.push(child.communityId);
      else walk(child.cluster);
    }
  };
  walk(CommunityGroup);
  return ids;
}

export function ArchitectureViewer({
  data,
  className,
  fileContents,
  entities,
  relationships,
}: ArchitectureViewerProps) {
  const [selection, setSelection] = useState<Selection>({ type: null, id: '' });
  const [sidePanel, setSidePanel] = useState<SidePanel>('detail');
  const [drilldownGroupId, setDrilldownGroupId] = useState<string | null>(null);
  const [navigationPath, setNavigationPath] = useState<string[]>([]);
  const [hideTypeOnly, setHideTypeOnly] = useState(false);
  const [showFullPath, setShowFullPath] = useState(false);
  const [showCommunityGroups, setShowCommunityGroups] = useState(false);
  const [fileViewTab, setFileViewTab] = useState<'code' | 'entities' | 'entity'>('entities');
  const [drilldownViewMode, setDrilldownViewMode] = useState<'files' | 'entities'>('files');
  const [expandedRefIds, setExpandedRefIds] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const resizeState = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 340 });
  const hasHydratedFromUrl = useRef(false);
  const isApplyingUrlState = useRef(false);
  const lastPushedQuery = useRef<string>('');
  const focusedCommunityGroupId = navigationPath[navigationPath.length - 1] ?? undefined;

  const graphOptions = useMemo(
    () => ({ hideTypeOnly, showFullPath, focusedCommunityGroupId, showCommunityGroups }),
    [hideTypeOnly, showFullPath, focusedCommunityGroupId, showCommunityGroups],
  );

  const resolveScope = useCallback((kind: Selection['type'], id: string) => {
    if (kind === 'cluster') {
      const community = data.communities?.communities?.find((c) => c.id === id);
      const fileIds = community?.memberFileIds ?? [];
      return {
        fileIds: fileIds.length > 0 ? new Set(fileIds) : undefined,
        groupIds: new Set([id]),
      };
    }
    if (kind === 'communityGroup') {
      const allSuper = flattenCommunityGroups(data.communities?.communityGroups ?? []);
      const sc = allSuper.find((s) => s.id === id);
      if (!sc) return { fileIds: undefined, groupIds: undefined };
      const communityIds = new Set(collectCommunityGroupCommunityIds(sc));
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
    if (kind === 'entity') {
      const ent = entities?.find((e) => e.id === id);
      if (ent?.filePath) {
        return { fileIds: new Set([`file:${ent.filePath}`]), groupIds: undefined };
      }
      return { fileIds: undefined, groupIds: undefined };
    }
    return { fileIds: undefined, groupIds: undefined };
  }, [data.communities, entities]);

  // Selection scope (for detail/issues).
  const scope = useMemo(() => {
    return resolveScope(selection.type, selection.id);
  }, [selection, resolveScope]);

  // Stats scope follows the left view focus, even when nothing is selected.
  const statsScope = useMemo(() => {
    if (selection.type !== null) return resolveScope(selection.type, selection.id);
    if (drilldownGroupId) return resolveScope('cluster', drilldownGroupId);
    if (focusedCommunityGroupId) return resolveScope('communityGroup', focusedCommunityGroupId);
    return { fileIds: undefined, groupIds: undefined };
  }, [selection, drilldownGroupId, focusedCommunityGroupId, resolveScope]);
  const referenceScopeFileIds = useMemo(() => {
    if (drilldownGroupId) return resolveScope('cluster', drilldownGroupId).fileIds;
    if (focusedCommunityGroupId) return resolveScope('communityGroup', focusedCommunityGroupId).fileIds;
    return undefined;
  }, [drilldownGroupId, focusedCommunityGroupId, resolveScope]);

  const scopedIssueCount = useMemo(() => {
    const allWarnings = data.alignment.warnings ?? [];
    if (!scope.fileIds || scope.fileIds.size === 0) return allWarnings.length;
    const communityById = new Map((data.communities?.communities ?? []).map((c) => [c.id, c]));
    return allWarnings.filter((w) => {
      if (scope.fileIds!.has(w.target)) return true;
      const community = communityById.get(w.target);
      if (community && community.memberFileIds.some((fid) => scope.fileIds!.has(fid))) return true;
      return false;
    }).length;
  }, [data.alignment.warnings, data.communities?.communities, scope.fileIds]);

  const drilldownOptions = useMemo(
    () => ({ hideTypeOnly, showFullPath, viewMode: drilldownViewMode }),
    [hideTypeOnly, showFullPath, drilldownViewMode],
  );

  const entityRefOptions = useMemo(
    () => ({ showCommunityGroups, hideTypeOnly, expandedRefIds }),
    [showCommunityGroups, hideTypeOnly, expandedRefIds],
  );

  // Overview graph (always computed, only rendered when not in drilldown)
  const overview = useClusterGraph(data, selection, graphOptions);

  // Drilldown graph (only meaningful when drilldownGroupId is set)
  const drilldown = useClusterDrilldown(data, drilldownGroupId ?? '', selection, drilldownOptions, entities);

  // Entity reference graph (only meaningful when an entity is selected)
  const entityRefGraph = useEntityReferenceGraph(
    data,
    selection.type === 'entity' ? selection.id : '',
    entities ?? [],
    relationships ?? [],
    entityRefOptions,
  );

  const isDrilldown = drilldownGroupId != null;
  const activeGraph = isDrilldown ? drilldown : overview;
  const CommunityGroupById = useMemo(() => {
    return new Map(flattenCommunityGroups(data.communities?.communityGroups ?? []).map((s) => [s.id, s]));
  }, [data.communities?.communityGroups]);

  const clusterLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data.communities?.communities ?? []) {
      const label = c.label || deriveGroupLabel(c.memberFileIds);
      map.set(c.id, `${label} (${c.memberFileIds.length})`);
    }
    return map;
  }, [data.communities?.communities]);
  const fileToCommunityId = useMemo(() => {
    const map = new Map<string, string>();
    for (const community of data.communities?.communities ?? []) {
      for (const fileId of community.memberFileIds) map.set(fileId, community.id);
    }
    return map;
  }, [data.communities?.communities]);
  const communityToSuperPath = useMemo(() => {
    const map = new Map<string, string[]>();
    const walk = (
      node: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number],
      path: string[],
    ) => {
      for (const child of node.children ?? []) {
        if (child.kind === 'community') map.set(child.communityId, path);
        else walk(child.cluster, [...path, child.cluster.id]);
      }
    };
    for (const root of data.communities?.communityGroups ?? []) {
      walk(root, [root.id]);
    }
    return map;
  }, [data.communities?.communityGroups]);

  const applyStateFromUrl = useCallback(() => {
    if (typeof window === 'undefined') return;
    isApplyingUrlState.current = true;
    const params = new URLSearchParams(window.location.search);
    const urlSelectionTypeRaw = params.get('selType');
    const urlSelectionType = VALID_SELECTION_TYPES.includes(urlSelectionTypeRaw as Selection['type'])
      ? (urlSelectionTypeRaw as Selection['type'])
      : null;
    const urlSelectionId = params.get('selId') ?? '';
    const urlSidePanel = params.get('panel');
    const urlDrilldown = params.get('drill');
    const urlTab = params.get('tab');
    const urlNav = params.getAll('nav');

    if (urlSelectionType !== null && urlSelectionId) {
      setSelection({ type: urlSelectionType, id: urlSelectionId });
    } else {
      setSelection({ type: null, id: '' });
    }
    setNavigationPath(urlNav);
    setDrilldownGroupId(urlDrilldown || null);
    if (urlTab === 'entities' || urlTab === 'code' || urlTab === 'entity') {
      setFileViewTab(urlTab);
    }
    setHideTypeOnly(params.get('types') === 'hidden');
    setShowFullPath(params.get('paths') === 'full');
    setShowCommunityGroups(params.get('grouping') === 'on');
    const urlDrilldownView = params.get('drillView');
    if (urlDrilldownView === 'files' || urlDrilldownView === 'entities') {
      setDrilldownViewMode(urlDrilldownView);
    }
    if (urlSidePanel && VALID_SIDE_PANELS.includes(urlSidePanel as SidePanel)) {
      setSidePanel(urlSidePanel as SidePanel);
    }
    const query = window.location.search.startsWith('?')
      ? window.location.search.slice(1)
      : window.location.search;
    lastPushedQuery.current = query;
    hasHydratedFromUrl.current = true;
    isApplyingUrlState.current = false;
  }, []);

  useEffect(() => {
    applyStateFromUrl();
    if (typeof window === 'undefined') return;
    const onPopState = () => applyStateFromUrl();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyStateFromUrl]);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedFromUrl.current || isApplyingUrlState.current) return;
    const next = new URLSearchParams();
    if (selection.type && selection.id) {
      next.set('selType', selection.type);
      next.set('selId', selection.id);
    }
    if (sidePanel !== 'detail') next.set('panel', sidePanel);
    if (drilldownGroupId) next.set('drill', drilldownGroupId);
    if (fileViewTab !== 'code') next.set('tab', fileViewTab);
    if (hideTypeOnly) next.set('types', 'hidden');
    if (showFullPath) next.set('paths', 'full');
    if (showCommunityGroups) next.set('grouping', 'on');
    if (drilldownViewMode !== 'files') next.set('drillView', drilldownViewMode);
    for (const id of navigationPath) next.append('nav', id);

    const query = next.toString();
    const current = window.location.search.startsWith('?')
      ? window.location.search.slice(1)
      : window.location.search;
    if (query === current || query === lastPushedQuery.current) {
      lastPushedQuery.current = query;
      return;
    }
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.pushState(null, '', nextUrl);
    lastPushedQuery.current = query;
  }, [
    selection,
    sidePanel,
    drilldownGroupId,
    fileViewTab,
    hideTypeOnly,
    showFullPath,
    showCommunityGroups,
    drilldownViewMode,
    navigationPath,
  ]);

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
    if (node.type === 'communityGroup') {
      setNavigationPath((prev) => [...prev, node.id]);
      setSelection({ type: 'communityGroup', id: node.id });
      setSidePanel('detail');
      setDrilldownGroupId(null);
    } else if (node.type === 'cluster') {
      setSelection({ type: 'cluster', id: node.id });
      setSidePanel('detail');
      setDrilldownGroupId(node.id);
    } else if (node.type === 'entity') {
      setSelection({ type: 'entity', id: node.id });
      setSidePanel('detail');
      setFileViewTab('entity');
      setExpandedRefIds(new Set());
    } else if (node.type === 'file') {
      setSelection({ type: 'file', id: node.id });
      setSidePanel('detail');
      setFileViewTab('entities');
    }
  }, []);

  // Click handler for the entity reference graph — cluster nodes toggle expand
  const handleEntityRefNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'entity') {
      if ((node.data as { focal?: boolean })?.focal) return;
      setSelection({ type: 'entity', id: node.id });
      setSidePanel('detail');
      setFileViewTab('entity');
      setExpandedRefIds(new Set());
    } else if (node.type === 'cluster') {
      setExpandedRefIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
    }
  }, []);

  const handleSelectFile = useCallback((fileId: string) => {
    setSelection({ type: 'file', id: fileId });
    setSidePanel('detail');
    setFileViewTab('entities');
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
        const fileIds = community?.memberFileIds ?? [];
        return `${deriveGroupLabel(fileIds)} — ${fileIds.length} files`;
      })()
    : '';

  const showNavBar = true;
  const breadcrumbs = useMemo(() => {
    // Determine the active community id from drilldown or selection
    const selectedClusterId =
      drilldownGroupId
      ?? (selection.type === 'cluster' ? selection.id : undefined)
      ?? (selection.type === 'entity' ? (() => {
        const ent = entities?.find((e) => e.id === selection.id);
        if (ent?.filePath) {
          const fid = `file:${ent.filePath}`;
          return fileToCommunityId.get(fid);
        }
        return undefined;
      })() : undefined)
      ?? (selection.type === 'file' ? fileToCommunityId.get(selection.id) : undefined);

    const derivedSuperPath = selectedClusterId ? (communityToSuperPath.get(selectedClusterId) ?? []) : [];
    const superPath = navigationPath.length > 0 ? navigationPath : derivedSuperPath;

    const items: { key: string; label: string; onClick?: () => void; active?: boolean }[] = [
      {
        key: 'repo',
        label: 'Repo',
        onClick: () => {
          setNavigationPath([]);
          setDrilldownGroupId(null);
          setSelection({ type: null, id: '' });
        },
        active: superPath.length === 0 && !selectedClusterId && selection.type == null,
      },
    ];

    // Group / subgroup levels (can be multiple)
    superPath.forEach((id, index) => {
      items.push({
        key: `group-${id}`,
        label: CommunityGroupById.get(id)?.label || id,
        onClick: () => {
          setNavigationPath(superPath.slice(0, index + 1));
          setDrilldownGroupId(null);
          setSelection({ type: 'communityGroup', id });
        },
        active: !drilldownGroupId && selection.type === 'communityGroup' && selection.id === id,
      });
    });

    // Community level
    if (selectedClusterId) {
      items.push({
        key: `community-${selectedClusterId}`,
        label: clusterLabelById.get(selectedClusterId) || selectedClusterId,
        onClick: () => {
          setSelection({ type: 'cluster', id: selectedClusterId });
          setDrilldownGroupId(selectedClusterId);
        },
        active: selection.type === 'cluster' || selection.type === 'file',
      });
    }

    // Entity level
    if (selection.type === 'entity') {
      const ent = entities?.find((e) => e.id === selection.id);
      items.push({
        key: `entity-${selection.id}`,
        label: ent?.name || selection.id,
        active: true,
      });
    }

    return items;
  }, [
    navigationPath,
    drilldownGroupId,
    selection,
    CommunityGroupById,
    clusterLabelById,
    fileToCommunityId,
    communityToSuperPath,
    entities,
  ]);

  return (
    <div className={`av-root ${className ?? ''}`}>
      <OverviewBar
        data={data}
        hideTypeOnly={hideTypeOnly}
        onToggleHideTypeOnly={() => setHideTypeOnly((v) => !v)}
        showFullPath={showFullPath}
        onToggleShowFullPath={() => setShowFullPath((v) => !v)}
        showCommunityGroups={showCommunityGroups || !!focusedCommunityGroupId}
        onToggleShowCommunityGroups={() => setShowCommunityGroups((v) => !v)}
      />

      <div className="av-body">
        <div className="av-graph">
          {/* Breadcrumb bar */}
          {showNavBar && (
            <div className="av-drilldown-bar">
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
            </div>
          )}
          {isDrilldown && selection.type !== 'file' && selection.type !== 'entity' && (
            <div className="av-drilldown-tabs">
              <button
                className={`av-file-tab ${drilldownViewMode === 'files' ? 'av-file-tab--active' : ''}`}
                onClick={() => setDrilldownViewMode('files')}
              >
                Files
              </button>
              <button
                className={`av-file-tab ${drilldownViewMode === 'entities' ? 'av-file-tab--active' : ''}`}
                onClick={() => setDrilldownViewMode('entities')}
              >
                Entities
              </button>
            </div>
          )}

            {selection.type === 'file' || selection.type === 'entity' ? (() => {
              // Resolve to file id for the panes
              let fileId = selection.id;
              const isEntityView = selection.type === 'entity';
              if (isEntityView) {
                const ent = entities?.find((e) => e.id === selection.id);
                fileId = ent?.filePath ? `file:${ent.filePath}` : selection.id;
              }
              const file = data.fileClassifications.find((f) => f.fileId === fileId);
              // Ensure tab is valid for current selection type
              const effectiveTab = isEntityView
                ? (fileViewTab === 'entity' || fileViewTab === 'code' ? fileViewTab : 'entity')
                : (fileViewTab === 'code' || fileViewTab === 'entities' ? fileViewTab : 'entities');
              return (
              <div className="av-code-frame">
                <div className="av-file-tabs">
                  {isEntityView ? (
                    <>
                      <button
                        className={`av-file-tab ${effectiveTab === 'entity' ? 'av-file-tab--active' : ''}`}
                        onClick={() => setFileViewTab('entity')}
                      >
                        Entity
                      </button>
                      <button
                        className={`av-file-tab ${effectiveTab === 'code' ? 'av-file-tab--active' : ''}`}
                        onClick={() => setFileViewTab('code')}
                      >
                        Code
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={`av-file-tab ${effectiveTab === 'code' ? 'av-file-tab--active' : ''}`}
                        onClick={() => setFileViewTab('code')}
                      >
                        Code
                      </button>
                      <button
                        className={`av-file-tab ${effectiveTab === 'entities' ? 'av-file-tab--active' : ''}`}
                        onClick={() => setFileViewTab('entities')}
                      >
                        Entities
                      </button>
                    </>
                  )}
                </div>
                <div className="av-file-content">
                  {effectiveTab === 'code' ? (
                    <FileCodePane
                      file={file}
                      content={fileId ? fileContents?.[fileId] : undefined}
                    />
                  ) : effectiveTab === 'entity' ? (
                    <div style={{ width: '100%', height: '100%' }}>
                      <ReactFlow
                        key={`entity-ref-${selection.id}`}
                        nodes={entityRefGraph.nodes}
                        edges={entityRefGraph.edges}
                        nodeTypes={nodeTypes}
                        onNodesChange={entityRefGraph.onNodesChange}
                        onNodeClick={handleEntityRefNodeClick}
                        fitView
                        minZoom={0.1}
                        maxZoom={2}
                        proOptions={{ hideAttribution: true }}
                      >
                        <Background gap={20} color="#3e3e42" />
                        <Controls position="bottom-left" />
                      </ReactFlow>
                    </div>
                  ) : (
                    <FileEntitiesPane
                      file={file}
                      content={fileId ? fileContents?.[fileId] : undefined}
                      entities={entities}
                      relationships={relationships}
                      scopeFileIds={referenceScopeFileIds}
                      hideTypeOnly={hideTypeOnly}
                    />
                  )}
                </div>
              </div>
              );
            })() : (
              <div className="av-graph-frame">
                <ReactFlow
                  key={isDrilldown
                    ? `drill-${drilldownGroupId}`
                    : `overview-${focusedCommunityGroupId ?? 'root'}`}
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
              <DetailPanel
                data={data}
                selection={selection}
                clusterFileIds={scope.fileIds}
                onSelectFile={handleSelectFile}
                onSelectCluster={handleSelectCluster}
                entities={entities}
                relationships={relationships}
                showCommunityGroups={showCommunityGroups}
              />
            ) : sidePanel === 'problems' ? (
              <ProblemsPanel
                data={data}
                onSelectFile={handleSelectFile}
                onSelectCluster={handleSelectCluster}
                clusterFileIds={scope.fileIds}
                scopedGroupIds={scope.groupIds}
              />
            ) : (
              <StatsPanel data={data} clusterFileIds={statsScope.fileIds} entities={entities} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
