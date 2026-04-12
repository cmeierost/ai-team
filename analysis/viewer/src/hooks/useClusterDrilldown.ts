/**
 * @aspect/viewer — useClusterDrilldown
 *
 * Generates a ReactFlow graph for a single cluster/community drilldown view.
 * Two modes:
 *   - 'files'    — file-level nodes, edges between files
 *   - 'entities' — entity-level nodes, edges between entities
 */

import { useMemo, useCallback, useState } from 'react';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  applyNodeChanges,
  MarkerType,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import type {
  StructuralPipelineResult,
  Selection,
  EntityRefLite,
} from '../types.js';
import { deriveGroupLabel } from './useClusterGraph.js';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export type DrilldownViewMode = 'files' | 'entities';

const FILE_W = 220;
const FILE_H = 40;
const ENTITY_W = 240;
const ENTITY_H = 44;

export function useClusterDrilldown(
  data: StructuralPipelineResult,
  groupId: string,
  selection: Selection,
  options?: { hideTypeOnly?: boolean; showFullPath?: boolean; viewMode?: DrilldownViewMode },
  entities?: EntityRefLite[],
): {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
} {
  const [localNodes, setLocalNodes] = useState<Node[]>([]);

  const viewMode = options?.viewMode ?? 'files';

  const { nodes, edges } = useMemo(() => {
    const community = data.communities?.communities?.find((c) => c.id === groupId);
    if (!community) return { nodes: [], edges: [] };

    if (viewMode === 'files') {
      return buildFileGraph(data, community, selection, options);
    }
    return buildEntityGraph(data, community, selection, options, entities);
  }, [data, groupId, selection, options?.hideTypeOnly, options?.showFullPath, viewMode, entities]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setLocalNodes((prev) => applyNodeChanges(changes, prev.length ? prev : nodes)),
    [nodes],
  );

  return { nodes, edges, onNodesChange };
}

// ── Files mode ──────────────────────────────────────────────────────────

function buildFileGraph(
  data: StructuralPipelineResult,
  community: NonNullable<StructuralPipelineResult['communities']>['communities'][number],
  selection: Selection,
  options?: { hideTypeOnly?: boolean },
): { nodes: Node[]; edges: Edge[] } {
  const memberFileIds = new Set(community.memberFileIds);

  const fileClassMap = new Map(data.fileClassifications.map((f) => [f.fileId, f]));
  const misplacedMap = new Map(
    (data.communities?.misplacedFiles ?? []).map((m) => [m.fileId, m]),
  );
  const centralityMap = new Map(
    (data.centrality ?? []).map((c) => [c.fileId, c]),
  );

  // Build file → other-community-labels map for shared-file warnings
  const fileOtherCommunities = new Map<string, string[]>();
  for (const c of data.communities?.communities ?? []) {
    if (c.id === community.id) continue;
    const label = c.label || deriveGroupLabel(c.memberFileIds);
    for (const fid of c.memberFileIds) {
      if (memberFileIds.has(fid)) {
        let list = fileOtherCommunities.get(fid);
        if (!list) { list = []; fileOtherCommunities.set(fid, list); }
        list.push(label);
      }
    }
  }

  // Aggregate weighted edges to file level within this community
  const fileEdgeWeights = new Map<string, { weight: number; isTypeOnly: boolean; count: number }>();
  for (const we of data.weightedEdges) {
    if (options?.hideTypeOnly && we.isTypeOnly) continue;
    const sf = we.sourceFileId;
    const tf = we.targetFileId;
    if (!sf || !tf || sf === tf) continue;
    if (!memberFileIds.has(sf) || !memberFileIds.has(tf)) continue;
    const key = `${sf}->${tf}`;
    const existing = fileEdgeWeights.get(key);
    if (existing) {
      existing.weight += we.weight;
      existing.count++;
      if (!we.isTypeOnly) existing.isTypeOnly = false;
    } else {
      fileEdgeWeights.set(key, { weight: we.weight, isTypeOnly: !!we.isTypeOnly, count: 1 });
    }
  }

  // Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 80, ranker: 'longest-path' });
  g.setDefaultEdgeLabel(() => ({}));

  for (const fid of memberFileIds) {
    g.setNode(fid, { width: FILE_W, height: FILE_H });
  }
  for (const [key] of fileEdgeWeights) {
    const [src, tgt] = key.split('->');
    g.setEdge(src, tgt);
  }
  if (memberFileIds.size > 0) dagre.layout(g);

  const resultNodes: Node[] = [];
  for (const fid of memberFileIds) {
    const dn = g.node(fid);
    if (!dn) continue;
    const file = fileClassMap.get(fid);
    resultNodes.push({
      id: fid,
      type: 'file',
      position: { x: dn.x - dn.width / 2, y: dn.y - dn.height / 2 },
      width: FILE_W,
      height: FILE_H,
      data: {
        file: file ?? { fileId: fid, filePath: fid.replace('file:', ''), linesOfCode: 0, contentRole: 'unknown' },
        isMisplaced: misplacedMap.has(fid),
        misplacedInfo: misplacedMap.get(fid),
        centrality: centralityMap.get(fid),
        sharedCommunities: fileOtherCommunities.get(fid),
      },
      selected: selection.type === 'file' && selection.id === fid,
    });
  }

  const resultEdges: Edge[] = [];
  for (const [key, info] of fileEdgeWeights) {
    const [src, tgt] = key.split('->');
    const strokeColor = info.isTypeOnly ? '#4a7a9b' : '#666';
    resultEdges.push({
      id: key,
      source: src,
      target: tgt,
      style: {
        strokeWidth: clamp(info.weight, 1, 4),
        stroke: strokeColor,
        opacity: 0.5,
        ...(info.isTypeOnly ? { strokeDasharray: '4 4' } : {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: strokeColor,
      },
    });
  }

  return { nodes: resultNodes, edges: resultEdges };
}

// ── Entities mode ───────────────────────────────────────────────────────

function buildEntityGraph(
  data: StructuralPipelineResult,
  community: NonNullable<StructuralPipelineResult['communities']>['communities'][number],
  selection: Selection,
  options?: { hideTypeOnly?: boolean },
  entities?: EntityRefLite[],
): { nodes: Node[]; edges: Edge[] } {
  const memberEntityIdSet = new Set(community.memberEntityIds);

  const entityMap = new Map<string, EntityRefLite>();
  if (entities) {
    for (const e of entities) {
      if (memberEntityIdSet.has(e.id)) entityMap.set(e.id, e);
    }
  }

  // Top-level visible entities only (skip children whose parent is also in community)
  // Also filter out private entities — the entities graph shows only exported/public
  const visibleEntityIds = [...memberEntityIdSet].filter((eid) => {
    const ent = entityMap.get(eid);
    if (!ent) return true;
    if (!ent.parentEntityId) {
      // Filter private entities
      const isExported = ent.classification?.isExported !== false;
      const vis = ent.classification?.visibility;
      if (!isExported || vis === 'private' || vis === 'protected') return false;
      return true;
    }
    if (!memberEntityIdSet.has(ent.parentEntityId)) {
      const isExported = ent.classification?.isExported !== false;
      const vis = ent.classification?.visibility;
      if (!isExported || vis === 'private' || vis === 'protected') return false;
      return true;
    }
    return false;
  });
  const visibleSet = new Set(visibleEntityIds);

  // Intra-community edges
  const intraEdges: (typeof data.weightedEdges[number])[] = [];
  for (const we of data.weightedEdges) {
    if (options?.hideTypeOnly && we.isTypeOnly) continue;
    if (!we.sourceEntityId || !we.targetEntityId) continue;
    if (memberEntityIdSet.has(we.sourceEntityId) && memberEntityIdSet.has(we.targetEntityId)) {
      const src = liftToVisible(we.sourceEntityId, entityMap, visibleSet);
      const tgt = liftToVisible(we.targetEntityId, entityMap, visibleSet);
      if (src && tgt && src !== tgt) {
        intraEdges.push({ ...we, sourceEntityId: src, targetEntityId: tgt });
      }
    }
  }

  // Dagre layout — flat entity nodes
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70, ranker: 'longest-path' });
  g.setDefaultEdgeLabel(() => ({}));

  for (const eid of visibleEntityIds) {
    g.setNode(eid, { width: ENTITY_W, height: ENTITY_H });
  }

  const edgeMap = new Map<string, typeof data.weightedEdges[number]>();
  for (const we of intraEdges) {
    const key = `${we.sourceEntityId}->${we.targetEntityId}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, we);
      g.setEdge(we.sourceEntityId, we.targetEntityId);
    }
  }

  if (visibleEntityIds.length > 0) dagre.layout(g);

  const resultNodes: Node[] = [];
  for (const eid of visibleEntityIds) {
    const dn = g.node(eid);
    if (!dn) continue;
    const ent = entityMap.get(eid);
    resultNodes.push({
      id: eid,
      type: 'entity',
      position: { x: dn.x - dn.width / 2, y: dn.y - dn.height / 2 },
      width: ENTITY_W,
      height: ENTITY_H,
      data: {
        entity: ent ?? { id: eid, kind: 'unknown', name: eid, filePath: '' },
      },
      selected: selection.type === 'file' && selection.id === eid,
    });
  }

  const resultEdges: Edge[] = [...edgeMap.values()].map((we) => {
    const strokeColor = we.isTypeOnly ? '#4a7a9b' : '#666';
    return {
      id: `${we.sourceEntityId}->${we.targetEntityId}`,
      source: we.sourceEntityId,
      target: we.targetEntityId,
      style: {
        strokeWidth: clamp(we.weight, 1, 4),
        stroke: strokeColor,
        opacity: 0.5,
        ...(we.isTypeOnly ? { strokeDasharray: '4 4' } : {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: strokeColor,
      },
    };
  });

  return { nodes: resultNodes, edges: resultEdges };
}

/** Walk parentEntityId chain to find the nearest visible ancestor. */
function liftToVisible(
  entityId: string,
  entityMap: Map<string, EntityRefLite>,
  visibleSet: Set<string>,
): string | undefined {
  let cur = entityId;
  for (let i = 0; i < 10; i++) {
    if (visibleSet.has(cur)) return cur;
    const ent = entityMap.get(cur);
    if (!ent?.parentEntityId) return undefined;
    cur = ent.parentEntityId;
  }
  return undefined;
}
