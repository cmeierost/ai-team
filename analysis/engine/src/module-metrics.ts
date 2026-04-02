/**
 * Module metrics calculator — derives module-level quality metrics from
 * entity, relationship, and boundary data.
 *
 * Pure math engine: no source code access.
 */

import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ModuleMetricsResult {
  moduleId: string;
  /** Abstractness (A): 0–1. Ratio of abstract/interface entities to total type entities. */
  abstractness: number;
  /** Instability (I): 0–1. Ce / (Ca + Ce) at the module level. */
  instability: number;
  /** |A + I − 1|: 0 means on the main sequence. */
  distanceFromMainSequence: number;
  size: {
    fileCount: number;
    totalLoc: number;
    entityCount: number;
    classCount: number;
    interfaceCount: number;
    functionCount: number;
  };
  /** Ca: incoming edges from other modules. */
  afferentCoupling: number;
  /** Ce: outgoing edges to other modules (excluding third-party). */
  efferentCoupling: number;
}

export interface ModuleMetricsSummary {
  modules: ModuleMetricsResult[];
  averageAbstractness: number;
  averageInstability: number;
  averageDistance: number;
  /** Modules with low A + low I (rigid, hard-to-change concrete code). */
  zoneOfPain: string[];
  /** Modules with high A + high I (disconnected abstractions). */
  zoneOfUselessness: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_ENTITY_KINDS = new Set<string>([
  'class',
  'interface',
  'type-alias',
  'enum',
]);

const ZONE_OF_PAIN_THRESHOLD = 0.2;
const ZONE_OF_USELESSNESS_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Find the module a file belongs to by matching against module boundaries.
 * Uses the longest (most specific) modulePath match.
 */
function findModuleForEntity(
  entityFilePath: string,
  boundaries: ModuleBoundary[],
): string | null {
  const normalized = normalizePath(entityFilePath);
  let bestId: string | null = null;
  let bestLen = -1;

  for (const b of boundaries) {
    const mp = normalizePath(b.modulePath);
    if (normalized.startsWith(mp) && mp.length > bestLen) {
      bestId = b.moduleId;
      bestLen = mp.length;
    }
  }

  return bestId;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

// ---------------------------------------------------------------------------
// Main calculator
// ---------------------------------------------------------------------------

/**
 * Derive module-level metrics (Abstractness, Instability, Distance from Main
 * Sequence) for every module defined by the supplied boundaries.
 *
 * - Abstractness = abstract-or-interface type entities / total type entities
 * - Instability  = Ce / (Ca + Ce)
 * - Distance     = |A + I − 1|
 */
export function calculateModuleMetrics(
  entities: Entity[],
  relationships: Relationship[],
  moduleBoundaries: ModuleBoundary[],
): ModuleMetricsSummary {
  if (moduleBoundaries.length === 0) {
    return {
      modules: [],
      averageAbstractness: 0,
      averageInstability: 0,
      averageDistance: 0,
      zoneOfPain: [],
      zoneOfUselessness: [],
    };
  }

  // 1. Map entities → modules
  const moduleEntities = new Map<string, Entity[]>();
  for (const b of moduleBoundaries) {
    moduleEntities.set(b.moduleId, []);
  }

  const entityModuleMap = new Map<string, string>();
  for (const entity of entities) {
    const moduleId = findModuleForEntity(entity.filePath, moduleBoundaries);
    if (moduleId != null) {
      moduleEntities.get(moduleId)!.push(entity);
      entityModuleMap.set(entity.id, moduleId);
    }
  }

  // 2. Compute per-module coupling (Ca / Ce)
  const moduleCa = new Map<string, number>();
  const moduleCe = new Map<string, number>();
  for (const b of moduleBoundaries) {
    moduleCa.set(b.moduleId, 0);
    moduleCe.set(b.moduleId, 0);
  }

  for (const rel of relationships) {
    const srcMod = entityModuleMap.get(rel.sourceEntityId);
    const tgtMod = entityModuleMap.get(rel.targetEntityId);

    if (srcMod == null || tgtMod == null) continue;
    if (srcMod === tgtMod) continue;

    // Ca for target module (incoming from another module)
    moduleCa.set(tgtMod, (moduleCa.get(tgtMod) ?? 0) + 1);

    // Ce for source module (outgoing to another module), excluding third-party
    if (!rel.thirdParty) {
      moduleCe.set(srcMod, (moduleCe.get(srcMod) ?? 0) + 1);
    }
  }

  // 3. Build per-module results
  const results: ModuleMetricsResult[] = [];

  for (const boundary of moduleBoundaries) {
    const moduleId = boundary.moduleId;
    const ents = moduleEntities.get(moduleId) ?? [];

    // Abstractness
    const typeEntities = ents.filter((e) => TYPE_ENTITY_KINDS.has(e.kind));
    const abstractCount = typeEntities.filter(
      (e) => e.classification.isAbstract || e.classification.isInterface,
    ).length;
    const abstractness = safeDivide(abstractCount, typeEntities.length);

    // Coupling & Instability
    const ca = moduleCa.get(moduleId) ?? 0;
    const ce = moduleCe.get(moduleId) ?? 0;
    const instability = safeDivide(ce, ca + ce);

    // Distance from main sequence
    const distance = Math.abs(abstractness + instability - 1);

    // Size metrics
    const fileCount = ents.filter((e) => e.kind === 'file').length;
    const totalLoc = ents.reduce(
      (sum, e) => sum + (e.rawCounts?.linesOfCode ?? 0),
      0,
    );

    results.push({
      moduleId,
      abstractness,
      instability,
      distanceFromMainSequence: distance,
      size: {
        fileCount,
        totalLoc,
        entityCount: ents.length,
        classCount: ents.filter((e) => e.kind === 'class').length,
        interfaceCount: ents.filter((e) => e.kind === 'interface').length,
        functionCount: ents.filter((e) => e.kind === 'function').length,
      },
      afferentCoupling: ca,
      efferentCoupling: ce,
    });
  }

  // 4. Summary averages
  const n = results.length;
  const averageAbstractness = safeDivide(
    results.reduce((s, m) => s + m.abstractness, 0),
    n,
  );
  const averageInstability = safeDivide(
    results.reduce((s, m) => s + m.instability, 0),
    n,
  );
  const averageDistance = safeDivide(
    results.reduce((s, m) => s + m.distanceFromMainSequence, 0),
    n,
  );

  // 5. Zone detection
  const zoneOfPain = results
    .filter(
      (m) =>
        m.abstractness < ZONE_OF_PAIN_THRESHOLD &&
        m.instability < ZONE_OF_PAIN_THRESHOLD,
    )
    .map((m) => m.moduleId);

  const zoneOfUselessness = results
    .filter(
      (m) =>
        m.abstractness > ZONE_OF_USELESSNESS_THRESHOLD &&
        m.instability > ZONE_OF_USELESSNESS_THRESHOLD,
    )
    .map((m) => m.moduleId);

  return {
    modules: results,
    averageAbstractness,
    averageInstability,
    averageDistance,
    zoneOfPain,
    zoneOfUselessness,
  };
}
