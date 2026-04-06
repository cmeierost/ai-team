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
  ClusterEdge,
  ViewerGroup,
  NonCodeBreakdown,
} from '../types.js';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const MIN_GROUP_SIZE = 2;

function collectCommunityIdsFromSuperCluster(cluster: NonNullable<StructuralPipelineResult['communities']>['superClusters'][number]): string[] {
  const ids: string[] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['superClusters'][number] | { communityIds?: string[] }) => {
    const legacyCommunityIds = (sc as { communityIds?: string[] }).communityIds ?? [];
    if (legacyCommunityIds.length > 0) {
      ids.push(...legacyCommunityIds);
      return;
    }
    for (const child of (sc as NonNullable<StructuralPipelineResult['communities']>['superClusters'][number]).children ?? []) {
      if (child.kind === 'community') ids.push(child.communityId);
      else walk(child.cluster);
    }
  };
  walk(cluster);
  return ids;
}

function flattenSuperClusters(
  roots: NonNullable<StructuralPipelineResult['communities']>['superClusters'],
): NonNullable<StructuralPipelineResult['communities']>['superClusters'] {
  const all: NonNullable<StructuralPipelineResult['communities']>['superClusters'] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['superClusters'][number] | { children?: unknown[] }) => {
    all.push(sc as NonNullable<StructuralPipelineResult['communities']>['superClusters'][number]);
    for (const child of (sc as NonNullable<StructuralPipelineResult['communities']>['superClusters'][number]).children ?? []) {
      if (child.kind === 'supercluster') walk(child.cluster);
    }
  };
  for (const root of roots) walk(root);
  return all;
}

/**
 * Derive a human-readable label from a set of file paths.
 * Uses the package name + optional subfolder.
 */
export function deriveGroupLabel(fileIds: string[]): string {
  const paths = fileIds.map((f) =>
    f.replace(/^file:/, '').replace(/\\/g, '/'),
  );

  // Count by package name (2nd path segment: service, core, web, structural, etc.)
  const pkgCounts = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split('/');
    const pkg = parts.length >= 2 ? parts[1] : parts[0];
    pkgCounts.set(pkg, (pkgCounts.get(pkg) ?? 0) + 1);
  }
  const sorted = [...pkgCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 'group';

  const dominant = sorted[0];
  const total = fileIds.length;
  let label = dominant[0];

  // Try to refine with a common subfolder within the dominant package
  const dominantPaths = paths.filter((p) => {
    const parts = p.split('/');
    return parts[1] === dominant[0];
  });
  if (dominantPaths.length > 0) {
    const split = dominantPaths.map((p) => p.split('/'));
    // Find common segments beyond packages/<pkg>/src/
    const commonDepth = Math.min(...split.map((s) => s.length));
    let sharedSub = '';
    for (let i = 3; i < commonDepth; i++) {
      const seg = split[0][i];
      if (split.every((s) => s[i] === seg)) {
        sharedSub = sharedSub ? `${sharedSub}/${seg}` : seg;
      } else {
        break;
      }
    }
    if (sharedSub) {
      label = `${label} · ${sharedSub}`;
    }
  }

  // Annotate if significant files from other packages (>10%)
  if (sorted.length > 1) {
    const othersCount = total - dominant[1];
    if (othersCount / total > 0.1) {
      label = `${label} (+${sorted[1][0]})`;
    }
  }

  return label;
}

/**
 * Builds ViewerGroups for overview rendering.
 * When community/supercluster data exists, we must use community IDs so
 * supercluster membership maps correctly.
 */
function buildGroups(data: StructuralPipelineResult): ViewerGroup[] {
  const communityGroups = (data.communities?.communities ?? []).filter(
    (c) => c.memberFileIds.length >= MIN_GROUP_SIZE,
  );
  if (communityGroups.length > 0) {
    return communityGroups.map((c) => ({
      id: c.id,
      label: deriveGroupLabel(c.memberFileIds),
      fileIds: c.memberFileIds,
      source: 'community' as const,
    }));
  }

  return data.clusters.map((c) => ({
    id: c.id,
    label: deriveGroupLabel(c.fileIds),
    fileIds: c.fileIds,
    source: 'cluster' as const,
    cohesionRatio: c.cohesionRatio,
    cohesionType: c.cohesionType,
  }));
}

function resolveGroupOverlaps(
  groupPositions: Map<string, { x: number; y: number; w: number; h: number }>,
  paddingX = 40,
  paddingY = 28,
): void {
  const ids = [...groupPositions.keys()].sort();
  const maxIterations = 12;

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = groupPositions.get(ids[i]);
        const b = groupPositions.get(ids[j]);
        if (!a || !b) continue;

        const acx = a.x + a.w / 2;
        const bcx = b.x + b.w / 2;
        const acy = a.y + a.h / 2;
        const bcy = b.y + b.h / 2;

        const overlapX = (a.w / 2 + b.w / 2 + paddingX) - Math.abs(acx - bcx);
        const overlapY = (a.h / 2 + b.h / 2 + paddingY) - Math.abs(acy - bcy);

        if (overlapX <= 0 || overlapY <= 0) continue;
        changed = true;

        // Separate along the axis of least penetration.
        if (overlapX < overlapY) {
          const sign = acx <= bcx ? -1 : 1;
          const shift = overlapX / 2 + 0.5;
          a.x += sign * shift;
          b.x -= sign * shift;
        } else {
          const sign = acy <= bcy ? -1 : 1;
          const shift = overlapY / 2 + 0.5;
          a.y += sign * shift;
          b.y -= sign * shift;
        }
      }
    }

    if (!changed) break;
  }
}

function safeNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

export function useClusterGraph(
  data: StructuralPipelineResult,
  selection: Selection,
  options?: { hideTypeOnly?: boolean; showFullPath?: boolean; focusedSuperClusterId?: string; showSuperclusters?: boolean },
): { nodes: Node[]; edges: Edge[]; onNodesChange: OnNodesChange } {
  const [localNodes, setLocalNodes] = useState<Node[]>([]);

  const { nodes, edges } = useMemo(() => {
    const allGroups = buildGroups(data);
    let groups = allGroups;
    const allSuperClusters = flattenSuperClusters(data.communities?.superClusters ?? []);
    if (options?.focusedSuperClusterId) {
      const focused = allSuperClusters.find((sc) => sc.id === options.focusedSuperClusterId);
      if (focused) {
        const allowed = new Set(collectCommunityIdsFromSuperCluster(focused));
        groups = allGroups.filter((g) => allowed.has(g.id));
      }
    }

    const fileToGroup = new Map<string, string>();
    const groupedFileIds = new Set<string>();
    for (const group of groups) {
      for (const fid of group.fileIds) {
        fileToGroup.set(fid, group.id);
        groupedFileIds.add(fid);
      }
    }

    const qualityMap = new Map<string, (typeof data.alignment.clusterQuality)[number]>();
    for (const cq of data.alignment.clusterQuality) {
      qualityMap.set(cq.clusterId, cq);
    }

    const misplacedSet = new Set<string>();
    const misplacedMap = new Map<string, (typeof data.communities extends { misplacedFiles: (infer U)[] } | undefined ? U : never)>();
    if (data.communities?.misplacedFiles) {
      for (const mf of data.communities.misplacedFiles) {
        misplacedSet.add(mf.fileId);
        misplacedMap.set(mf.fileId, mf);
      }
    }

    const centralityMap = new Map<string, (typeof data.centrality extends (infer U)[] | undefined ? U : never)>();
    if (data.centrality) {
      for (const fc of data.centrality) {
        centralityMap.set(fc.fileId, fc);
      }
    }

    const fileClassMap = new Map<string, (typeof data.fileClassifications)[number]>();
    for (const fc of data.fileClassifications) {
      fileClassMap.set(fc.fileId, fc);
    }

    // Build barrel file set and re-export target map for edge resolution
    const barrelFileIds = new Set<string>();
    // barrel → set of files it re-exports from
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
            // reexportSources are file paths — convert to fileIds
            const srcId = `file:${src.replace(/\\/g, '/')}`;
            targets.add(srcId);
          }
          barrelReexportTargets.set(fi.fileId, targets);
        }
      }
    }

    const warningCountMap = new Map<string, number>();
    for (const w of data.alignment.warnings) {
      warningCountMap.set(w.target, (warningCountMap.get(w.target) ?? 0) + 1);
    }

    // Compute total LOC per group
    function computeGroupLoc(fileIds: string[]): number {
      let total = 0;
      for (const fid of fileIds) {
        const fc = fileClassMap.get(fid);
        if (fc?.linesOfCode) total += fc.linesOfCode;
      }
      return total;
    }

    // Compute a dominant role per group from file classifications
    function computeDominantRole(fileIds: string[]): string {
      const roleCounts = new Map<string, number>();
      for (const fid of fileIds) {
        const fc = fileClassMap.get(fid);
        const role = fc?.contentRole ?? 'unknown';
        roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      }
      let best = 'unknown';
      let bestCount = 0;
      for (const [role, count] of roleCounts) {
        if (count > bestCount) {
          best = role;
          bestCount = count;
        }
      }
      return best;
    }

    // --- Associate non-code files with groups by path ---
    // Build a map: package name → group id (use dominant package of each group)
    const pkgToGroup = new Map<string, string>();
    for (const group of groups) {
      const pkgCounts = new Map<string, number>();
      for (const fid of group.fileIds) {
        const fc = fileClassMap.get(fid);
        if (!fc) continue;
        const pkg = fc.filePath.replace(/\\/g, '/').split('/')[1] ?? '';
        pkgCounts.set(pkg, (pkgCounts.get(pkg) ?? 0) + 1);
      }
      // Each package maps to the group that owns the most files from it
      for (const [pkg, count] of pkgCounts) {
        const existing = pkgToGroup.get(pkg);
        if (!existing) {
          pkgToGroup.set(pkg, group.id);
        } else {
          // Keep the group with more files from this package
          const existingGroup = groups.find((g) => g.id === existing);
          if (existingGroup) {
            const existingCount = existingGroup.fileIds.filter((fid) => {
              const fc2 = fileClassMap.get(fid);
              return fc2 && fc2.filePath.replace(/\\/g, '/').split('/')[1] === pkg;
            }).length;
            if (count > existingCount) {
              pkgToGroup.set(pkg, group.id);
            }
          }
        }
      }
    }

    // Collect non-code files per group
    const nonCodeByGroup = new Map<string, Map<string, string[]>>();
    for (const fc of data.fileClassifications) {
      if (fc.category === 'code') continue;
      if (groupedFileIds.has(fc.fileId)) continue;
      const pkg = fc.filePath.replace(/\\/g, '/').split('/')[1] ?? '';
      const groupId = pkgToGroup.get(pkg);
      if (!groupId) continue;

      let catMap = nonCodeByGroup.get(groupId);
      if (!catMap) {
        catMap = new Map<string, string[]>();
        nonCodeByGroup.set(groupId, catMap);
      }
      let files = catMap.get(fc.category);
      if (!files) {
        files = [];
        catMap.set(fc.category, files);
      }
      files.push(fc.filePath);
    }

    function buildNonCodeBreakdown(groupId: string): NonCodeBreakdown {
      const catMap = nonCodeByGroup.get(groupId);
      if (!catMap) return { total: 0, byCategory: [] };
      const byCategory: NonCodeBreakdown['byCategory'] = [];
      let total = 0;
      for (const [category, files] of catMap) {
        byCategory.push({ category, count: files.length, files });
        total += files.length;
      }
      byCategory.sort((a, b) => b.count - a.count);
      return { total, byCategory };
    }

    // --- Compute LOC per group for sizing ---
    const groupLocMap = new Map<string, number>();
    for (const group of groups) {
      groupLocMap.set(group.id, computeGroupLoc(group.fileIds));
    }
    const allLocs = [...groupLocMap.values()].filter((v) => v > 0);
    const maxLoc = allLocs.length > 0 ? Math.max(...allLocs) : 1;
    const minLoc = allLocs.length > 0 ? Math.min(...allLocs) : 0;

    /** Scale a group's collapsed dimensions based on its LOC relative to the range */
    function locScaledSize(groupId: string): { w: number; h: number } {
      const loc = groupLocMap.get(groupId) ?? 0;
      // Normalize 0..1 with sqrt for gentler scaling
      const t = maxLoc > minLoc ? Math.sqrt((loc - minLoc) / (maxLoc - minLoc)) : 0.5;
      const w = Math.round(200 + t * 200); // 200..400
      const h = Math.round(80 + t * 60);   // 80..140
      return { w, h };
    }

    // --- Dagre layout for connected nodes, grid for disconnected ---
    // Build group edges including edges where one side is ungrouped
    // (map ungrouped files to their nearest group via package ownership)
    const connectedGroupIds = new Set<string>();
    const groupEdgeMap = new Map<string, ClusterEdge>();

    function addGroupEdge(srcGroup: string, tgtGroup: string, we: typeof data.weightedEdges[number], isReexport = false) {
      if (srcGroup === tgtGroup) return;
      connectedGroupIds.add(srcGroup);
      connectedGroupIds.add(tgtGroup);

      const key = srcGroup < tgtGroup
        ? `${srcGroup}->${tgtGroup}`
        : `${tgtGroup}->${srcGroup}`;
      const normalized = srcGroup < tgtGroup
        ? { source: srcGroup, target: tgtGroup }
        : { source: tgtGroup, target: srcGroup };

      let ce = groupEdgeMap.get(key);
      if (!ce) {
        ce = {
          sourceClusterId: normalized.source,
          targetClusterId: normalized.target,
          totalWeight: 0,
          edgeCount: 0,
          typeOnlyCount: 0,
          reexportCount: 0,
        };
        groupEdgeMap.set(key, ce);
      }
      ce.totalWeight += we.weight;
      ce.edgeCount += 1;
      if (we.isTypeOnly) ce.typeOnlyCount += 1;
      if (isReexport) ce.reexportCount += 1;
    }

    for (const we of data.weightedEdges) {
      if (options?.hideTypeOnly && we.isTypeOnly) continue;

      const srcIsBarrel = barrelFileIds.has(we.sourceFileId);
      const tgtIsBarrel = barrelFileIds.has(we.targetFileId);

      let srcGroup = fileToGroup.get(we.sourceFileId);
      let tgtGroup = fileToGroup.get(we.targetFileId);

      // Map ungrouped files to a group via package ownership
      if (!srcGroup) {
        const fc = fileClassMap.get(we.sourceFileId);
        if (fc) {
          const pkg = fc.filePath.replace(/\\/g, '/').split('/')[1] ?? '';
          srcGroup = pkgToGroup.get(pkg);
        }
      }
      if (!tgtGroup) {
        const fc = fileClassMap.get(we.targetFileId);
        if (fc) {
          const pkg = fc.filePath.replace(/\\/g, '/').split('/')[1] ?? '';
          tgtGroup = pkgToGroup.get(pkg);
        }
      }

      if (srcGroup && tgtGroup) {
        // "Show full path": when target is a barrel, resolve through to actual files
        if (options?.showFullPath && tgtIsBarrel) {
          const reexportTargets = barrelReexportTargets.get(we.targetFileId);
          if (reexportTargets && reexportTargets.size > 0) {
            for (const resolvedId of reexportTargets) {
              const resolvedGroup = fileToGroup.get(resolvedId);
              if (resolvedGroup) {
                addGroupEdge(srcGroup, resolvedGroup, we, true);
              }
            }
            continue; // skip the barrel edge itself
          }
        }
        addGroupEdge(srcGroup, tgtGroup, we, srcIsBarrel || tgtIsBarrel);
      }
    }

    const connectedGroups = groups.filter((g) => connectedGroupIds.has(g.id));
    const disconnectedGroups = groups.filter((g) => !connectedGroupIds.has(g.id));

    // Layout connected nodes with dagre.
    // Superclusters are rendered as visual overlays, not dagre compound parents,
    // to avoid dagre's dummy-node conflict path in dense layered graphs.
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 110, ranksep: 170, ranker: 'longest-path' });
    g.setDefaultEdgeLabel(() => ({}));

    // Build supercluster membership lookup
    const superClusters = allSuperClusters;
    const groupToSuperCluster = new Map<string, string>();
    for (const sc of superClusters) {
      const communityIds = collectCommunityIdsFromSuperCluster(sc);
      if (communityIds.length < 2) continue; // don't group trivial superclusters
      for (const cid of communityIds) groupToSuperCluster.set(cid, sc.id);
    }

    // Track active superclusters for overlay rendering.
    const activeSuperClusters = new Set<string>();
    for (const group of connectedGroups) {
      const scId = groupToSuperCluster.get(group.id);
      if (scId && !activeSuperClusters.has(scId)) {
        activeSuperClusters.add(scId);
      }
    }

    for (const group of connectedGroups) {
      const scaled = locScaledSize(group.id);
      g.setNode(group.id, { width: scaled.w, height: scaled.h });
    }

    for (const ce of groupEdgeMap.values()) {
      g.setEdge(ce.sourceClusterId, ce.targetClusterId, { weight: ce.totalWeight });
    }

    if (connectedGroups.length > 0) {
      dagre.layout(g);
    }

    // Find the bounding box of the dagre layout to place disconnected nodes beside it
    let maxX = 0;
    let maxY = 0;
    for (const group of connectedGroups) {
      const dn = g.node(group.id);
      maxX = Math.max(maxX, dn.x + dn.width / 2);
      maxY = Math.max(maxY, dn.y + dn.height / 2);
    }

    // Place disconnected groups in a grid to the right of connected ones
    const gridStartX = connectedGroups.length > 0 ? maxX + 120 : 0;
    const gridCols = Math.max(1, Math.ceil(Math.sqrt(disconnectedGroups.length)));
    const gridCellW = 420;
    const gridCellH = 180;

    // Build position map for all groups
    const groupPositions = new Map<string, { x: number; y: number; w: number; h: number }>();

    for (const group of connectedGroups) {
      const dn = g.node(group.id);
      groupPositions.set(group.id, {
        x: safeNumber(dn?.x, 0) - safeNumber(dn?.width, 260) / 2,
        y: safeNumber(dn?.y, 0) - safeNumber(dn?.height, 96) / 2,
        w: safeNumber(dn?.width, 260),
        h: safeNumber(dn?.height, 96),
      });
    }

    disconnectedGroups
      .sort((a, b) => b.fileIds.length - a.fileIds.length)
      .forEach((group, idx) => {
        const col = idx % gridCols;
        const row = Math.floor(idx / gridCols);
        const scaled = locScaledSize(group.id);
        groupPositions.set(group.id, {
          x: gridStartX + col * gridCellW,
          y: row * gridCellH,
          w: scaled.w,
          h: scaled.h,
        });
      });

    // Sanitize any bad coordinates/sizes from layout edge cases.
    let fallbackIdx = 0;
    for (const [gid, pos] of groupPositions) {
      const x = safeNumber(pos.x, gridStartX + (fallbackIdx % Math.max(gridCols, 1)) * gridCellW);
      const y = safeNumber(pos.y, Math.floor(fallbackIdx / Math.max(gridCols, 1)) * gridCellH);
      const w = Math.max(120, safeNumber(pos.w, 260));
      const h = Math.max(60, safeNumber(pos.h, 96));
      groupPositions.set(gid, { x, y, w, h });
      fallbackIdx++;
    }

    // Final collision pass: keep group nodes from overlapping after Dagre/grid placement.
    resolveGroupOverlaps(groupPositions);

    // --- Generate nodes ---
    const resultNodes: Node[] = [];
    const contractHubEdges: Edge[] = [];

    // Supercluster bounding-box nodes (visual overlays for active scopes only).
    const shouldRenderSuperclusters = !!options?.showSuperclusters || !!options?.focusedSuperClusterId;
    const PAD = 30;
    if (shouldRenderSuperclusters) for (const sc of superClusters) {
      if (!activeSuperClusters.has(sc.id)) continue;
      const communityIds = collectCommunityIdsFromSuperCluster(sc);
      if (communityIds.length < 2) continue;
      // Compute bounding box of all member community positions
      let minX = Infinity, minY = Infinity, maxXB = -Infinity, maxYB = -Infinity;
      let totalFiles = 0;
      let contractCount = 0;
      let glueContractLoc = 0;
      let glueInfrastructureLoc = 0;
      let glueOtherLoc = 0;
      let hasMember = false;
      for (const cid of communityIds) {
        const pos = groupPositions.get(cid);
        if (!pos) continue;
        hasMember = true;
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxXB = Math.max(maxXB, pos.x + pos.w);
        maxYB = Math.max(maxYB, pos.y + pos.h);
        const grp = groups.find((g) => g.id === cid);
        if (grp) {
          totalFiles += grp.fileIds.length;
          for (const fid of grp.fileIds) {
            const fc = fileClassMap.get(fid);
            if (fc?.contentRole === 'contract' || fc?.contentRole === 'infrastructure') {
              contractCount++;
            }
          }
        }
      }
      if (!hasMember) continue;

      for (const fid of sc.sharedContractFileIds ?? []) {
        const fc = fileClassMap.get(fid);
        const loc = fc?.linesOfCode ?? 0;
        if (fc?.contentRole === 'contract') glueContractLoc += loc;
        else if (fc?.contentRole === 'infrastructure') glueInfrastructureLoc += loc;
        else glueOtherLoc += loc;
      }
      const glueTotalLoc = glueContractLoc + glueInfrastructureLoc + glueOtherLoc;
      const glueContractRatio = glueTotalLoc > 0 ? glueContractLoc / glueTotalLoc : 0;

      // Derive a label from the member communities
      const memberLabels = communityIds
        .map((cid) => groups.find((g) => g.id === cid))
        .filter(Boolean)
        .map((g) => g!.label);
      const labelCounts = new Map<string, number>();
      for (const l of memberLabels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
      const scLabel = [...labelCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([l]) => l)
        .slice(0, 3)
        .join(' + ');

      const scX = safeNumber(minX - PAD, 0);
      const scY = safeNumber(minY - PAD, 0);
      const scW = Math.max(160, safeNumber(maxXB - minX + PAD * 2, 300));
      const scH = Math.max(100, safeNumber(maxYB - minY + PAD * 2, 160));

      const sharedContractOnlyIds = (sc.sharedContractFileIds ?? []).filter((fid) => {
        const role = fileClassMap.get(fid)?.contentRole;
        return role === 'contract';
      });

      resultNodes.push({
        id: sc.id,
        type: 'supercluster',
        position: { x: scX, y: scY },
        width: scW,
        height: scH,
        zIndex: -1,
        selectable: true,
        draggable: false,
        data: {
          label: scLabel,
          communityCount: communityIds.length,
          fileCount: totalFiles,
          contractCount,
          sharedContractLoc: sc.sharedContractLoc ?? 0,
          glueContractLoc,
          glueInfrastructureLoc,
          glueOtherLoc,
          glueContractRatio,
          exposureRatio: sc.exposureRatio ?? 0,
          coordinatorScope: sc.coordinatorScope ?? '',
        },
        style: { zIndex: -1 },
      });

      if (sharedContractOnlyIds.length > 0 && glueContractLoc > 0) {
        const hubId = `${sc.id}::shared-contracts`;
        const hubW = 220;
        const hubH = 66;
        const hubX = scX + Math.max(12, (scW - hubW) / 2);
        const hubY = scY + 6;

        resultNodes.push({
          id: hubId,
          type: 'cluster',
          position: { x: hubX, y: hubY },
          width: hubW,
          height: hubH,
          zIndex: 2,
          selectable: false,
          draggable: false,
          data: {
            group: {
              id: hubId,
              label: 'Shared contracts',
              fileIds: sharedContractOnlyIds,
              source: 'community',
            },
            warningCount: 0,
            fileCount: sharedContractOnlyIds.length,
            expanded: false,
            dominantRole: 'contract',
            totalLoc: glueContractLoc,
            contractHub: true,
            contractSharePct: 100,
          },
          selected: false,
        });

        const connectedChildren = communityIds.filter((cid) => groupPositions.has(cid));
        for (const cid of connectedChildren.slice(0, 12)) {
          contractHubEdges.push({
            id: `${hubId}->${cid}`,
            source: hubId,
            target: cid,
            style: {
              stroke: '#22d3ee',
              strokeWidth: 1.5,
              opacity: 0.3,
              strokeDasharray: '4 3',
            },
            animated: false,
          });
        }
      }
    }

    for (const group of groups) {
      const pos = groupPositions.get(group.id)!;
      const fileCount = group.fileIds.length;
      const quality = qualityMap.get(group.id);
      const warningCount = warningCountMap.get(group.id) ?? 0;
      const dominantRole = quality?.dominantRole ?? computeDominantRole(group.fileIds);

      const nonCode = buildNonCodeBreakdown(group.id);
      const totalLoc = groupLocMap.get(group.id) ?? 0;

      const clusterNode: Node = {
        id: group.id,
        type: 'cluster',
        position: { x: safeNumber(pos.x, 0), y: safeNumber(pos.y, 0) },
        width: Math.max(120, safeNumber(pos.w, 260)),
        height: Math.max(60, safeNumber(pos.h, 96)),
        data: {
          group,
          quality,
          warningCount,
          fileCount,
          expanded: false,
          dominantRole,
          nonCode,
          totalLoc,
        },
        selected:
          selection.type === 'cluster' && selection.id === group.id,
      };
      resultNodes.push(clusterNode);
    }

    // --- Generate edges ---
    const resultEdges: Edge[] = [];

    for (const ce of groupEdgeMap.values()) {
      const strokeWidth = clamp(ce.totalWeight, 1, 6);
      const typeOnlyRatio = ce.edgeCount > 0 ? ce.typeOnlyCount / ce.edgeCount : 0;
      const reexportRatio = ce.edgeCount > 0 ? ce.reexportCount / ce.edgeCount : 0;

      // Build label: edge count + resolved re-export indicator
      let label = ce.edgeCount > 1 ? ce.edgeCount.toString() : '';
      if (options?.showFullPath && ce.reexportCount > 0) {
        label = `${ce.edgeCount} (${ce.reexportCount} resolved)`;
      }

      resultEdges.push({
        id: `${ce.sourceClusterId}->${ce.targetClusterId}`,
        source: ce.sourceClusterId,
        target: ce.targetClusterId,
        style: {
          strokeWidth,
          stroke: reexportRatio > 0.5 ? '#6b8e6b' : '#555',
          opacity: 0.35,
          ...(typeOnlyRatio > 0.8 ? { strokeDasharray: '5 5' } : {}),
        },
        animated: false,
        ...(label ? { label } : {}),
        labelStyle: { fill: '#aaa', fontSize: 10 },
        labelBgStyle: { fill: '#1e1e1e', fillOpacity: 0.8 },
      });
    }

    resultEdges.push(...contractHubEdges);

    return { nodes: resultNodes, edges: resultEdges };
  }, [data, selection, options?.hideTypeOnly, options?.showFullPath, options?.focusedSuperClusterId, options?.showSuperclusters]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setLocalNodes((prev) => applyNodeChanges(changes, prev.length ? prev : nodes)),
    [nodes],
  );

  return { nodes, edges, onNodesChange };
}
