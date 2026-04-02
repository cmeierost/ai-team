// @aspect/engine — Group coupling analysis
// Measures how groups of code files interact: through shared contracts
// (type-only imports) vs direct implementation calls, and computes a
// separation potential score for each group.

import type { Entity, Relationship } from '@aspect/contracts';
import type { Grouping, Group } from './grouping.js';
import type { CodeRole, CodeRoleClassification } from './code-roles.js';

// ── Result types ────────────────────────────────────────────────────────

/** Coupling breakdown between two groups */
export interface GroupPairCoupling {
  sourceGroupId: string;
  targetGroupId: string;
  /** Total import edges from source → target */
  totalEdges: number;
  /** Edges that are type-only imports */
  typeOnlyEdges: number;
  /** Edges that are value/runtime imports */
  valueEdges: number;
  /** Edges where the target file is classified as 'contract' role */
  contractMediatedEdges: number;
  /** contractMediatedEdges / totalEdges (0-1) */
  contractRatio: number;
  /** Specific entity pairs for traceability */
  edges: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    typeOnly: boolean;
    targetRole: CodeRole;
  }>;
}

/** Per-group aggregate coupling metrics */
export interface GroupCouplingProfile {
  groupId: string;
  groupLabel: string;
  memberCount: number;
  /** Edges where both source and target are in this group */
  internalEdges: number;
  /** All edges from this group to other groups */
  outboundEdges: number;
  /** All edges from other groups to this group */
  inboundEdges: number;
  /** internalEdges / (internalEdges + outboundEdges + inboundEdges) — 0-1, higher = more cohesive */
  internalCohesion: number;
  /** Number of distinct groups this group depends on */
  outboundGroupCount: number;
  /** Number of distinct groups that depend on this group */
  inboundGroupCount: number;
  /** How many members are imported from outside (API surface) */
  apiSurfaceSize: number;
  /** apiSurfaceSize / memberCount (0-1) */
  apiSurfaceRatio: number;
  /** % of outbound edges that are type-only */
  outboundTypeOnlyRatio: number;
  /** % of inbound edges that are type-only */
  inboundTypeOnlyRatio: number;
  /** SEPARATION POTENTIAL: 0-1, higher = easier to extract as own package */
  separabilityIndex: number;
}

/** Pair of groups that are too tightly coupled to maintain separately */
export interface MergeCandidate {
  groupIdA: string;
  groupIdB: string;
  /** Total bidirectional edges between the two groups */
  bidirectionalEdges: number;
  /** Combined internal edges of both groups */
  combinedInternalEdges: number;
  /** Ratio: bidirectionalEdges / combinedInternalEdges (high = should merge) */
  couplingDensity: number;
  reason: string;
}

/** Full result of group coupling analysis */
export interface GroupCouplingResult {
  /** Coupling between every pair of groups that has edges */
  pairCouplings: GroupPairCoupling[];
  /** Per-group aggregate metrics including separability */
  profiles: GroupCouplingProfile[];
  /** Groups that should be merged (couplingDensity > threshold) */
  mergeCandidates: MergeCandidate[];
  /** Coupling matrix: matrix[i][j] = total edges from groups[i] to groups[j] */
  matrix: {
    groupIds: string[];
    groupLabels: string[];
    total: number[][];
    typeOnly: number[][];
    value: number[][];
  };
}

/** Options for group coupling analysis */
export interface GroupCouplingOptions {
  /** Threshold for merge candidate detection (default: 0.5) */
  mergeCouplingThreshold?: number;
  /** Code role classifications (used for contract-mediated detection) */
  codeRoles?: CodeRoleClassification[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function buildEntityToGroupMap(groups: Group[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const entityId of group.memberEntityIds) {
      map.set(entityId, group.id);
    }
  }
  return map;
}

function buildCodeRoleMap(
  codeRoles: CodeRoleClassification[] | undefined,
): Map<string, CodeRole> {
  const map = new Map<string, CodeRole>();
  if (codeRoles) {
    for (const cr of codeRoles) {
      map.set(cr.entityId, cr.role);
    }
  }
  return map;
}

function pairKey(a: string, b: string): string {
  return `${a}->${b}`;
}

function emptyResult(grouping: Grouping): GroupCouplingResult {
  const groupIds = grouping.groups.map((g) => g.id);
  const groupLabels = grouping.groups.map((g) => g.label);
  const n = groupIds.length;
  const zeros = () => Array.from({ length: n }, () => Array.from<number>({ length: n }).fill(0));
  return {
    pairCouplings: [],
    profiles: grouping.groups.map((g) => ({
      groupId: g.id,
      groupLabel: g.label,
      memberCount: g.memberEntityIds.length,
      internalEdges: 0,
      outboundEdges: 0,
      inboundEdges: 0,
      internalCohesion: 0,
      outboundGroupCount: 0,
      inboundGroupCount: 0,
      apiSurfaceSize: 0,
      apiSurfaceRatio: 0,
      outboundTypeOnlyRatio: 0,
      inboundTypeOnlyRatio: 0,
      separabilityIndex: 1,
    })),
    mergeCandidates: [],
    matrix: { groupIds, groupLabels, total: zeros(), typeOnly: zeros(), value: zeros() },
  };
}

// ── Main calculator ─────────────────────────────────────────────────────

/**
 * Analyse coupling between groups defined in a {@link Grouping}.
 *
 * For every pair of groups that share at least one import edge the function
 * reports a {@link GroupPairCoupling} breakdown (type-only vs value,
 * contract-mediated ratio).  Each group receives a {@link GroupCouplingProfile}
 * with cohesion, API-surface, and a **separability index** that estimates how
 * easy it would be to extract the group as its own package.
 */
export function calculateGroupCoupling(
  grouping: Grouping,
  entities: Entity[],
  relationships: Relationship[],
  options?: GroupCouplingOptions,
): GroupCouplingResult {
  const groups = grouping.groups;
  if (groups.length === 0) {
    return emptyResult(grouping);
  }

  const mergeCouplingThreshold = options?.mergeCouplingThreshold ?? 0.5;
  const entityToGroup = buildEntityToGroupMap(groups);
  const roleMap = buildCodeRoleMap(options?.codeRoles);

  // Accumulators per group
  const internalEdgesMap = new Map<string, number>();
  const outboundEdgesMap = new Map<string, number>();
  const inboundEdgesMap = new Map<string, number>();
  const outboundTypeOnlyMap = new Map<string, number>();
  const inboundTypeOnlyMap = new Map<string, number>();
  const outboundTargetGroups = new Map<string, Set<string>>();
  const inboundSourceGroups = new Map<string, Set<string>>();
  // Members with at least one inbound edge from outside
  const apiSurfaceMembers = new Map<string, Set<string>>();

  for (const g of groups) {
    internalEdgesMap.set(g.id, 0);
    outboundEdgesMap.set(g.id, 0);
    inboundEdgesMap.set(g.id, 0);
    outboundTypeOnlyMap.set(g.id, 0);
    inboundTypeOnlyMap.set(g.id, 0);
    outboundTargetGroups.set(g.id, new Set());
    inboundSourceGroups.set(g.id, new Set());
    apiSurfaceMembers.set(g.id, new Set());
  }

  // Pair coupling accumulators
  const pairMap = new Map<string, GroupPairCoupling>();

  // Inbound contract-mediated counts per group (for separability)
  const inboundContractOrTypeOnly = new Map<string, number>();
  for (const g of groups) {
    inboundContractOrTypeOnly.set(g.id, 0);
  }

  // 1. Classify every relationship
  for (const rel of relationships) {
    const srcGroup = entityToGroup.get(rel.sourceEntityId);
    const tgtGroup = entityToGroup.get(rel.targetEntityId);
    if (srcGroup === undefined || tgtGroup === undefined) continue;

    if (srcGroup === tgtGroup) {
      // Internal edge
      internalEdgesMap.set(srcGroup, (internalEdgesMap.get(srcGroup) ?? 0) + 1);
      continue;
    }

    // Cross-group edge
    const isTypeOnly = rel.typeOnly === true;
    const targetRole: CodeRole = roleMap.get(rel.targetEntityId) ?? 'unknown';
    const isContractMediated = targetRole === 'contract';

    // Update pair coupling
    const key = pairKey(srcGroup, tgtGroup);
    let pair = pairMap.get(key);
    if (!pair) {
      pair = {
        sourceGroupId: srcGroup,
        targetGroupId: tgtGroup,
        totalEdges: 0,
        typeOnlyEdges: 0,
        valueEdges: 0,
        contractMediatedEdges: 0,
        contractRatio: 0,
        edges: [],
      };
      pairMap.set(key, pair);
    }
    pair.totalEdges++;
    if (isTypeOnly) pair.typeOnlyEdges++;
    else pair.valueEdges++;
    if (isContractMediated) pair.contractMediatedEdges++;
    pair.edges.push({
      sourceEntityId: rel.sourceEntityId,
      targetEntityId: rel.targetEntityId,
      typeOnly: isTypeOnly,
      targetRole,
    });

    // Update group-level accumulators
    outboundEdgesMap.set(srcGroup, (outboundEdgesMap.get(srcGroup) ?? 0) + 1);
    inboundEdgesMap.set(tgtGroup, (inboundEdgesMap.get(tgtGroup) ?? 0) + 1);

    if (isTypeOnly) {
      outboundTypeOnlyMap.set(srcGroup, (outboundTypeOnlyMap.get(srcGroup) ?? 0) + 1);
      inboundTypeOnlyMap.set(tgtGroup, (inboundTypeOnlyMap.get(tgtGroup) ?? 0) + 1);
    }

    outboundTargetGroups.get(srcGroup)!.add(tgtGroup);
    inboundSourceGroups.get(tgtGroup)!.add(srcGroup);
    apiSurfaceMembers.get(tgtGroup)!.add(rel.targetEntityId);

    if (isTypeOnly || isContractMediated) {
      inboundContractOrTypeOnly.set(
        tgtGroup,
        (inboundContractOrTypeOnly.get(tgtGroup) ?? 0) + 1,
      );
    }
  }

  // 2. Finalize pair coupling ratios
  const pairCouplings = [...pairMap.values()];
  for (const pair of pairCouplings) {
    pair.contractRatio =
      pair.totalEdges > 0 ? pair.contractMediatedEdges / pair.totalEdges : 0;
  }
  pairCouplings.sort(
    (a, b) => b.totalEdges - a.totalEdges || a.sourceGroupId.localeCompare(b.sourceGroupId),
  );

  // 3. Build group profiles with separability index
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const profiles: GroupCouplingProfile[] = groups.map((g) => {
    const memberCount = g.memberEntityIds.length;
    const internal = internalEdgesMap.get(g.id) ?? 0;
    const outbound = outboundEdgesMap.get(g.id) ?? 0;
    const inbound = inboundEdgesMap.get(g.id) ?? 0;
    const total = internal + outbound + inbound;
    const internalCohesion = total > 0 ? internal / total : 0;

    const outGroupCount = outboundTargetGroups.get(g.id)?.size ?? 0;
    const inGroupCount = inboundSourceGroups.get(g.id)?.size ?? 0;

    const apiSize = apiSurfaceMembers.get(g.id)?.size ?? 0;
    const apiRatio = memberCount > 0 ? apiSize / memberCount : 0;

    const outTypeOnly = outboundTypeOnlyMap.get(g.id) ?? 0;
    const inTypeOnly = inboundTypeOnlyMap.get(g.id) ?? 0;
    const outboundTypeOnlyRatio = outbound > 0 ? outTypeOnly / outbound : 0;
    const inboundTypeOnlyRatio = inbound > 0 ? inTypeOnly / inbound : 0;

    // Separability index
    const outboundDensity = Math.min(
      1,
      outbound / Math.max(1, memberCount * outGroupCount),
    );
    const inboundContract = inboundContractOrTypeOnly.get(g.id) ?? 0;
    const inboundContractRatio = inbound > 0 ? inboundContract / inbound : 0;

    const separabilityIndex =
      0.4 * internalCohesion +
      0.3 * (1 - outboundDensity) +
      0.3 * inboundContractRatio;

    return {
      groupId: g.id,
      groupLabel: g.label,
      memberCount,
      internalEdges: internal,
      outboundEdges: outbound,
      inboundEdges: inbound,
      internalCohesion,
      outboundGroupCount: outGroupCount,
      inboundGroupCount: inGroupCount,
      apiSurfaceSize: apiSize,
      apiSurfaceRatio: apiRatio,
      outboundTypeOnlyRatio,
      inboundTypeOnlyRatio,
      separabilityIndex,
    };
  });

  // 4. Detect merge candidates
  const mergeCandidates: MergeCandidate[] = [];
  const seenPairs = new Set<string>();

  for (const pair of pairCouplings) {
    const canonKey =
      pair.sourceGroupId < pair.targetGroupId
        ? `${pair.sourceGroupId}|${pair.targetGroupId}`
        : `${pair.targetGroupId}|${pair.sourceGroupId}`;
    if (seenPairs.has(canonKey)) continue;
    seenPairs.add(canonKey);

    const reverseKey = pairKey(pair.targetGroupId, pair.sourceGroupId);
    const reverse = pairMap.get(reverseKey);
    const bidirectional = pair.totalEdges + (reverse?.totalEdges ?? 0);
    const internalA = internalEdgesMap.get(pair.sourceGroupId) ?? 0;
    const internalB = internalEdgesMap.get(pair.targetGroupId) ?? 0;
    const combinedInternal = internalA + internalB;
    const density = bidirectional / Math.max(1, combinedInternal);

    if (density > mergeCouplingThreshold) {
      mergeCandidates.push({
        groupIdA: pair.sourceGroupId < pair.targetGroupId ? pair.sourceGroupId : pair.targetGroupId,
        groupIdB: pair.sourceGroupId < pair.targetGroupId ? pair.targetGroupId : pair.sourceGroupId,
        bidirectionalEdges: bidirectional,
        combinedInternalEdges: combinedInternal,
        couplingDensity: density,
        reason:
          `Bidirectional coupling (${bidirectional} edges) exceeds ` +
          `${(mergeCouplingThreshold * 100).toFixed(0)}% of combined internal edges (${combinedInternal})`,
      });
    }
  }
  mergeCandidates.sort((a, b) => b.couplingDensity - a.couplingDensity);

  // 5. Build coupling matrix
  const groupIds = groups.map((g) => g.id);
  const groupLabels = groups.map((g) => g.label);
  const idxMap = new Map(groupIds.map((id, i) => [id, i]));
  const n = groupIds.length;
  const totalMatrix: number[][] = Array.from({ length: n }, () => Array.from<number>({ length: n }).fill(0));
  const typeOnlyMatrix: number[][] = Array.from({ length: n }, () => Array.from<number>({ length: n }).fill(0));
  const valueMatrix: number[][] = Array.from({ length: n }, () => Array.from<number>({ length: n }).fill(0));

  for (const pair of pairCouplings) {
    const i = idxMap.get(pair.sourceGroupId);
    const j = idxMap.get(pair.targetGroupId);
    if (i != null && j != null) {
      totalMatrix[i][j] = pair.totalEdges;
      typeOnlyMatrix[i][j] = pair.typeOnlyEdges;
      valueMatrix[i][j] = pair.valueEdges;
    }
  }

  return {
    pairCouplings,
    profiles,
    mergeCandidates,
    matrix: {
      groupIds,
      groupLabels,
      total: totalMatrix,
      typeOnly: typeOnlyMatrix,
      value: valueMatrix,
    },
  };
}
