/**
 * @aspect/viewer — useClusterDrilldown
 *
 * Generates a ReactFlow graph for a single cluster/community drilldown view.
 * Shows all files in the group as nodes with intra-group edges.
 */

import { useMemo, useCallback, useState } from 'react';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  applyNodeChanges,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import type {
  StructuralPipelineResult,
  Selection,
} from '../types.js';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function useClusterDrilldown(
  data: StructuralPipelineResult,
  groupId: string,
  selection: Selection,
  options?: { hideTypeOnly?: boolean; showFullPath?: boolean },
): { nodes: Node[]; edges: Edge[]; onNodesChange: OnNodesChange } {
  const [localNodes, setLocalNodes] = useState<Node[]>([]);

  const { nodes, edges } = useMemo(() => {
    // Find the group
    const community = data.communities?.communities?.find((c) => c.id === groupId);
    const cluster = data.clusters.find((c) => c.id === groupId);
    const fileIds = community?.memberFileIds ?? cluster?.fileIds ?? [];
    const fileSet = new Set(fileIds);

    // Build maps
    const fileClassMap = new Map<string, (typeof data.fileClassifications)[number]>();
    for (const fc of data.fileClassifications) fileClassMap.set(fc.fileId, fc);

    const misplacedSet = new Set<string>();
    const misplacedMap = new Map<string, NonNullable<typeof data.communities>['misplacedFiles'][number]>();
    if (data.communities?.misplacedFiles) {
      for (const mf of data.communities.misplacedFiles) {
        misplacedSet.add(mf.fileId);
        misplacedMap.set(mf.fileId, mf);
      }
    }

    const centralityMap = new Map<string, NonNullable<typeof data.centrality>[number]>();
    if (data.centrality) {
      for (const fc of data.centrality) centralityMap.set(fc.fileId, fc);
    }

    // Build barrel set and re-export map
    const barrelFileIds = new Set<string>();
    const barrelReexportTargets = new Map<string, Set<string>>();
    for (const fc of data.fileClassifications) {
      if (fc.contentRole === 'barrel') barrelFileIds.add(fc.fileId);
    }
    if (data.exportAnalysis) {
      for (const fi of data.exportAnalysis.files) {
        if (fi.reexportSources && fi.reexportSources.length > 0) {
          barrelFileIds.add(fi.fileId);
          const targets = new Set<string>();
          for (const src of fi.reexportSources) {
            targets.add(`file:${src.replace(/\\/g, '/')}`);
          }
          barrelReexportTargets.set(fi.fileId, targets);
        }
      }
    }

    // Intra-group edges with filtering and full-path resolution
    type ResolvedEdge = typeof data.weightedEdges[number] & { viaBarrel?: string };
    const intraEdges: ResolvedEdge[] = [];
    for (const we of data.weightedEdges) {
      if (options?.hideTypeOnly && we.isTypeOnly) continue;

      const srcIsBarrel = barrelFileIds.has(we.sourceFileId);
      const tgtIsBarrel = barrelFileIds.has(we.targetFileId);

      // Full-path resolution: when target is barrel, create edges to resolved targets
      if (options?.showFullPath && tgtIsBarrel) {
        const targets = barrelReexportTargets.get(we.targetFileId);
        if (targets && targets.size > 0) {
          const barrelName = fileClassMap.get(we.targetFileId)?.filePath?.split('/').pop() ?? 'index';
          for (const resolvedId of targets) {
            if (fileSet.has(we.sourceFileId) && fileSet.has(resolvedId)) {
              intraEdges.push({ ...we, targetFileId: resolvedId, viaBarrel: barrelName });
            }
          }
          continue;
        }
      }

      if (fileSet.has(we.sourceFileId) && fileSet.has(we.targetFileId)) {
        intraEdges.push(we);
      }
    }

    // When showing full paths, remove pure barrel nodes (their edges are resolved)
    const visibleFileIds = options?.showFullPath
      ? fileIds.filter((fid) => !barrelFileIds.has(fid))
      : fileIds;

    // Dagre layout for files
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 80, ranker: 'longest-path' });
    g.setDefaultEdgeLabel(() => ({}));

    const nodeW = 220;
    const nodeH = 48;

    // Separate connected vs isolated files
    const connectedFiles = new Set<string>();
    for (const e of intraEdges) {
      connectedFiles.add(e.sourceFileId);
      connectedFiles.add(e.targetFileId);
    }

    const connectedList = visibleFileIds.filter((f) => connectedFiles.has(f));
    const isolatedList = visibleFileIds.filter((f) => !connectedFiles.has(f));

    for (const fid of connectedList) {
      g.setNode(fid, { width: nodeW, height: nodeH });
    }
    for (const e of intraEdges) {
      g.setEdge(e.sourceFileId, e.targetFileId, { weight: e.weight });
    }

    if (connectedList.length > 0) {
      dagre.layout(g);
    }

    // Find dagre bounding box
    let maxX = 0;
    let maxY = 0;
    for (const fid of connectedList) {
      const dn = g.node(fid);
      maxX = Math.max(maxX, dn.x + dn.width / 2);
      maxY = Math.max(maxY, dn.y + dn.height / 2);
    }

    // Place isolated files in a grid below the dagre layout
    const gridStartY = connectedList.length > 0 ? maxY + 60 : 0;
    const gridCols = Math.max(1, Math.ceil(Math.sqrt(isolatedList.length)));
    const gridCellW = nodeW + 20;
    const gridCellH = nodeH + 20;

    // Build nodes
    const resultNodes: Node[] = [];

    for (const fid of connectedList) {
      const dn = g.node(fid);
      const file = fileClassMap.get(fid);
      resultNodes.push({
        id: fid,
        type: 'file',
        position: { x: dn.x - dn.width / 2, y: dn.y - dn.height / 2 },
        width: nodeW,
        height: nodeH,
        data: {
          file: file ?? { fileId: fid, filePath: fid, category: 'code' },
          isMisplaced: misplacedSet.has(fid),
          misplacedInfo: misplacedMap.get(fid),
          centrality: centralityMap.get(fid),
        },
        selected: selection.type === 'file' && selection.id === fid,
      });
    }

    isolatedList.forEach((fid, idx) => {
      const col = idx % gridCols;
      const row = Math.floor(idx / gridCols);
      const file = fileClassMap.get(fid);
      resultNodes.push({
        id: fid,
        type: 'file',
        position: { x: col * gridCellW, y: gridStartY + row * gridCellH },
        width: nodeW,
        height: nodeH,
        data: {
          file: file ?? { fileId: fid, filePath: fid, category: 'code' },
          isMisplaced: misplacedSet.has(fid),
          misplacedInfo: misplacedMap.get(fid),
          centrality: centralityMap.get(fid),
        },
        selected: selection.type === 'file' && selection.id === fid,
      });
    });

    // Build edges — deduplicate resolved edges and add "via" labels
    const edgeMap = new Map<string, ResolvedEdge>();
    for (const we of intraEdges) {
      const key = `${we.sourceFileId}->${we.targetFileId}`;
      if (!edgeMap.has(key)) edgeMap.set(key, we);
    }

    const resultEdges: Edge[] = [...edgeMap.values()].map((we) => {
      const isResolved = 'viaBarrel' in we && we.viaBarrel;
      return {
        id: `${we.sourceFileId}->${we.targetFileId}`,
        source: we.sourceFileId,
        target: we.targetFileId,
        style: {
          strokeWidth: clamp(we.weight, 1, 4),
          stroke: isResolved ? '#6b8e6b' : we.isTypeOnly ? '#4a7a9b' : '#666',
          opacity: 0.5,
          ...(we.isTypeOnly ? { strokeDasharray: '4 4' } : {}),
          ...(isResolved ? { strokeDasharray: '8 3' } : {}),
        },
        animated: false,
        ...(isResolved ? { label: `via ${we.viaBarrel}`, labelStyle: { fill: '#8fbc8f', fontSize: 9 }, labelBgStyle: { fill: '#1e1e1e', fillOpacity: 0.8 } } : {}),
      };
    });

    return { nodes: resultNodes, edges: resultEdges };
  }, [data, groupId, selection, options?.hideTypeOnly, options?.showFullPath]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setLocalNodes((prev) => applyNodeChanges(changes, prev.length ? prev : nodes)),
    [nodes],
  );

  return { nodes, edges, onNodesChange };
}
