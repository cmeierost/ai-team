/**
 * @aspect/engine — Grouping abstraction and comparison system
 *
 * Lets users define different ways to group files (by dependency clusters,
 * by folders, by packages, or custom file lists) and compare them to find
 * architectural mismatches.
 */

import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';
import { buildDependencyGraph, detectCommunities } from './graph-metrics.js';

// ── Types ───────────────────────────────────────────────────────────────

export type GroupingKind = 'reference' | 'directory' | 'package' | 'facade' | 'namespace' | 'custom';

/** A single named group within a grouping */
export interface Group {
  id: string;
  label: string;
  memberEntityIds: string[];
}

/** A complete grouping — a named partition of entities into groups */
export interface Grouping {
  id: string;
  label: string;
  kind: GroupingKind;
  groups: Group[];
}

/** Result of comparing two groupings */
export interface GroupingComparison {
  sourceGroupingId: string;
  targetGroupingId: string;
  /** Overall similarity score (0-1, Adjusted Rand Index) */
  similarityScore: number;
  /** Normalized Mutual Information between the two groupings */
  nmi: number;
  groupOverlaps: GroupOverlap[];
  mismatches: GroupingMismatch[];
  suggestions: MoveSuggestion[];
}

export interface GroupOverlap {
  sourceGroupId: string;
  targetGroupId: string;
  /** Jaccard index between the two groups (intersection / union) */
  jaccard: number;
  sharedCount: number;
  onlyInSource: string[];
  onlyInTarget: string[];
}

export interface GroupingMismatch {
  entityId: string;
  filePath: string;
  sourceGroupId: string;
  targetGroupId: string;
}

export interface MoveSuggestion {
  entityId: string;
  filePath: string;
  fromGroup: string;
  toGroup: string;
  reason: string;
  /** How much this move would improve the similarity score (estimated) */
  impactEstimate: number;
}

/** Result of matching a file list against a grouping */
export interface FileListMatch {
  files: string[];
  bestMatchGroupId: string;
  bestMatchGroupLabel: string;
  bestMatchJaccard: number;
  coverage: number;
  purity: number;
  outliers: string[];
  missing: string[];
  allGroupMatches: Array<{
    groupId: string;
    groupLabel: string;
    jaccard: number;
    sharedCount: number;
  }>;
}

// ── Path helpers ────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function getDirectory(filePath: string, depth: number): string {
  const parts = normalizePath(filePath).split('/');
  const dirParts = parts.slice(0, -1);
  const truncated = dirParts.slice(0, depth);
  return truncated.join('/') || '.';
}

function maxPathDepth(filePaths: string[]): number {
  let max = 0;
  for (const fp of filePaths) {
    const depth = normalizePath(fp).split('/').length - 1;
    if (depth > max) max = depth;
  }
  return max;
}

function autoDetectDepth(filePaths: string[]): number {
  const maxDepth = maxPathDepth(filePaths);
  for (let d = 1; d <= maxDepth; d++) {
    const groups = new Set(filePaths.map((fp) => getDirectory(fp, d)));
    if (groups.size >= 3 && groups.size <= 30) return d;
  }
  if (maxDepth === 0) return 1;
  let bestDepth = 1;
  let bestCount = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const count = new Set(filePaths.map((fp) => getDirectory(fp, d))).size;
    if (count > bestCount) {
      bestCount = count;
      bestDepth = d;
    }
  }
  return bestDepth;
}

function isValidFileEntity(e: Entity): boolean {
  if (e.kind !== 'file' || e.filePath == null) return false;
  const np = normalizePath(e.filePath);
  return np.includes('/') && !np.startsWith('../') && !np.includes('node_modules/');
}

// ── Set helpers ─────────────────────────────────────────────────────────

function setIntersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const v of a) {
    if (b.has(v)) result.add(v);
  }
  return result;
}

function setUnion<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>(a);
  for (const v of b) result.add(v);
  return result;
}

function setDifference<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const v of a) {
    if (!b.has(v)) result.add(v);
  }
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = setIntersection(a, b).size;
  const union = setUnion(a, b).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Build groupings ─────────────────────────────────────────────────────

/** Build a reference grouping from dependency graph communities */
export function buildReferenceGrouping(
  entities: Entity[],
  relationships: Relationship[],
): Grouping {
  const fileEntities = entities.filter(isValidFileEntity);

  if (fileEntities.length === 0) {
    return { id: 'reference', label: 'Reference (communities)', kind: 'reference', groups: [] };
  }

  const graph = buildDependencyGraph(entities, relationships);
  const communityResult = detectCommunities(graph);

  const fileEntityIds = new Set(fileEntities.map((e) => e.id));

  const groups: Group[] = communityResult.communities.map((c) => ({
    id: c.id,
    label: c.id,
    memberEntityIds: c.entityIds.filter((id) => fileEntityIds.has(id)),
  })).filter((g) => g.memberEntityIds.length > 0);

  return {
    id: 'reference',
    label: 'Reference (communities)',
    kind: 'reference',
    groups,
  };
}

/** Build a directory grouping from file paths at a given depth */
export function buildDirectoryGrouping(
  entities: Entity[],
  depth?: number,
): Grouping {
  const fileEntities = entities.filter(isValidFileEntity);

  if (fileEntities.length === 0) {
    return { id: 'directory', label: 'Directory', kind: 'directory', groups: [] };
  }

  const filePaths = fileEntities.map((e) => normalizePath(e.filePath));
  const resolvedDepth = depth ?? autoDetectDepth(filePaths);

  const dirToEntityIds = new Map<string, string[]>();
  for (const e of fileEntities) {
    const dir = getDirectory(e.filePath, resolvedDepth);
    const list = dirToEntityIds.get(dir) ?? [];
    list.push(e.id);
    dirToEntityIds.set(dir, list);
  }

  const groups: Group[] = [...dirToEntityIds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, ids]) => ({
      id: `dir:${dir}`,
      label: dir,
      memberEntityIds: ids,
    }));

  return {
    id: 'directory',
    label: 'Directory',
    kind: 'directory',
    groups,
  };
}

/** Build a grouping from module boundaries (from the collector) */
export function buildBoundaryGrouping(
  entities: Entity[],
  moduleBoundaries: ModuleBoundary[],
): Grouping {
  if (moduleBoundaries.length === 0) {
    return { id: 'boundary', label: 'Boundary', kind: 'custom', groups: [] };
  }

  // Derive kind from boundaries
  const boundaryKinds = new Set(moduleBoundaries.map((mb) => mb.kind));
  let kind: GroupingKind;
  if (boundaryKinds.size === 1) {
    const bk = [...boundaryKinds][0];
    if (bk === 'package' || bk === 'directory' || bk === 'facade' || bk === 'namespace') {
      kind = bk;
    } else {
      kind = 'custom';
    }
  } else {
    kind = 'custom';
  }

  // Match entities to boundaries by longest prefix match
  const groups: Group[] = moduleBoundaries.map((mb) => {
    const memberIds: string[] = [];
    for (const entity of entities) {
      if (entity.filePath && normalizePath(entity.filePath).startsWith(normalizePath(mb.modulePath))) {
        // Check that no other boundary has a longer prefix match
        let isBest = true;
        for (const other of moduleBoundaries) {
          if (
            other !== mb &&
            normalizePath(entity.filePath).startsWith(normalizePath(other.modulePath)) &&
            other.modulePath.length > mb.modulePath.length
          ) {
            isBest = false;
            break;
          }
        }
        if (isBest) {
          memberIds.push(entity.id);
        }
      }
    }
    return {
      id: mb.moduleId,
      label: mb.moduleId,
      memberEntityIds: memberIds,
    };
  });

  return {
    id: 'boundary',
    label: 'Boundary',
    kind,
    groups,
  };
}

/** Build a custom grouping from explicit file lists */
export function buildCustomGrouping(
  id: string,
  label: string,
  groups: Array<{ id: string; label: string; files: string[] }>,
  entities: Entity[],
): Grouping {
  // Build lookup: normalized filePath → entity ID
  const pathToEntityId = new Map<string, string>();
  for (const e of entities) {
    if (e.filePath) {
      pathToEntityId.set(normalizePath(e.filePath), e.id);
    }
  }

  const resolvedGroups: Group[] = groups.map((g) => {
    const memberIds: string[] = [];
    for (const file of g.files) {
      const normalized = normalizePath(file);
      const entityId = pathToEntityId.get(normalized);
      if (entityId) {
        memberIds.push(entityId);
      }
    }
    return {
      id: g.id,
      label: g.label,
      memberEntityIds: memberIds,
    };
  });

  return { id, label, kind: 'custom', groups: resolvedGroups };
}

// ── Compare groupings ───────────────────────────────────────────────────

function choose2(n: number): number {
  return n * (n - 1) / 2;
}

/**
 * Compute the Adjusted Rand Index between two label assignments.
 * Returns 1.0 for identical groupings, ~0 for random, can be negative.
 */
function computeARI(labelsA: number[], labelsB: number[]): number {
  const n = labelsA.length;
  if (n === 0) return 1.0;

  // Build contingency table
  const aGroups = new Map<number, number[]>();
  const bGroups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const aList = aGroups.get(labelsA[i]) ?? [];
    aList.push(i);
    aGroups.set(labelsA[i], aList);

    const bList = bGroups.get(labelsB[i]) ?? [];
    bList.push(i);
    bGroups.set(labelsB[i], bList);
  }

  // Contingency table n_ij
  const contingency = new Map<string, number>();
  for (const [aLabel, aIndices] of aGroups) {
    const aSet = new Set(aIndices);
    for (const [bLabel, bIndices] of bGroups) {
      let count = 0;
      for (const idx of bIndices) {
        if (aSet.has(idx)) count++;
      }
      if (count > 0) {
        contingency.set(`${aLabel}:${bLabel}`, count);
      }
    }
  }

  // Sum of C(n_ij, 2)
  let index = 0;
  for (const nij of contingency.values()) {
    index += choose2(nij);
  }

  // Row sums → C(a_i, 2)
  let sumA = 0;
  for (const indices of aGroups.values()) {
    sumA += choose2(indices.length);
  }

  // Column sums → C(b_j, 2)
  let sumB = 0;
  for (const indices of bGroups.values()) {
    sumB += choose2(indices.length);
  }

  const totalPairs = choose2(n);
  if (totalPairs === 0) return 1.0;

  const expectedIndex = (sumA * sumB) / totalPairs;
  const maxIndex = 0.5 * (sumA + sumB);

  if (maxIndex === expectedIndex) return 1.0;

  return (index - expectedIndex) / (maxIndex - expectedIndex);
}

/**
 * Compute Normalized Mutual Information between two label assignments.
 */
function computeNMI(labelsA: number[], labelsB: number[]): number {
  const n = labelsA.length;
  if (n === 0) return 1.0;

  // Build count maps
  const aCounts = new Map<number, number>();
  const bCounts = new Map<number, number>();
  const jointCounts = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    aCounts.set(labelsA[i], (aCounts.get(labelsA[i]) ?? 0) + 1);
    bCounts.set(labelsB[i], (bCounts.get(labelsB[i]) ?? 0) + 1);
    const key = `${labelsA[i]}:${labelsB[i]}`;
    jointCounts.set(key, (jointCounts.get(key) ?? 0) + 1);
  }

  // Entropy H(A)
  let hA = 0;
  for (const count of aCounts.values()) {
    const p = count / n;
    if (p > 0) hA -= p * Math.log(p);
  }

  // Entropy H(B)
  let hB = 0;
  for (const count of bCounts.values()) {
    const p = count / n;
    if (p > 0) hB -= p * Math.log(p);
  }

  if (hA === 0 && hB === 0) return 1.0;
  if (hA === 0 || hB === 0) return 0;

  // Mutual Information
  let mi = 0;
  for (const [key, nij] of jointCounts) {
    const [aStr, bStr] = key.split(':');
    const ai = aCounts.get(Number(aStr))!;
    const bj = bCounts.get(Number(bStr))!;
    const pij = nij / n;
    mi += pij * Math.log((nij * n) / (ai * bj));
  }

  return (2 * mi) / (hA + hB);
}

/** Compare two groupings and find mismatches */
export function compareGroupings(
  source: Grouping,
  target: Grouping,
  entities: Entity[],
): GroupingComparison {
  // Build entity → group maps for both groupings
  const sourceEntityToGroup = new Map<string, string>();
  const sourceGroupSets = new Map<string, Set<string>>();
  for (const g of source.groups) {
    sourceGroupSets.set(g.id, new Set(g.memberEntityIds));
    for (const eid of g.memberEntityIds) {
      sourceEntityToGroup.set(eid, g.id);
    }
  }

  const targetEntityToGroup = new Map<string, string>();
  const targetGroupSets = new Map<string, Set<string>>();
  for (const g of target.groups) {
    targetGroupSets.set(g.id, new Set(g.memberEntityIds));
    for (const eid of g.memberEntityIds) {
      targetEntityToGroup.set(eid, g.id);
    }
  }

  // Entities that appear in both groupings
  const commonEntities = [...sourceEntityToGroup.keys()].filter((eid) =>
    targetEntityToGroup.has(eid),
  );

  // Handle empty case
  if (commonEntities.length === 0) {
    return {
      sourceGroupingId: source.id,
      targetGroupingId: target.id,
      similarityScore: 1.0,
      nmi: 1.0,
      groupOverlaps: [],
      mismatches: [],
      suggestions: [],
    };
  }

  // Build label arrays for ARI/NMI
  const sourceGroupIds = [...new Set(source.groups.map((g) => g.id))];
  const targetGroupIds = [...new Set(target.groups.map((g) => g.id))];
  const sourceGroupIndex = new Map(sourceGroupIds.map((id, i) => [id, i]));
  const targetGroupIndex = new Map(targetGroupIds.map((id, i) => [id, i]));

  const labelsA: number[] = [];
  const labelsB: number[] = [];
  for (const eid of commonEntities) {
    labelsA.push(sourceGroupIndex.get(sourceEntityToGroup.get(eid)!)!);
    labelsB.push(targetGroupIndex.get(targetEntityToGroup.get(eid)!)!);
  }

  const ari = computeARI(labelsA, labelsB);
  const nmi = computeNMI(labelsA, labelsB);

  // Clamp ARI to [0,1] for the similarity score
  const similarityScore = Math.max(0, Math.min(1, ari));

  // Compute group overlaps (source × target)
  const groupOverlaps: GroupOverlap[] = [];
  for (const sg of source.groups) {
    const sSet = sourceGroupSets.get(sg.id)!;
    for (const tg of target.groups) {
      const tSet = targetGroupSets.get(tg.id)!;
      const shared = setIntersection(sSet, tSet);
      if (shared.size > 0) {
        groupOverlaps.push({
          sourceGroupId: sg.id,
          targetGroupId: tg.id,
          jaccard: jaccard(sSet, tSet),
          sharedCount: shared.size,
          onlyInSource: [...setDifference(sSet, tSet)],
          onlyInTarget: [...setDifference(tSet, sSet)],
        });
      }
    }
  }

  // Best match for each source group (highest Jaccard)
  const sourceBestMatch = new Map<string, string>();
  for (const sg of source.groups) {
    const sSet = sourceGroupSets.get(sg.id)!;
    let bestJaccard = -1;
    let bestTargetId = '';
    for (const tg of target.groups) {
      const tSet = targetGroupSets.get(tg.id)!;
      const j = jaccard(sSet, tSet);
      if (j > bestJaccard) {
        bestJaccard = j;
        bestTargetId = tg.id;
      }
    }
    if (bestTargetId) {
      sourceBestMatch.set(sg.id, bestTargetId);
    }
  }

  // Entity lookup for filePath
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // Find mismatches: entity in source group X and target group Y where X's best match ≠ Y
  const mismatches: GroupingMismatch[] = [];
  for (const eid of commonEntities) {
    const sGroup = sourceEntityToGroup.get(eid)!;
    const tGroup = targetEntityToGroup.get(eid)!;
    const bestMatchForSource = sourceBestMatch.get(sGroup);
    if (bestMatchForSource && bestMatchForSource !== tGroup) {
      const entity = entityMap.get(eid);
      mismatches.push({
        entityId: eid,
        filePath: entity?.filePath ?? eid,
        sourceGroupId: sGroup,
        targetGroupId: tGroup,
      });
    }
  }

  // Generate suggestions
  const suggestions: MoveSuggestion[] = mismatches.map((m) => {
    const bestTarget = sourceBestMatch.get(m.sourceGroupId) ?? m.targetGroupId;
    return {
      entityId: m.entityId,
      filePath: m.filePath,
      fromGroup: m.targetGroupId,
      toGroup: bestTarget,
      reason: `File is grouped with '${m.sourceGroupId}' in source but '${m.targetGroupId}' in target; best-matching target group is '${bestTarget}'`,
      impactEstimate: mismatches.length > 0 ? 1 / mismatches.length : 0,
    };
  });

  return {
    sourceGroupingId: source.id,
    targetGroupingId: target.id,
    similarityScore,
    nmi: Math.max(0, Math.min(1, nmi)),
    groupOverlaps,
    mismatches,
    suggestions,
  };
}

// ── Match file list ─────────────────────────────────────────────────────

/** Match a file list against a grouping to see how well it aligns */
export function matchFileList(
  files: string[],
  grouping: Grouping,
  entities: Entity[],
): FileListMatch {
  // Build normalized filePath → entityId lookup
  const pathToEntityId = new Map<string, string>();
  for (const e of entities) {
    if (e.filePath) {
      pathToEntityId.set(normalizePath(e.filePath), e.id);
    }
  }

  // Resolve file paths to entity IDs
  const fileEntityIds = new Set<string>();
  for (const f of files) {
    const eid = pathToEntityId.get(normalizePath(f));
    if (eid) fileEntityIds.add(eid);
  }

  // Compute per-group matches
  const allGroupMatches: Array<{
    groupId: string;
    groupLabel: string;
    jaccard: number;
    sharedCount: number;
  }> = grouping.groups.map((g) => {
    const groupSet = new Set(g.memberEntityIds);
    const shared = setIntersection(fileEntityIds, groupSet);
    return {
      groupId: g.id,
      groupLabel: g.label,
      jaccard: jaccard(fileEntityIds, groupSet),
      sharedCount: shared.size,
    };
  }).sort((a, b) => b.jaccard - a.jaccard);

  if (allGroupMatches.length === 0 || allGroupMatches[0].jaccard === 0) {
    return {
      files,
      bestMatchGroupId: '',
      bestMatchGroupLabel: '',
      bestMatchJaccard: 0,
      coverage: 0,
      purity: 0,
      outliers: files,
      missing: [],
      allGroupMatches,
    };
  }

  const best = allGroupMatches[0];
  const bestGroup = grouping.groups.find((g) => g.id === best.groupId)!;
  const bestGroupSet = new Set(bestGroup.memberEntityIds);

  const sharedSet = setIntersection(fileEntityIds, bestGroupSet);
  const coverage = fileEntityIds.size > 0 ? sharedSet.size / fileEntityIds.size : 0;
  const purity = bestGroupSet.size > 0 ? sharedSet.size / bestGroupSet.size : 0;

  // Resolve entity IDs back to file paths for outliers/missing
  const entityIdToPath = new Map<string, string>();
  for (const e of entities) {
    if (e.filePath) {
      entityIdToPath.set(e.id, e.filePath);
    }
  }

  const outlierIds = setDifference(fileEntityIds, bestGroupSet);
  const missingIds = setDifference(bestGroupSet, fileEntityIds);

  return {
    files,
    bestMatchGroupId: best.groupId,
    bestMatchGroupLabel: best.groupLabel,
    bestMatchJaccard: best.jaccard,
    coverage,
    purity,
    outliers: [...outlierIds].map((id) => entityIdToPath.get(id) ?? id),
    missing: [...missingIds].map((id) => entityIdToPath.get(id) ?? id),
    allGroupMatches,
  };
}
