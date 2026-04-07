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
  ClusterEdge,
  ViewerGroup,
  NonCodeBreakdown,
} from '../types.js';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const MIN_GROUP_SIZE = 2;

function collectCommunityIdsFromCommunityGroup(cluster: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number]): string[] {
  const ids: string[] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number] | { communityIds?: string[] }) => {
    const legacyCommunityIds = (sc as { communityIds?: string[] }).communityIds ?? [];
    if (legacyCommunityIds.length > 0) {
      ids.push(...legacyCommunityIds);
      return;
    }
    for (const child of (sc as NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number]).children ?? []) {
      if (child.kind === 'community') ids.push(child.communityId);
      else walk(child.cluster);
    }
  };
  walk(cluster);
  return ids;
}

function flattenCommunityGroups(
  roots: NonNullable<StructuralPipelineResult['communities']>['communityGroups'],
): NonNullable<StructuralPipelineResult['communities']>['communityGroups'] {
  const all: NonNullable<StructuralPipelineResult['communities']>['communityGroups'] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number] | { children?: unknown[] }) => {
    all.push(sc as NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number]);
    for (const child of (sc as NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number]).children ?? []) {
      if (child.kind === 'communityGroup') walk(child.cluster);
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
 * When community/CommunityGroup data exists, we must use community IDs so
 * CommunityGroup membership maps correctly.
 */
function buildGroups(data: StructuralPipelineResult): ViewerGroup[] {
  const communityGroups = (data.communities?.communities ?? []).filter(
    (c) => c.memberFileIds.length >= MIN_GROUP_SIZE,
  );
  if (communityGroups.length > 0) {
    return communityGroups.map((c) => ({
      id: c.id,
      label: c.label || deriveGroupLabel(c.memberFileIds),
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
  options?: { hideTypeOnly?: boolean; showFullPath?: boolean; focusedCommunityGroupId?: string; showCommunityGroups?: boolean },
): { nodes: Node[]; edges: Edge[]; onNodesChange: OnNodesChange } {
  const [localNodes, setLocalNodes] = useState<Node[]>([]);

  const { nodes, edges } = useMemo(() => {
    const allGroups = buildGroups(data);
    let groups = allGroups;
    const allCommunityGroups = flattenCommunityGroups(data.communities?.communityGroups ?? []);
    if (options?.focusedCommunityGroupId) {
      const focused = allCommunityGroups.find((sc) => sc.id === options.focusedCommunityGroupId);
      if (focused) {
        const allowed = new Set(collectCommunityIdsFromCommunityGroup(focused));
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
      const isForward = srcGroup < tgtGroup;

      let ce = groupEdgeMap.get(key);
      if (!ce) {
        ce = {
          sourceClusterId: srcGroup < tgtGroup ? srcGroup : tgtGroup,
          targetClusterId: srcGroup < tgtGroup ? tgtGroup : srcGroup,
          totalWeight: 0,
          edgeCount: 0,
          typeOnlyCount: 0,
          reexportCount: 0,
          forwardWeight: 0,
          backwardWeight: 0,
        };
        groupEdgeMap.set(key, ce);
      }
      const edge = ce;
      edge.totalWeight += we.weight;
      edge.edgeCount += 1;
      if (isForward) edge.forwardWeight += we.weight;
      else edge.backwardWeight += we.weight;
      if (we.isTypeOnly) edge.typeOnlyCount += 1;
      if (isReexport) edge.reexportCount += 1;
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

    // ── Hierarchical layout ──────────────────────────────────────────────
    // Goal: CommunityGroups only overlap when they have a parent-child relation.
    // Strategy: multi-level dagre — lay out children inside each CommunityGroup,
    // then lay out CommunityGroups (as compound bounding boxes) at the next level up.

    const communityGroups = allCommunityGroups;

    // Build immediate-parent mapping: communityId → innermost CommunityGroup id
    // and CommunityGroupId → parent CommunityGroup id
    const communityToImmediateParent = new Map<string, string>();
    const scToParent = new Map<string, string>();
    const rootScIds = new Set<string>();

    function mapImmediateParents(
      sc: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number],
      parentId?: string,
    ) {
      if (parentId) scToParent.set(sc.id, parentId);
      else rootScIds.add(sc.id);
      for (const child of sc.children ?? []) {
        if (child.kind === 'community') {
          communityToImmediateParent.set(child.communityId, sc.id);
        } else {
          mapImmediateParents(child.cluster, sc.id);
        }
      }
    }
    for (const sc of data.communities?.communityGroups ?? []) {
      mapImmediateParents(sc);
    }

    // Track active CommunityGroups for overlay rendering.
    const activeCommunityGroups = new Set<string>();
    for (const group of connectedGroups) {
      const scId = communityToImmediateParent.get(group.id);
      if (scId) {
        // Walk up to mark all ancestors active too
        let cur: string | undefined = scId;
        while (cur) {
          activeCommunityGroups.add(cur);
          cur = scToParent.get(cur);
        }
      }
    }

    // Map CommunityGroup id → CommunityGroup object
    const scById = new Map<string, typeof communityGroups[number]>();
    for (const sc of communityGroups) scById.set(sc.id, sc);

    // Build position map for all groups (communities)
    const groupPositions = new Map<string, { x: number; y: number; w: number; h: number }>();
    // Also track CommunityGroup bounding boxes for overlap resolution between siblings
    const scBounds = new Map<string, { x: number; y: number; w: number; h: number }>();

    const SC_PAD = 40;
    const SC_TOP_PAD = 60; // extra top padding for CommunityGroup label

    /**
     * Recursively lay out a CommunityGroup's children and return its bounding box size.
     * Positions are stored relative to the CommunityGroup's top-left origin.
     * Returns { w, h } of the CommunityGroup bounding box.
     */
    function layoutCommunityGroup(
      sc: typeof communityGroups[number],
      connectedGroupSet: Set<string>,
    ): { w: number; h: number } {
      // Collect direct children
      const directCommunityIds: string[] = [];
      const directChildScs: { sc: typeof communityGroups[number]; w: number; h: number }[] = [];

      for (const child of sc.children ?? []) {
        if (child.kind === 'community') {
          directCommunityIds.push(child.communityId);
        } else {
          // Recursively layout the child CommunityGroup first
          const childSize = layoutCommunityGroup(child.cluster, connectedGroupSet);
          directChildScs.push({ sc: child.cluster, ...childSize });
        }
      }

      // Filter to only communities that are actually in our connected groups
      const activeCommunities = directCommunityIds.filter((cid) => connectedGroupSet.has(cid));

      // If nothing is active, return minimal size
      if (activeCommunities.length === 0 && directChildScs.length === 0) {
        return { w: 200, h: 100 };
      }

      // Sub-dagre for this CommunityGroup's direct children
      const subG = new dagre.graphlib.Graph();
      subG.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 120, ranker: 'longest-path' });
      subG.setDefaultEdgeLabel(() => ({}));

      // Add direct community children as nodes
      for (const cid of activeCommunities) {
        const scaled = locScaledSize(cid);
        subG.setNode(cid, { width: scaled.w, height: scaled.h });
      }

      // Add child CommunityGroups as compound nodes (using their computed bounding box size)
      for (const csc of directChildScs) {
        subG.setNode(csc.sc.id, { width: csc.w, height: csc.h });
      }

      // Add edges between children in this scope
      const childIdSet = new Set([
        ...activeCommunities,
        ...directChildScs.map((c) => c.sc.id),
      ]);

      // For edges: we need to map community-level edges to this scope level.
      // If both ends are communities in this scope, add directly.
      // If one end is in a child CommunityGroup, use the child sc id as proxy.
      const communityToLocalNode = new Map<string, string>();
      for (const cid of activeCommunities) {
        communityToLocalNode.set(cid, cid);
      }
      for (const csc of directChildScs) {
        const descendantIds = collectCommunityIdsFromCommunityGroup(csc.sc);
        for (const did of descendantIds) {
          communityToLocalNode.set(did, csc.sc.id);
        }
      }

      // Add edges scoped to this CommunityGroup
      const addedEdges = new Set<string>();
      for (const ce of groupEdgeMap.values()) {
        const srcLocal = communityToLocalNode.get(ce.sourceClusterId);
        const tgtLocal = communityToLocalNode.get(ce.targetClusterId);
        if (!srcLocal || !tgtLocal || srcLocal === tgtLocal) continue;
        if (!childIdSet.has(srcLocal) || !childIdSet.has(tgtLocal)) continue;
        const eKey = srcLocal < tgtLocal ? `${srcLocal}→${tgtLocal}` : `${tgtLocal}→${srcLocal}`;
        if (addedEdges.has(eKey)) continue;
        addedEdges.add(eKey);
        subG.setEdge(srcLocal, tgtLocal, { weight: ce.totalWeight });
      }

      // Run dagre layout
      const nodeCount = activeCommunities.length + directChildScs.length;
      if (nodeCount > 0) {
        dagre.layout(subG);
      }

      // Compute bounding box of results
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      for (const cid of activeCommunities) {
        const dn = subG.node(cid);
        if (!dn) continue;
        const x = safeNumber(dn.x, 0) - safeNumber(dn.width, 200) / 2;
        const y = safeNumber(dn.y, 0) - safeNumber(dn.height, 80) / 2;
        const w = safeNumber(dn.width, 200);
        const h = safeNumber(dn.height, 80);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
        // Store position temporarily relative to sub-dagre origin
        groupPositions.set(cid, { x, y, w, h });
      }

      for (const csc of directChildScs) {
        const dn = subG.node(csc.sc.id);
        if (!dn) continue;
        const x = safeNumber(dn.x, 0) - csc.w / 2;
        const y = safeNumber(dn.y, 0) - csc.h / 2;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + csc.w);
        maxY = Math.max(maxY, y + csc.h);
        // Store child CommunityGroup bounds for later translation
        scBounds.set(csc.sc.id, { x, y, w: csc.w, h: csc.h });
      }

      if (!Number.isFinite(minX)) {
        return { w: 200, h: 100 };
      }

      // Normalize: shift all positions so they start from (SC_PAD, SC_TOP_PAD)
      const offsetX = SC_PAD - minX;
      const offsetY = SC_TOP_PAD - minY;

      for (const cid of activeCommunities) {
        const pos = groupPositions.get(cid);
        if (pos) {
          pos.x += offsetX;
          pos.y += offsetY;
        }
      }
      for (const csc of directChildScs) {
        const bounds = scBounds.get(csc.sc.id);
        if (bounds) {
          bounds.x += offsetX;
          bounds.y += offsetY;
        }
      }

      const totalW = (maxX - minX) + SC_PAD * 2;
      const totalH = (maxY - minY) + SC_PAD + SC_TOP_PAD;

      return { w: Math.max(200, totalW), h: Math.max(100, totalH) };
    }

    // Identify root CommunityGroups that have active connected communities
    const activeRootScs: { sc: typeof communityGroups[number]; w: number; h: number }[] = [];

    // Orphan communities: connected but not in any CommunityGroup
    const orphanCommunityIds: string[] = [];

    // Determine which connected communities belong to root CommunityGroups
    const communityInAnySc = new Set<string>();
    for (const sc of data.communities?.communityGroups ?? []) {
      const cids = collectCommunityIdsFromCommunityGroup(sc);
      for (const cid of cids) communityInAnySc.add(cid);
    }

    for (const group of connectedGroups) {
      if (!communityInAnySc.has(group.id)) {
        orphanCommunityIds.push(group.id);
      }
    }

    // Layout each root CommunityGroup
    const connectedGroupSet = new Set(connectedGroups.map((g) => g.id));
    for (const sc of data.communities?.communityGroups ?? []) {
      const cids = collectCommunityIdsFromCommunityGroup(sc);
      const hasActive = cids.some((cid) => connectedGroupSet.has(cid));
      if (!hasActive) continue;
      const size = layoutCommunityGroup(sc, connectedGroupSet);
      activeRootScs.push({ sc, ...size });
    }

    // Now do the top-level layout: root CommunityGroups + orphan communities
    const topG = new dagre.graphlib.Graph();
    topG.setGraph({ rankdir: 'LR', nodesep: 140, ranksep: 200, ranker: 'longest-path' });
    topG.setDefaultEdgeLabel(() => ({}));

    for (const rsc of activeRootScs) {
      topG.setNode(rsc.sc.id, { width: rsc.w, height: rsc.h });
    }
    for (const cid of orphanCommunityIds) {
      const scaled = locScaledSize(cid);
      topG.setNode(cid, { width: scaled.w, height: scaled.h });
    }

    // Map all communities to their top-level node (root sc or self if orphan)
    const communityToTopNode = new Map<string, string>();
    for (const cid of orphanCommunityIds) {
      communityToTopNode.set(cid, cid);
    }
    for (const rsc of activeRootScs) {
      const cids = collectCommunityIdsFromCommunityGroup(rsc.sc);
      for (const cid of cids) communityToTopNode.set(cid, rsc.sc.id);
    }

    // Add top-level edges
    const topAddedEdges = new Set<string>();
    for (const ce of groupEdgeMap.values()) {
      const srcTop = communityToTopNode.get(ce.sourceClusterId);
      const tgtTop = communityToTopNode.get(ce.targetClusterId);
      if (!srcTop || !tgtTop || srcTop === tgtTop) continue;
      const eKey = srcTop < tgtTop ? `${srcTop}→${tgtTop}` : `${tgtTop}→${srcTop}`;
      if (topAddedEdges.has(eKey)) continue;
      topAddedEdges.add(eKey);
      topG.setEdge(srcTop, tgtTop, { weight: ce.totalWeight });
    }

    const topNodeCount = activeRootScs.length + orphanCommunityIds.length;
    if (topNodeCount > 0) {
      dagre.layout(topG);
    }

    // Apply top-level positions and translate nested positions to global coordinates
    function translateCommunityGroupPositions(
      sc: typeof communityGroups[number],
      globalOffsetX: number,
      globalOffsetY: number,
    ) {
      // Translate direct community children
      for (const child of sc.children ?? []) {
        if (child.kind === 'community') {
          const pos = groupPositions.get(child.communityId);
          if (pos) {
            pos.x += globalOffsetX;
            pos.y += globalOffsetY;
          }
        } else {
          const childBounds = scBounds.get(child.cluster.id);
          if (childBounds) {
            // Recursively translate the child CommunityGroup
            translateCommunityGroupPositions(
              child.cluster,
              globalOffsetX + childBounds.x,
              globalOffsetY + childBounds.y,
            );
            // Update child sc bounds to global
            childBounds.x += globalOffsetX;
            childBounds.y += globalOffsetY;
          }
        }
      }
    }

    for (const rsc of activeRootScs) {
      const dn = topG.node(rsc.sc.id);
      if (!dn) continue;
      const topX = safeNumber(dn.x, 0) - rsc.w / 2;
      const topY = safeNumber(dn.y, 0) - rsc.h / 2;
      scBounds.set(rsc.sc.id, { x: topX, y: topY, w: rsc.w, h: rsc.h });
      translateCommunityGroupPositions(rsc.sc, topX, topY);
    }

    // Place orphan communities from top-level dagre
    for (const cid of orphanCommunityIds) {
      const dn = topG.node(cid);
      if (!dn) continue;
      const scaled = locScaledSize(cid);
      groupPositions.set(cid, {
        x: safeNumber(dn.x, 0) - scaled.w / 2,
        y: safeNumber(dn.y, 0) - scaled.h / 2,
        w: scaled.w,
        h: scaled.h,
      });
    }

    // Find the bounding box of the laid-out nodes to place disconnected nodes beside them
    let maxX = 0;
    let maxY = 0;
    for (const pos of groupPositions.values()) {
      maxX = Math.max(maxX, pos.x + pos.w);
      maxY = Math.max(maxY, pos.y + pos.h);
    }

    // Place disconnected groups in a grid to the right of connected ones
    const gridStartX = connectedGroups.length > 0 ? maxX + 120 : 0;
    const gridCols = Math.max(1, Math.ceil(Math.sqrt(disconnectedGroups.length)));
    const gridCellW = 420;
    const gridCellH = 180;

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

    // Final collision pass only for orphan communities and disconnected nodes
    // (CommunityGroup children are already spaced by their sub-dagre layout)
    const orphanAndDisconnectedPositions = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const cid of orphanCommunityIds) {
      const pos = groupPositions.get(cid);
      if (pos) orphanAndDisconnectedPositions.set(cid, pos);
    }
    for (const g of disconnectedGroups) {
      const pos = groupPositions.get(g.id);
      if (pos) orphanAndDisconnectedPositions.set(g.id, pos);
    }
    resolveGroupOverlaps(orphanAndDisconnectedPositions);

    // --- Generate nodes ---
    const resultNodes: Node[] = [];
    const contractHubEdges: Edge[] = [];

    // CommunityGroup bounding-box nodes (visual overlays for active scopes only).
    // Positions come from the hierarchical layout (scBounds map) rather than
    // post-hoc bounding-box computation, ensuring non-hierarchical CommunityGroups
    // never overlap.
    const shouldRenderCommunityGroups = !!options?.showCommunityGroups || !!options?.focusedCommunityGroupId;
    if (shouldRenderCommunityGroups) for (const sc of communityGroups) {
      if (!activeCommunityGroups.has(sc.id)) continue;
      const communityIds = collectCommunityIdsFromCommunityGroup(sc);
      if (communityIds.length < 2) continue;

      // Use pre-computed bounds from hierarchical layout, or fall back to
      // bounding-box of child positions for backwards compatibility
      const precomputed = scBounds.get(sc.id);
      let scX: number, scY: number, scW: number, scH: number;

      if (precomputed) {
        scX = safeNumber(precomputed.x, 0);
        scY = safeNumber(precomputed.y, 0);
        scW = Math.max(160, safeNumber(precomputed.w, 300));
        scH = Math.max(100, safeNumber(precomputed.h, 160));
      } else {
        // Fallback: compute from child positions
        let minXF = Infinity, minYF = Infinity, maxXF = -Infinity, maxYF = -Infinity;
        let hasMemberF = false;
        for (const cid of communityIds) {
          const pos = groupPositions.get(cid);
          if (!pos) continue;
          hasMemberF = true;
          minXF = Math.min(minXF, pos.x);
          minYF = Math.min(minYF, pos.y);
          maxXF = Math.max(maxXF, pos.x + pos.w);
          maxYF = Math.max(maxYF, pos.y + pos.h);
        }
        if (!hasMemberF) continue;
        scX = safeNumber(minXF - 30, 0);
        scY = safeNumber(minYF - 30, 0);
        scW = Math.max(160, safeNumber(maxXF - minXF + 60, 300));
        scH = Math.max(100, safeNumber(maxYF - minYF + 60, 160));
      }

      let totalFiles = 0;
      let contractCount = 0;
      let glueContractLoc = 0;
      let glueInfrastructureLoc = 0;
      let glueOtherLoc = 0;
      for (const cid of communityIds) {
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

      // Compute z-index based on nesting depth (deeper = higher z so parent renders behind)
      let depth = 0;
      let cur: string | undefined = sc.id;
      while (cur && scToParent.get(cur)) {
        depth++;
        cur = scToParent.get(cur);
      }

      const sharedContractOnlyIds = (sc.sharedContractFileIds ?? []).filter((fid) => {
        const role = fileClassMap.get(fid)?.contentRole;
        return role === 'contract';
      });

      resultNodes.push({
        id: sc.id,
        type: 'communityGroup',
        position: { x: scX, y: scY },
        width: scW,
        height: scH,
        zIndex: -(10 - depth),
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
        style: { zIndex: -(10 - depth) },
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

      // Orient edge in dominant "uses" direction
      const dominantForward = ce.forwardWeight >= ce.backwardWeight;
      const source = dominantForward ? ce.sourceClusterId : ce.targetClusterId;
      const target = dominantForward ? ce.targetClusterId : ce.sourceClusterId;
      const isBidirectional = ce.forwardWeight > 0 && ce.backwardWeight > 0;

      // Build label: edge count + resolved re-export indicator
      let label = ce.edgeCount > 1 ? ce.edgeCount.toString() : '';
      if (options?.showFullPath && ce.reexportCount > 0) {
        label = `${ce.edgeCount} (${ce.reexportCount} resolved)`;
      }

      const strokeColor = reexportRatio > 0.5 ? '#6b8e6b' : '#555';

      resultEdges.push({
        id: `${ce.sourceClusterId}->${ce.targetClusterId}`,
        source,
        target,
        style: {
          strokeWidth,
          stroke: strokeColor,
          opacity: 0.45,
          ...(typeOnlyRatio > 0.8 ? { strokeDasharray: '5 5' } : {}),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: strokeColor,
        },
        ...(isBidirectional ? {
          markerStart: {
            type: MarkerType.ArrowClosed,
            width: 10,
            height: 10,
            color: strokeColor,
          },
        } : {}),
        animated: false,
        ...(label ? { label } : {}),
        labelStyle: { fill: '#aaa', fontSize: 10 },
        labelBgStyle: { fill: '#1e1e1e', fillOpacity: 0.8 },
      });
    }

    resultEdges.push(...contractHubEdges);

    return { nodes: resultNodes, edges: resultEdges };
  }, [data, selection, options?.hideTypeOnly, options?.showFullPath, options?.focusedCommunityGroupId, options?.showCommunityGroups]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setLocalNodes((prev) => applyNodeChanges(changes, prev.length ? prev : nodes)),
    [nodes],
  );

  return { nodes, edges, onNodesChange };
}
