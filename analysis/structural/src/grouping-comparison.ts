/**
 * @aspect/engine — Grouping comparison (ARI / NMI)
 *
 * Builds three independent views of how files are grouped:
 *   - Reference: from Louvain communities (actual dependency structure)
 *   - Directory: from filesystem layout
 *   - Boundary: from declared package boundaries
 *
 * Then compares pairs with Adjusted Rand Index and Normalized Mutual
 * Information — statistically grounded measures that correct for chance.
 */

import type {
  FileClassificationEntry, Community,
  PipelineGrouping, PipelineGroup,
  PipelineGroupingComparison, PipelineGroupMismatch, PipelineMoveSuggestion,
} from './types.js';
import { parentDir } from './types.js';

// ── Build groupings ─────────────────────────────────────────────────────

export function buildCommunityGrouping(communities: Community[]): PipelineGrouping {
  return {
    id: 'reference',
    label: 'Reference (communities)',
    groups: communities.map((c) => ({
      id: c.id,
      label: c.id,
      memberFileIds: c.memberFileIds,
    })),
  };
}

export function buildDirectoryGrouping(files: FileClassificationEntry[]): PipelineGrouping {
  const dirMap = new Map<string, string[]>();
  for (const f of files) {
    if (f.category !== 'code') continue;
    const dir = parentDir(f.filePath);
    const list = dirMap.get(dir) ?? [];
    list.push(f.fileId);
    dirMap.set(dir, list);
  }

  const groups: PipelineGroup[] = [...dirMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, ids]) => ({ id: `dir:${dir}`, label: dir, memberFileIds: ids }));

  return { id: 'directory', label: 'Directory', groups };
}

export function buildBoundaryGrouping(files: FileClassificationEntry[]): PipelineGrouping {
  const pkgMap = new Map<string, string[]>();
  for (const f of files) {
    if (f.category !== 'code' || !f.packageId) continue;
    const list = pkgMap.get(f.packageId) ?? [];
    list.push(f.fileId);
    pkgMap.set(f.packageId, list);
  }

  const groups: PipelineGroup[] = [...pkgMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, ids]) => ({ id: `pkg:${pkg}`, label: pkg, memberFileIds: ids }));

  return { id: 'boundary', label: 'Boundary (packages)', groups };
}

// ── ARI / NMI ───────────────────────────────────────────────────────────

function choose2(n: number): number {
  return (n * (n - 1)) / 2;
}

export function computeARI(labelsA: number[], labelsB: number[]): number {
  const n = labelsA.length;
  if (n === 0) return 1.0;

  const aGroups = new Map<number, number[]>();
  const bGroups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    (aGroups.get(labelsA[i]) ?? (aGroups.set(labelsA[i], []), aGroups.get(labelsA[i])!)).push(i);
    (bGroups.get(labelsB[i]) ?? (bGroups.set(labelsB[i], []), bGroups.get(labelsB[i])!)).push(i);
  }

  // Contingency table n_ij → sum of C(n_ij, 2)
  let index = 0;
  for (const [, aIndices] of aGroups) {
    const aSet = new Set(aIndices);
    for (const [, bIndices] of bGroups) {
      let count = 0;
      for (const idx of bIndices) {
        if (aSet.has(idx)) count++;
      }
      index += choose2(count);
    }
  }

  let sumA = 0;
  for (const indices of aGroups.values()) sumA += choose2(indices.length);
  let sumB = 0;
  for (const indices of bGroups.values()) sumB += choose2(indices.length);

  const totalPairs = choose2(n);
  if (totalPairs === 0) return 1.0;

  const expected = (sumA * sumB) / totalPairs;
  const maxIndex = 0.5 * (sumA + sumB);
  if (maxIndex === expected) return 1.0;

  return (index - expected) / (maxIndex - expected);
}

export function computeNMI(labelsA: number[], labelsB: number[]): number {
  const n = labelsA.length;
  if (n === 0) return 1.0;

  const aCounts = new Map<number, number>();
  const bCounts = new Map<number, number>();
  const joint = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    aCounts.set(labelsA[i], (aCounts.get(labelsA[i]) ?? 0) + 1);
    bCounts.set(labelsB[i], (bCounts.get(labelsB[i]) ?? 0) + 1);
    const key = `${labelsA[i]}:${labelsB[i]}`;
    joint.set(key, (joint.get(key) ?? 0) + 1);
  }

  let hA = 0;
  for (const c of aCounts.values()) { const p = c / n; if (p > 0) hA -= p * Math.log(p); }
  let hB = 0;
  for (const c of bCounts.values()) { const p = c / n; if (p > 0) hB -= p * Math.log(p); }

  if (hA === 0 && hB === 0) return 1.0;
  if (hA === 0 || hB === 0) return 0;

  let mi = 0;
  for (const [key, nij] of joint) {
    const [aStr, bStr] = key.split(':');
    const ai = aCounts.get(Number(aStr))!;
    const bj = bCounts.get(Number(bStr))!;
    mi += (nij / n) * Math.log((nij * n) / (ai * bj));
  }

  return (2 * mi) / (hA + hB);
}

// ── Compare two groupings ───────────────────────────────────────────────

export function compareGroupings(
  source: PipelineGrouping,
  target: PipelineGrouping,
  filePathMap: Map<string, string>,
): PipelineGroupingComparison {
  // Build file → group maps
  const srcFileGroup = new Map<string, string>();
  const srcGroupSets = new Map<string, Set<string>>();
  for (const g of source.groups) {
    srcGroupSets.set(g.id, new Set(g.memberFileIds));
    for (const fid of g.memberFileIds) srcFileGroup.set(fid, g.id);
  }

  const tgtFileGroup = new Map<string, string>();
  for (const g of target.groups) {
    for (const fid of g.memberFileIds) tgtFileGroup.set(fid, g.id);
  }

  // Files in both groupings
  const common = [...srcFileGroup.keys()].filter((fid) => tgtFileGroup.has(fid));
  if (common.length === 0) {
    return { sourceId: source.id, targetId: target.id, ari: 1, nmi: 1, mismatches: [], suggestions: [] };
  }

  // Label arrays
  const srcIds = [...new Set(source.groups.map((g) => g.id))];
  const tgtIds = [...new Set(target.groups.map((g) => g.id))];
  const srcIdx = new Map(srcIds.map((id, i) => [id, i]));
  const tgtIdx = new Map(tgtIds.map((id, i) => [id, i]));

  const labelsA: number[] = [];
  const labelsB: number[] = [];
  for (const fid of common) {
    labelsA.push(srcIdx.get(srcFileGroup.get(fid)!)!);
    labelsB.push(tgtIdx.get(tgtFileGroup.get(fid)!)!);
  }

  const ari = Math.max(0, Math.min(1, computeARI(labelsA, labelsB)));
  const nmi = Math.max(0, Math.min(1, computeNMI(labelsA, labelsB)));

  // Best source→target group match (by Jaccard)
  const bestMatch = new Map<string, string>();
  for (const sg of source.groups) {
    const sSet = srcGroupSets.get(sg.id)!;
    let bestJ = -1;
    let bestTgt = '';
    for (const tg of target.groups) {
      const tSet = new Set(tg.memberFileIds);
      let inter = 0;
      for (const fid of sSet) { if (tSet.has(fid)) inter++; }
      const union = sSet.size + tSet.size - inter;
      const j = union > 0 ? inter / union : 0;
      if (j > bestJ) { bestJ = j; bestTgt = tg.id; }
    }
    if (bestTgt) bestMatch.set(sg.id, bestTgt);
  }

  // Mismatches + suggestions
  const mismatches: PipelineGroupMismatch[] = [];
  const suggestions: PipelineMoveSuggestion[] = [];
  for (const fid of common) {
    const sGroup = srcFileGroup.get(fid)!;
    const tGroup = tgtFileGroup.get(fid)!;
    const expected = bestMatch.get(sGroup);
    if (expected && expected !== tGroup) {
      const fp = filePathMap.get(fid) ?? fid;
      mismatches.push({ fileId: fid, filePath: fp, sourceGroupId: sGroup, targetGroupId: tGroup });
      suggestions.push({
        fileId: fid, filePath: fp,
        fromGroup: tGroup, toGroup: expected,
        reason: `Dependency community '${sGroup}' best maps to '${expected}', but file is in '${tGroup}'`,
      });
    }
  }

  return { sourceId: source.id, targetId: target.id, ari, nmi, mismatches, suggestions };
}

// ── Convenience: run all three comparisons ──────────────────────────────

export function compareAllGroupings(
  communities: Community[],
  files: FileClassificationEntry[],
): PipelineGroupingComparison[] {
  const ref = buildCommunityGrouping(communities);
  const dir = buildDirectoryGrouping(files);
  const bnd = buildBoundaryGrouping(files);

  const pathMap = new Map(files.map((f) => [f.fileId, f.filePath]));
  const comparisons: PipelineGroupingComparison[] = [];

  if (ref.groups.length > 0 && dir.groups.length > 0) {
    comparisons.push(compareGroupings(ref, dir, pathMap));
  }
  if (ref.groups.length > 0 && bnd.groups.length > 0) {
    comparisons.push(compareGroupings(ref, bnd, pathMap));
  }
  if (dir.groups.length > 0 && bnd.groups.length > 0) {
    comparisons.push(compareGroupings(dir, bnd, pathMap));
  }

  return comparisons;
}
