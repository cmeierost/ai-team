/**
 * @aspect/engine — Step 5: Clustering
 *
 * Groups files into clusters based on weighted mutual coupling.
 *
 * Algorithm:
 *   1. Analyse coupling between all file pairs (bidirectional scoring)
 *   2. Merge overlapping concern pairs via union-find
 *   3. Also merge strong mutual-type-coupling pairs
 *   4. Compute internal vs external coupling per cluster
 *
 * Key insight: unidirectional fan-in (utils, contracts) is healthy —
 * only files that reference EACH OTHER frequently form a cluster.
 */

import type {
  WeightedEdge, FileInfo, FilePairCoupling,
  CouplingPattern, FileCluster, ClusterCohesionType,
} from './types.js';
import { round3 } from './types.js';
import { WEIGHTS } from './4-edge-weighting.js';

const {
  BIDIRECTIONAL_MULTIPLIER,
  CONCERN_THRESHOLD,
  TIGHT_THRESHOLD,
  BIDIRECTIONAL_THRESHOLD,
  MIN_EDGES,
} = WEIGHTS;

// ── Pair coupling analysis ──────────────────────────────────────────────

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Analyse coupling between all file pairs.
 *
 * Returns only pairs with at least one edge. Each pair includes
 * directionality, coupling score, and pattern classification.
 */
export function analysePairCoupling(
  weightedEdges: WeightedEdge[],
  fileInfoMap: Map<string, FileInfo>,
): FilePairCoupling[] {
  const pairMap = new Map<string, {
    fileA: string; fileB: string;
    edgesAtoB: number; edgesBtoA: number;
    typeOnlyAtoB: number; typeOnlyBtoA: number;
    weightAtoB: number; weightBtoA: number;
  }>();

  for (const edge of weightedEdges) {
    const key = pairKey(edge.sourceFileId, edge.targetFileId);
    let pair = pairMap.get(key);
    if (!pair) {
      const [a, b] = edge.sourceFileId < edge.targetFileId
        ? [edge.sourceFileId, edge.targetFileId]
        : [edge.targetFileId, edge.sourceFileId];
      pair = {
        fileA: a, fileB: b,
        edgesAtoB: 0, edgesBtoA: 0,
        typeOnlyAtoB: 0, typeOnlyBtoA: 0,
        weightAtoB: 0, weightBtoA: 0,
      };
      pairMap.set(key, pair);
    }

    const isAtoB = edge.sourceFileId === pair.fileA;
    if (isAtoB) {
      pair.edgesAtoB++;
      pair.weightAtoB += edge.weight;
      if (edge.isTypeOnly) pair.typeOnlyAtoB++;
    } else {
      pair.edgesBtoA++;
      pair.weightBtoA += edge.weight;
      if (edge.isTypeOnly) pair.typeOnlyBtoA++;
    }
  }

  const results: FilePairCoupling[] = [];
  for (const pair of pairMap.values()) {
    const totalEdges = pair.edgesAtoB + pair.edgesBtoA;
    const totalWeight = pair.weightAtoB + pair.weightBtoA;

    const minWeight = Math.min(pair.weightAtoB, pair.weightBtoA);
    const maxWeight = Math.max(pair.weightAtoB, pair.weightBtoA);
    const directionality = maxWeight > 0 ? round3(minWeight / maxWeight) : 0;

    const bidirectionalBonus = directionality >= BIDIRECTIONAL_THRESHOLD ? BIDIRECTIONAL_MULTIPLIER : 1.0;
    const couplingScore = round3(totalWeight * bidirectionalBonus);

    const pattern = classifyPattern(pair, directionality, totalEdges, couplingScore, fileInfoMap);
    const isConcern = (pattern === 'mutual-value-coupling' || pattern === 'tight-bidirectional')
      && couplingScore >= CONCERN_THRESHOLD;

    results.push({
      fileA: pair.fileA, fileB: pair.fileB,
      edgesAtoB: pair.edgesAtoB, edgesBtoA: pair.edgesBtoA,
      typeOnlyAtoB: pair.typeOnlyAtoB, typeOnlyBtoA: pair.typeOnlyBtoA,
      couplingScore, directionality, isConcern, pattern,
    });
  }

  results.sort((a, b) => b.couplingScore - a.couplingScore);
  return results;
}

export function classifyPattern(
  pair: { fileA: string; fileB: string; edgesAtoB: number; edgesBtoA: number; typeOnlyAtoB: number; typeOnlyBtoA: number },
  directionality: number,
  totalEdges: number,
  couplingScore: number,
  fileInfoMap: Map<string, FileInfo>,
): CouplingPattern {
  if (totalEdges < MIN_EDGES) return 'negligible';

  const roleA = fileInfoMap.get(pair.fileA)?.contentRole;
  const roleB = fileInfoMap.get(pair.fileB)?.contentRole;
  const hasContract = roleA === 'contract' || roleB === 'contract';

  if (directionality < BIDIRECTIONAL_THRESHOLD) {
    if (hasContract) return 'contract-consumer';
    return 'healthy-unidirectional';
  }

  const totalTypeOnly = pair.typeOnlyAtoB + pair.typeOnlyBtoA;
  const typeOnlyRatio = totalTypeOnly / totalEdges;

  if (couplingScore >= TIGHT_THRESHOLD) return 'tight-bidirectional';
  if (typeOnlyRatio >= 0.7) return 'mutual-type-coupling';
  if (directionality >= BIDIRECTIONAL_THRESHOLD) return 'mutual-value-coupling';

  return 'healthy-unidirectional';
}

// ── Cluster building ────────────────────────────────────────────────────

/**
 * Build clusters of files based on weighted mutual coupling.
 *
 * Uses union-find on concern pairs + strong mutual-type pairs.
 * Files with only unidirectional fan-in stay isolated.
 */
export function buildClusters(
  pairCouplings: FilePairCoupling[],
  allFileIds: string[],
): FileCluster[] {
  // Union-Find
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p !== x) {
      parent.set(x, find(p));
      return parent.get(x)!;
    }
    return p;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const id of allFileIds) parent.set(id, id);

  for (const pair of pairCouplings) {
    if (pair.isConcern) union(pair.fileA, pair.fileB);
  }
  for (const pair of pairCouplings) {
    if (pair.pattern === 'mutual-type-coupling' && pair.couplingScore >= CONCERN_THRESHOLD) {
      union(pair.fileA, pair.fileB);
    }
  }

  const clusterMap = new Map<string, string[]>();
  for (const id of allFileIds) {
    const root = find(id);
    let members = clusterMap.get(root);
    if (!members) { members = []; clusterMap.set(root, members); }
    members.push(id);
  }

  const clusters: FileCluster[] = [];
  let clusterIdx = 0;
  for (const [, members] of clusterMap) {
    if (members.length < 2) continue;

    let internalTotal = 0;
    let internalCount = 0;
    let externalTotal = 0;
    let externalCount = 0;
    const memberSet = new Set(members);

    for (const pair of pairCouplings) {
      const aIn = memberSet.has(pair.fileA);
      const bIn = memberSet.has(pair.fileB);
      if (aIn && bIn) {
        internalTotal += pair.couplingScore;
        internalCount++;
      } else if (aIn || bIn) {
        externalTotal += pair.couplingScore;
        externalCount++;
      }
    }

    const internalCoupling = internalCount > 0 ? round3(internalTotal / internalCount) : 0;
    const externalCoupling = externalCount > 0 ? round3(externalTotal / externalCount) : 0;
    const totalCoupling = internalCoupling + externalCoupling;
    const cohesionRatio = totalCoupling > 0 ? round3(internalCoupling / totalCoupling) : 0;

    const hasMutualValue = pairCouplings.some(
      (p) => memberSet.has(p.fileA) && memberSet.has(p.fileB) &&
        (p.pattern === 'mutual-value-coupling' || p.pattern === 'tight-bidirectional'),
    );
    const cohesionType: ClusterCohesionType = hasMutualValue
      ? 'mutual-dependencies'
      : 'shared-consumers';

    clusters.push({
      id: `cluster-${clusterIdx++}`,
      fileIds: members.sort(),
      cohesionType,
      internalCoupling,
      externalCoupling,
      cohesionRatio,
    });
  }

  clusters.sort((a, b) => b.internalCoupling - a.internalCoupling);
  return clusters;
}
