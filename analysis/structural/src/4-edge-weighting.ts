/**
 * @aspect/engine — Step 4: Edge weighting (vectorization)
 *
 * Takes raw dependency edges and file classification info, then assigns
 * a numeric weight to each edge based on:
 *
 *   - Import type: type-only = 0.2, value (runtime) = 1.0
 *   - Target role: importing a contract is lighter (×0.5)
 *   - Source role: test files importing things is expected (×0.1)
 *
 * The weights are the "vectors" that feed into clustering — higher
 * weight means stronger coupling signal.
 */

import type { RawDependencyEdge, WeightedEdge, FileInfo } from './types.js';
import { round3, parentDir } from './types.js';

// ── Weight constants ────────────────────────────────────────────────────

const TYPE_IMPORT_WEIGHT = 0.2;
const VALUE_IMPORT_WEIGHT = 1.0;

/**
 * Cross-package imports go through public API boundaries — they indicate
 * architecture compliance, not tight coupling. Dampen heavily so Louvain
 * keeps packages in separate communities.
 */
const CROSS_PACKAGE_MULTIPLIER = 0.15;

/** Folder distance multipliers: the further apart, the stronger the coupling signal. */
const DISTANCE_MULTIPLIERS: readonly number[] = [1.0, 1.0, 1.1, 1.3, 1.5];

export const WEIGHTS = {
  TYPE_IMPORT_WEIGHT,
  VALUE_IMPORT_WEIGHT,
  BIDIRECTIONAL_MULTIPLIER: 2.0,
  CONCERN_THRESHOLD: 1.5,
  TIGHT_THRESHOLD: 5.0,
  BIDIRECTIONAL_THRESHOLD: 0.25,
  MIN_EDGES: 2,
} as const;

// ── Folder distance ─────────────────────────────────────────────────────

function dirSegments(filePath: string): string[] {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(0, -1);
}

function folderDistance(pathA: string, pathB: string): number {
  const segsA = dirSegments(pathA);
  const segsB = dirSegments(pathB);
  let common = 0;
  const max = Math.min(segsA.length, segsB.length);
  while (common < max && segsA[common] === segsB[common]) common++;
  return (segsA.length - common) + (segsB.length - common);
}

function distanceMultiplier(dist: number): number {
  if (dist < DISTANCE_MULTIPLIERS.length) return DISTANCE_MULTIPLIERS[dist];
  return DISTANCE_MULTIPLIERS[DISTANCE_MULTIPLIERS.length - 1];
}

/** Extract the package root (e.g. 'packages/core/src') from a file path, or null. */
function packageRoot(filePath: string): string | null {
  const m = filePath.replace(/\\/g, '/').match(/^(.+?\/src)\//);
  return m?.[1] ?? null;
}

function isCrossPackage(pathA: string, pathB: string): boolean {
  const rootA = packageRoot(pathA);
  const rootB = packageRoot(pathB);
  return !!(rootA && rootB && rootA !== rootB);
}

// ── Edge weighting ──────────────────────────────────────────────────────

/**
 * Weight a single dependency edge based on import type and file roles.
 */
export function weightEdge(
  edge: RawDependencyEdge,
  fileInfoMap: Map<string, FileInfo>,
): WeightedEdge {
  const target = fileInfoMap.get(edge.targetFileId);
  const source = fileInfoMap.get(edge.sourceFileId);

  let weight = edge.isTypeOnly ? TYPE_IMPORT_WEIGHT : VALUE_IMPORT_WEIGHT;
  const reasons: string[] = [];

  if (edge.isTypeOnly) {
    reasons.push('type-only import (0.2)');
  } else {
    reasons.push('value import (1.0)');
  }

  if (target?.contentRole === 'contract') {
    weight *= 0.5;
    reasons.push('target is contract (×0.5)');
  }
  if (target?.contentRole === 'infrastructure') {
    weight *= 0.6;
    reasons.push('target is infrastructure (×0.6)');
  }
  if (source?.category === 'test') {
    weight *= 0.1;
    reasons.push('source is test file (×0.1)');
  }
  if (target?.category === 'test') {
    weight *= 0.2;
    reasons.push('target is test file (×0.2)');
  }
  if (source?.category === 'config') {
    weight *= 0.2;
    reasons.push('source is config file (×0.2)');
  }

  // Folder distance: imports crossing many directory levels weigh more
  if (source?.filePath && target?.filePath) {
    const dist = folderDistance(source.filePath, target.filePath);
    const mult = distanceMultiplier(dist);
    if (mult !== 1.0) {
      weight *= mult;
      reasons.push(`folder distance ${dist} (×${mult})`);
    }

    // Cross-package: public API boundary, dampen heavily
    if (isCrossPackage(source.filePath, target.filePath)) {
      weight *= CROSS_PACKAGE_MULTIPLIER;
      reasons.push(`cross-package (×${CROSS_PACKAGE_MULTIPLIER})`);
    }
  }

  return {
    sourceFileId: edge.sourceFileId,
    targetFileId: edge.targetFileId,
    isTypeOnly: edge.isTypeOnly,
    weight: round3(weight),
    weightReason: reasons.join(', '),
  };
}

/**
 * Weight all edges in a dependency graph.
 */
export function weightAllEdges(
  edges: RawDependencyEdge[],
  fileInfoMap: Map<string, FileInfo>,
): WeightedEdge[] {
  return edges.map((e) => weightEdge(e, fileInfoMap));
}
