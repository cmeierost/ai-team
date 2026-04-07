/**
 * @aspect/engine — Step 4: Edge weighting (vectorization)
 *
 * Takes raw dependency edges and file classification info, then assigns
 * a numeric weight to each edge based on:
 *
 *   - Import type: type-only = 0.2, value (runtime) = 1.0
 *   - Relationship kind: extend (×2.5) > override (×2.0) > call (×1.2) > implement (×0.6)
 *   - Source/target file category: test/config files dampened
 *   - Source→target role pair matrix: classification-aware coupling
 *   - Target abstraction: interfaces/type-aliases dampened
 *   - Target entity kind: fine-grained kind-level multiplier
 *   - Folder distance: further apart = stronger signal
 *   - Cross-package: public API boundary dampened heavily
 *
 * The weights are the "vectors" that feed into clustering — higher
 * weight means stronger coupling signal. All factors are traced
 * in `weightReason` for explainability.
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
type RoleKey = NonNullable<FileInfo['contentRole']> | 'unknown';

const ROLE_PAIR_MULTIPLIERS: Partial<Record<`${RoleKey}->${RoleKey}`, number>> = {
  // Logic dependencies usually indicate meaningful implementation coupling.
  'logic->logic': 1.15,
  'logic->contract': 0.65,
  'logic->infrastructure': 0.7,
  'logic->presentation': 0.9,
  // Contract and utility/infrastructure dependencies are common shared surfaces.
  'contract->contract': 0.45,
  'contract->logic': 0.75,
  'contract->infrastructure': 0.6,
  'infrastructure->logic': 0.8,
  'infrastructure->infrastructure': 0.55,
  'infrastructure->contract': 0.55,
  // Presentation/UI often fans out broadly; dampen cross-cutting noise.
  'presentation->presentation': 0.8,
  'presentation->logic': 0.95,
  'presentation->infrastructure': 0.7,
  'presentation->contract': 0.75,
  // Entry and barrel files are orchestration/proxy surfaces.
  'entry_point->logic': 0.9,
  'entry_point->contract': 0.75,
  'barrel->logic': 0.65,
  'barrel->contract': 0.55,
};

const ENTITY_KIND_MULTIPLIERS: Partial<Record<string, number>> = {
  interface: 0.6,
  'type-alias': 0.6,
  enum: 0.75,
  class: 1.1,
  function: 1.05,
  method: 1.05,
};

/**
 * Type narrowing multipliers — when the source entity narrows the target
 * via a utility type, coupling is reduced because only a subset of the
 * target's surface is actually consumed.
 *
 * Pick/Extract select specific fields → strong discount.
 * Omit excludes a few fields → mild discount (still couples to most).
 * Partial/Readonly wrap the whole type → mild discount (weaker contract).
 */
const NARROWING_MULTIPLIERS: Record<string, number> = {
  pick: 0.5,       // only selected fields consumed
  extract: 0.55,   // subset of union
  exclude: 0.85,   // still couples to most of the union
  omit: 0.8,       // still couples to most of the type
  partial: 0.85,   // all fields but optional — weaker contract
  required: 0.95,  // strengthens contract, barely a discount
  readonly: 0.9,   // immutable wrapper — slightly less coupling risk
  record: 1.0,     // structural pattern, no discount
};

/**
 * Relationship kind multipliers — the semantic nature of the dependency
 * determines coupling strength. Inheritance (extend) is the strongest:
 * the child inherits implementation internals. Contract-only references
 * (implement, type references) are much lighter.
 *
 * These compose with isTypeOnly: e.g. interface-extends-interface gets
 * ×2.5 (extend) × 0.2 (type-only) = 0.5 — light type derivation.
 */
const RELATIONSHIP_KIND_MULTIPLIERS: Partial<Record<string, number>> = {
  extend: 2.5,
  override: 2.0,
  call: 1.2,
  use: 1.0,
  import: 0.8,
  reference: 0.7,
  implement: 0.6,
  're-export': 0.3,
};

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

function normalizeRole(role?: FileInfo['contentRole']): RoleKey {
  return role ?? 'unknown';
}

function rolePairMultiplier(sourceRole: RoleKey, targetRole: RoleKey): number {
  return ROLE_PAIR_MULTIPLIERS[`${sourceRole}->${targetRole}`] ?? 1.0;
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
  const sourceRole = normalizeRole(source?.contentRole);
  const targetRole = normalizeRole(target?.contentRole);

  let weight = edge.isTypeOnly ? TYPE_IMPORT_WEIGHT : VALUE_IMPORT_WEIGHT;
  const reasons: string[] = [];

  if (edge.isTypeOnly) {
    reasons.push('type-only import (0.2)');
  } else {
    reasons.push('value import (1.0)');
  }

  // Relationship kind weighting — inheritance > call > use > reference > contract
  if (edge.relationshipKind) {
    const relMult = RELATIONSHIP_KIND_MULTIPLIERS[edge.relationshipKind];
    if (relMult != null && relMult !== 1.0) {
      weight *= relMult;
      reasons.push(`relationship kind ${edge.relationshipKind} (×${relMult})`);
    }
  }

  // File category dampening (test/config files are expected to have broad imports)
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

  // Classification-aware role-pair weighting (replaces old per-role dampening)
  const roleMult = rolePairMultiplier(sourceRole, targetRole);
  if (roleMult !== 1.0) {
    weight *= roleMult;
    reasons.push(`role pair ${sourceRole}->${targetRole} (×${roleMult})`);
  }

  // Abstraction targets (interfaces/type-aliases) get dampened
  if (edge.targetIsAbstraction) {
    weight *= 0.75;
    reasons.push('target is abstraction (×0.75)');
  }

  // Fine-grained entity-kind multiplier on target
  if (edge.targetEntityKind) {
    const kindMult = ENTITY_KIND_MULTIPLIERS[edge.targetEntityKind];
    if (kindMult != null && kindMult !== 1.0) {
      weight *= kindMult;
      reasons.push(`target kind ${edge.targetEntityKind} (×${kindMult})`);
    }
  }

  // Surface complexity scaling: high-surface targets carry more coupling cost.
  // Uses gentle log scale — surface ≤5 has no effect, grows slowly after.
  // This counterbalances the abstraction discount: a small interface is cheap
  // to depend on, but a 50-field DTO is meaningful coupling even if type-only.
  if (edge.targetSignatureSurface != null && edge.targetSignatureSurface > 5) {
    // When the source narrows the target (Pick/Extract), use narrowed field count
    // as the effective surface instead of the full target surface.
    let effectiveSurface = edge.targetSignatureSurface;
    if (edge.sourceNarrowingKind && edge.sourceNarrowedFieldCount != null) {
      effectiveSurface = edge.sourceNarrowedFieldCount;
    }

    if (effectiveSurface > 5) {
      const surfaceMult = 1 + 0.1 * Math.log2(effectiveSurface / 5);
      weight *= surfaceMult;
      reasons.push(`target surface ${edge.targetSignatureSurface}${effectiveSurface !== edge.targetSignatureSurface ? ` narrowed to ${effectiveSurface}` : ''} (×${round3(surfaceMult)})`);
    }
  }

  // Type narrowing discount: Pick/Extract use a strict subset of the target,
  // Omit still couples to most of it, Partial/Readonly weaken the contract.
  if (edge.sourceNarrowingKind) {
    const narrowMult = NARROWING_MULTIPLIERS[edge.sourceNarrowingKind] ?? 1.0;
    if (narrowMult !== 1.0) {
      weight *= narrowMult;
      reasons.push(`source narrows via ${edge.sourceNarrowingKind} (×${narrowMult})`);
    }
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
