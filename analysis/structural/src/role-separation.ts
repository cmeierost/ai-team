/**
 * Role separation metrics.
 *
 * Measures how well each cluster isolates a single responsibility role
 * (logic, contract, presentation, infrastructure) versus mixing concerns.
 */

import type { Community, FileClassificationEntry } from './types.js';
import { round3 } from './types.js';

// ── Public types ────────────────────────────────────────────────────────

export interface RoleSeparationMetrics {
  perCluster: ClusterRoleSeparation[];
  repoSummary: RepoRoleSummary;
}

export interface ClusterRoleSeparation {
  clusterId: string;
  logicLoc: number;
  contractLoc: number;
  presentationLoc: number;
  infrastructureLoc: number;
  otherLoc: number;
  dominantRole: string;
  separationScore: number;
}

export interface RepoRoleSummary {
  totalLogicLoc: number;
  totalContractLoc: number;
  totalPresentationLoc: number;
  totalInfrastructureLoc: number;
  totalOtherLoc: number;
  avgClusterSeparation: number;
}

// ── Role bucket helper ──────────────────────────────────────────────────

type RoleKey = 'logic' | 'contract' | 'presentation' | 'infrastructure' | 'other';

function roleKey(role: string | undefined): RoleKey {
  switch (role) {
    case 'logic': return 'logic';
    case 'contract': return 'contract';
    case 'presentation': return 'presentation';
    case 'infrastructure': return 'infrastructure';
    default: return 'other';
  }
}

// ── Computation ─────────────────────────────────────────────────────────

/**
 * Compute role-separation metrics per cluster and in aggregate.
 *
 * For each cluster, sums LOC per role using `contentRole` (from code
 * classification) and `linesOfCode` from the file classification entries.
 * The separation score is `dominantRoleLoc / totalLoc` (1.0 = perfectly
 * single-role).
 */
export function computeRoleSeparation(
  communities: Community[],
  fileClassifications: FileClassificationEntry[],
): RoleSeparationMetrics {
  const fileIndex = new Map<string, FileClassificationEntry>();
  for (const fc of fileClassifications) {
    fileIndex.set(fc.fileId, fc);
  }

  const perCluster: ClusterRoleSeparation[] = [];
  let repoLogic = 0;
  let repoContract = 0;
  let repoPresentation = 0;
  let repoInfra = 0;
  let repoOther = 0;

  for (const community of communities) {
    const buckets: Record<RoleKey, number> = {
      logic: 0, contract: 0, presentation: 0, infrastructure: 0, other: 0,
    };

    for (const fileId of community.memberFileIds) {
      const fc = fileIndex.get(fileId);
      if (!fc) continue;
      const loc = fc.linesOfCode ?? 0;
      buckets[roleKey(fc.contentRole)] += loc;
    }

    const total = buckets.logic + buckets.contract + buckets.presentation
                + buckets.infrastructure + buckets.other;

    const entries: Array<[RoleKey, number]> = Object.entries(buckets) as any;
    const dominant = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    const separationScore = total > 0 ? round3(dominant[1] / total) : 0;

    perCluster.push({
      clusterId: community.id,
      logicLoc: buckets.logic,
      contractLoc: buckets.contract,
      presentationLoc: buckets.presentation,
      infrastructureLoc: buckets.infrastructure,
      otherLoc: buckets.other,
      dominantRole: dominant[0],
      separationScore,
    });

    repoLogic += buckets.logic;
    repoContract += buckets.contract;
    repoPresentation += buckets.presentation;
    repoInfra += buckets.infrastructure;
    repoOther += buckets.other;
  }

  const avgSep = perCluster.length > 0
    ? round3(perCluster.reduce((sum, c) => sum + c.separationScore, 0) / perCluster.length)
    : 0;

  return {
    perCluster,
    repoSummary: {
      totalLogicLoc: repoLogic,
      totalContractLoc: repoContract,
      totalPresentationLoc: repoPresentation,
      totalInfrastructureLoc: repoInfra,
      totalOtherLoc: repoOther,
      avgClusterSeparation: avgSep,
    },
  };
}
