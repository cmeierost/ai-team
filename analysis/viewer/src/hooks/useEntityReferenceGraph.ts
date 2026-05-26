/**
 * useEntityReferenceGraph — builds a ReactFlow graph for a single entity
 * showing its direct references (uses / used-by).
 *
 * Same-community references → individual entity nodes.
 * Cross-community references → aggregated to community or group level (expandable).
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
  EntityRefLite,
  RelationshipRefLite,
} from '../types.js';
import { deriveGroupLabel } from './useClusterGraph.js';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

const ENTITY_W = 240;
const ENTITY_H = 44;
const CLUSTER_W = 240;
const CLUSTER_H = 80;

export interface EntityRefGraphOptions {
  showCommunityGroups: boolean;
  hideTypeOnly: boolean;
  expandedRefIds: Set<string>;
}

export function useEntityReferenceGraph(
  data: StructuralPipelineResult,
  entityId: string,
  entities: EntityRefLite[],
  relationships: RelationshipRefLite[],
  options: EntityRefGraphOptions,
): {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
} {
  const [localNodes, setLocalNodes] = useState<Node[]>([]);

  const { nodes, edges } = useMemo(() => {
    if (!entityId) return { nodes: [], edges: [] };
    return buildEntityRefGraph(data, entityId, entities, relationships, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, entityId, entities, relationships,
      options.showCommunityGroups, options.hideTypeOnly, options.expandedRefIds]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setLocalNodes((prev) => applyNodeChanges(changes, prev.length ? prev : nodes)),
    [nodes],
  );

  return { nodes, edges, onNodesChange };
}

// ── Internal types ──────────────────────────────────────────────────────

interface RefInfo {
  entityId: string;
  direction: 'uses' | 'usedBy';
  rel: RelationshipRefLite;
}

interface AggRef {
  id: string;
  kind: 'group' | 'community';
  label: string;
  refs: RefInfo[];
  communityIds: string[];
}

// ── Builder ─────────────────────────────────────────────────────────────

type CommunityType = NonNullable<StructuralPipelineResult['communities']>['communities'][number];
type CG = NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number];

function buildEntityRefGraph(
  data: StructuralPipelineResult,
  entityId: string,
  entities: EntityRefLite[],
  relationships: RelationshipRefLite[],
  options: EntityRefGraphOptions,
): { nodes: Node[]; edges: Edge[] } {
  const entityMap = new Map(entities.map((e) => [e.id, e]));
  const focalEntity = entityMap.get(entityId);
  if (!focalEntity) return { nodes: [], edges: [] };

  // ── Lookup maps ──────────────────────────────────────────────────────
  const entityToCommunity = new Map<string, string>();
  const communityMap = new Map<string, CommunityType>();
  for (const c of data.communities?.communities ?? []) {
    communityMap.set(c.id, c);
    for (const eid of c.memberEntityIds) entityToCommunity.set(eid, c.id);
  }

  const communityToRootGroup = new Map<string, string>();
  const groupById = new Map<string, CG>();
  if (options.showCommunityGroups) {
    const walk = (group: CG, rootId: string) => {
      groupById.set(group.id, group);
      for (const child of group.children ?? []) {
        if (child.kind === 'community') communityToRootGroup.set(child.communityId, rootId);
        else walk(child.cluster, rootId);
      }
    };
    for (const root of data.communities?.communityGroups ?? []) walk(root, root.id);
  }

  const focalCommunityId = entityToCommunity.get(entityId);

  // ── Collect direct references ────────────────────────────────────────
  const allRefs: RefInfo[] = [];
  for (const rel of relationships) {
    if (options.hideTypeOnly && rel.typeOnly) continue;
    if (rel.sourceEntityId === entityId && rel.targetEntityId !== entityId) {
      allRefs.push({ entityId: rel.targetEntityId, direction: 'uses', rel });
    }
    if (rel.targetEntityId === entityId && rel.sourceEntityId !== entityId) {
      allRefs.push({ entityId: rel.sourceEntityId, direction: 'usedBy', rel });
    }
  }

  const sameCommRefs: RefInfo[] = [];
  const crossCommRefs: RefInfo[] = [];
  for (const ref of allRefs) {
    if (entityToCommunity.get(ref.entityId) === focalCommunityId) sameCommRefs.push(ref);
    else crossCommRefs.push(ref);
  }
  const sameCommEntityIds = [...new Set(sameCommRefs.map((r) => r.entityId))];

  // ── Aggregate cross-community refs ──────────────────────────────────
  const aggMap = new Map<string, AggRef>();
  for (const ref of crossCommRefs) {
    const refComm = entityToCommunity.get(ref.entityId);
    if (!refComm) continue;

    let aggId: string;
    let aggKind: 'group' | 'community';
    if (options.showCommunityGroups) {
      const rootGroupId = communityToRootGroup.get(refComm);
      aggId = rootGroupId ?? refComm;
      aggKind = rootGroupId ? 'group' : 'community';
    } else {
      aggId = refComm;
      aggKind = 'community';
    }

    let agg = aggMap.get(aggId);
    if (!agg) {
      const label = aggKind === 'group'
        ? (groupById.get(aggId)?.label || aggId)
        : (() => { const c = communityMap.get(aggId); return c?.label || deriveGroupLabel(c?.memberFileIds ?? []); })();
      agg = { id: aggId, kind: aggKind, label, refs: [], communityIds: [] };
      aggMap.set(aggId, agg);
    }
    agg.refs.push(ref);
    if (!agg.communityIds.includes(refComm)) agg.communityIds.push(refComm);
  }

  // ── Build dagre ─────────────────────────────────────────────────────
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 100, ranker: 'longest-path' });
  g.setDefaultEdgeLabel(() => ({}));

  g.setNode(entityId, { width: ENTITY_W, height: ENTITY_H });
  for (const eid of sameCommEntityIds) g.setNode(eid, { width: ENTITY_W, height: ENTITY_H });

  for (const [aggId, agg] of aggMap) {
    const expanded = options.expandedRefIds.has(aggId);
    if (expanded && agg.kind === 'group') {
      for (const commId of agg.communityIds) {
        if (options.expandedRefIds.has(commId)) {
          const eids = new Set(agg.refs
            .filter((r) => entityToCommunity.get(r.entityId) === commId)
            .map((r) => r.entityId));
          for (const eid of eids) g.setNode(eid, { width: ENTITY_W, height: ENTITY_H });
        } else {
          g.setNode(commId, { width: CLUSTER_W, height: CLUSTER_H });
        }
      }
    } else if (expanded && agg.kind === 'community') {
      const eids = new Set(agg.refs.map((r) => r.entityId));
      for (const eid of eids) g.setNode(eid, { width: ENTITY_W, height: ENTITY_H });
    } else {
      g.setNode(aggId, { width: CLUSTER_W, height: CLUSTER_H });
    }
  }

  // ── Edges ───────────────────────────────────────────────────────────
  const edgeKeys = new Map<string, { typeOnly: boolean; weight: number }>();
  const addEdge = (src: string, tgt: string, typeOnly: boolean) => {
    const key = `${src}->${tgt}`;
    const existing = edgeKeys.get(key);
    if (existing) {
      existing.weight += 1;
      if (!typeOnly) existing.typeOnly = false;
    } else {
      edgeKeys.set(key, { typeOnly, weight: 1 });
      g.setEdge(src, tgt);
    }
  };

  // Same-community edges
  for (const ref of sameCommRefs) {
    if (ref.direction === 'uses') addEdge(entityId, ref.entityId, !!ref.rel.typeOnly);
    else addEdge(ref.entityId, entityId, !!ref.rel.typeOnly);
  }

  // Cross-community edges
  for (const [aggId, agg] of aggMap) {
    const expanded = options.expandedRefIds.has(aggId);
    if (expanded && agg.kind === 'group') {
      for (const commId of agg.communityIds) {
        const commRefs = agg.refs.filter((r) => entityToCommunity.get(r.entityId) === commId);
        if (options.expandedRefIds.has(commId)) {
          for (const ref of commRefs) {
            if (ref.direction === 'uses') addEdge(entityId, ref.entityId, !!ref.rel.typeOnly);
            else addEdge(ref.entityId, entityId, !!ref.rel.typeOnly);
          }
        } else {
          const usesRefs = commRefs.filter((r) => r.direction === 'uses');
          const usedByRefs = commRefs.filter((r) => r.direction === 'usedBy');
          if (usesRefs.length > 0) addEdge(entityId, commId, usesRefs.every((r) => r.rel.typeOnly));
          if (usedByRefs.length > 0) addEdge(commId, entityId, usedByRefs.every((r) => r.rel.typeOnly));
        }
      }
    } else if (expanded && agg.kind === 'community') {
      for (const ref of agg.refs) {
        if (ref.direction === 'uses') addEdge(entityId, ref.entityId, !!ref.rel.typeOnly);
        else addEdge(ref.entityId, entityId, !!ref.rel.typeOnly);
      }
    } else {
      const usesRefs = agg.refs.filter((r) => r.direction === 'uses');
      const usedByRefs = agg.refs.filter((r) => r.direction === 'usedBy');
      if (usesRefs.length > 0) addEdge(entityId, aggId, usesRefs.every((r) => r.rel.typeOnly));
      if (usedByRefs.length > 0) addEdge(aggId, entityId, usedByRefs.every((r) => r.rel.typeOnly));
    }
  }

  // ── Layout ──────────────────────────────────────────────────────────
  if (g.nodes().length > 0) dagre.layout(g);

  // ── Result builders ─────────────────────────────────────────────────
  const resultNodes: Node[] = [];
  const resultEdges: Edge[] = [];

  const mkEntity = (eid: string, isFocal = false): Node | null => {
    const dn = g.node(eid);
    if (!dn) return null;
    const ent = entityMap.get(eid);
    return {
      id: eid,
      type: 'entity',
      position: { x: dn.x - dn.width / 2, y: dn.y - dn.height / 2 },
      width: ENTITY_W,
      height: ENTITY_H,
      data: { entity: ent ?? { id: eid, kind: 'unknown', name: eid, filePath: '' }, focal: isFocal },
      selected: isFocal,
    };
  };

  const mkCluster = (nodeId: string, agg: AggRef, commId?: string): Node | null => {
    const nid = commId ?? nodeId;
    const dn = g.node(nid);
    if (!dn) return null;

    const comm = communityMap.get(commId ?? nodeId);
    let label: string;
    let fileCount: number;
    let totalLoc: number;
    let dominantRole: string;

    if (commId) {
      label = comm?.label || deriveGroupLabel(comm?.memberFileIds ?? []);
      fileCount = comm?.memberFileIds?.length ?? 0;
      totalLoc = comm?.totalLoc ?? 0;
      dominantRole = comm?.dominantRole ?? 'unknown';
    } else if (agg.kind === 'group') {
      label = agg.label;
      fileCount = 0;
      totalLoc = 0;
      for (const cid of agg.communityIds) {
        const c = communityMap.get(cid);
        if (c) { fileCount += c.memberFileIds.length; totalLoc += c.totalLoc ?? 0; }
      }
      dominantRole = 'unknown';
    } else {
      label = agg.label;
      fileCount = comm?.memberFileIds?.length ?? 0;
      totalLoc = comm?.totalLoc ?? 0;
      dominantRole = comm?.dominantRole ?? 'unknown';
    }

    return {
      id: nid,
      type: 'cluster',
      position: { x: dn.x - dn.width / 2, y: dn.y - dn.height / 2 },
      width: CLUSTER_W,
      height: CLUSTER_H,
      data: {
        group: { id: nid, label, fileIds: comm?.memberFileIds ?? [], source: 'community' as const },
        warningCount: 0,
        fileCount,
        expanded: false,
        dominantRole,
        totalLoc,
      },
    };
  };

  // Focal entity
  const focalNode = mkEntity(entityId, true);
  if (focalNode) resultNodes.push(focalNode);

  // Same-community entities
  for (const eid of sameCommEntityIds) {
    const n = mkEntity(eid);
    if (n) resultNodes.push(n);
  }

  // Cross-community nodes
  for (const [aggId, agg] of aggMap) {
    const expanded = options.expandedRefIds.has(aggId);
    if (expanded && agg.kind === 'group') {
      for (const commId of agg.communityIds) {
        if (options.expandedRefIds.has(commId)) {
          const eids = new Set(agg.refs
            .filter((r) => entityToCommunity.get(r.entityId) === commId)
            .map((r) => r.entityId));
          for (const eid of eids) { const n = mkEntity(eid); if (n) resultNodes.push(n); }
        } else {
          const n = mkCluster(aggId, agg, commId);
          if (n) resultNodes.push(n);
        }
      }
    } else if (expanded && agg.kind === 'community') {
      const eids = new Set(agg.refs.map((r) => r.entityId));
      for (const eid of eids) { const n = mkEntity(eid); if (n) resultNodes.push(n); }
    } else {
      const n = mkCluster(aggId, agg);
      if (n) resultNodes.push(n);
    }
  }

  // Result edges
  for (const [key, info] of edgeKeys) {
    const [src, tgt] = key.split('->');
    const strokeColor = info.typeOnly ? '#4a7a9b' : '#666';
    resultEdges.push({
      id: key,
      source: src,
      target: tgt,
      style: {
        strokeWidth: clamp(info.weight, 1, 3),
        stroke: strokeColor,
        opacity: 0.6,
        ...(info.typeOnly ? { strokeDasharray: '4 4' } : {}),
      },
      label: info.weight > 1 ? String(info.weight) : undefined,
      labelStyle: { fontSize: 9, fill: '#666' },
      labelBgStyle: { fill: '#1e1e1e', fillOpacity: 0.8 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: strokeColor },
    });
  }

  return { nodes: resultNodes, edges: resultEdges };
}
