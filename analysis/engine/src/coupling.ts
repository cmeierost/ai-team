import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';
import type { SourceLocation } from './location.js';
import { buildLocationMap } from './location.js';

// ── Result types ────────────────────────────────────────────────────────

export interface CouplingResult {
  entityId: string;
  location?: SourceLocation;
  afferentCoupling: number;
  efferentCoupling: number;
  instability: number;
  totalCoupling: number;
}

export interface ModuleDependencyMatrix {
  moduleIds: string[];
  matrix: number[][];
  crossModuleEdgeCount: number;
}

export interface ModuleCohesion {
  moduleId: string;
  internalEdges: number;
  externalEdges: number;
  cohesionRatio: number;
}

export interface CouplingOptions {
  excludeThirdParty?: boolean;
  excludeTypeOnly?: boolean;
  excludeDynamic?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function applyFilters(
  relationships: Relationship[],
  options: CouplingOptions = {},
): Relationship[] {
  return relationships.filter((r) => {
    if (options.excludeThirdParty && r.thirdParty) return false;
    if (options.excludeTypeOnly && r.typeOnly) return false;
    if (options.excludeDynamic && r.dynamic) return false;
    return true;
  });
}

function excludeSelfReferences(relationships: Relationship[]): Relationship[] {
  return relationships.filter((r) => r.sourceEntityId !== r.targetEntityId);
}

function buildEntityToModuleMap(
  entities: Entity[],
  moduleBoundaries: ModuleBoundary[],
): Map<string, string> {
  const entityToModule = new Map<string, string>();

  // Index entities by filePath for fast lookup
  for (const entity of entities) {
    // Find the module whose modulePath is a prefix of the entity's filePath.
    // Pick the longest (most specific) match if multiple modules overlap.
    let bestModule: ModuleBoundary | undefined;
    for (const mb of moduleBoundaries) {
      if (
        entity.filePath.startsWith(mb.modulePath) &&
        (!bestModule || mb.modulePath.length > bestModule.modulePath.length)
      ) {
        bestModule = mb;
      }
    }
    if (bestModule) {
      entityToModule.set(entity.id, bestModule.moduleId);
    }
  }

  return entityToModule;
}

// ── Main functions ──────────────────────────────────────────────────────

export function calculateCoupling(
  entities: Entity[],
  relationships: Relationship[],
  options: CouplingOptions = {},
): CouplingResult[] {
  const filtered = excludeSelfReferences(applyFilters(relationships, options));
  const locationMap = buildLocationMap(entities);

  const entityIds = new Set(entities.map((e) => e.id));
  const caMap = new Map<string, number>();
  const ceMap = new Map<string, number>();

  for (const id of entityIds) {
    caMap.set(id, 0);
    ceMap.set(id, 0);
  }

  for (const r of filtered) {
    if (entityIds.has(r.sourceEntityId)) {
      ceMap.set(r.sourceEntityId, (ceMap.get(r.sourceEntityId) ?? 0) + 1);
    }
    if (entityIds.has(r.targetEntityId)) {
      caMap.set(r.targetEntityId, (caMap.get(r.targetEntityId) ?? 0) + 1);
    }
  }

  const results: CouplingResult[] = [];
  for (const id of entityIds) {
    const ca = caMap.get(id)!;
    const ce = ceMap.get(id)!;
    const total = ca + ce;
    results.push({
      entityId: id,
      location: locationMap.get(id),
      afferentCoupling: ca,
      efferentCoupling: ce,
      instability: total === 0 ? 0 : ce / total,
      totalCoupling: total,
    });
  }

  return results;
}

export function calculateModuleDependencyMatrix(
  relationships: Relationship[],
  moduleBoundaries: ModuleBoundary[],
  entities: Entity[],
  options: CouplingOptions = {},
): ModuleDependencyMatrix {
  const filtered = excludeSelfReferences(applyFilters(relationships, options));
  const entityToModule = buildEntityToModuleMap(entities, moduleBoundaries);
  const moduleIds = moduleBoundaries.map((mb) => mb.moduleId);
  const idxMap = new Map(moduleIds.map((id, i) => [id, i]));
  const n = moduleIds.length;

  const matrix: number[][] = Array.from({ length: n }, () =>
    Array.from<number>({ length: n }).fill(0),
  );

  let crossModuleEdgeCount = 0;

  for (const r of filtered) {
    const srcMod = entityToModule.get(r.sourceEntityId);
    const tgtMod = entityToModule.get(r.targetEntityId);
    if (srcMod === undefined || tgtMod === undefined) continue;
    if (srcMod === tgtMod) continue; // intra-module

    const si = idxMap.get(srcMod)!;
    const ti = idxMap.get(tgtMod)!;
    matrix[si][ti]++;
    crossModuleEdgeCount++;
  }

  return { moduleIds, matrix, crossModuleEdgeCount };
}

export function calculateModuleCohesion(
  relationships: Relationship[],
  moduleBoundaries: ModuleBoundary[],
  entities: Entity[],
  options: CouplingOptions = {},
): ModuleCohesion[] {
  const filtered = excludeSelfReferences(applyFilters(relationships, options));
  const entityToModule = buildEntityToModuleMap(entities, moduleBoundaries);

  const internalMap = new Map<string, number>();
  const externalMap = new Map<string, number>();

  for (const mb of moduleBoundaries) {
    internalMap.set(mb.moduleId, 0);
    externalMap.set(mb.moduleId, 0);
  }

  for (const r of filtered) {
    const srcMod = entityToModule.get(r.sourceEntityId);
    const tgtMod = entityToModule.get(r.targetEntityId);

    if (srcMod !== undefined) {
      if (srcMod === tgtMod) {
        internalMap.set(srcMod, (internalMap.get(srcMod) ?? 0) + 1);
      } else {
        externalMap.set(srcMod, (externalMap.get(srcMod) ?? 0) + 1);
      }
    }

    // For the target module: an incoming cross-module edge is also external
    if (tgtMod !== undefined && tgtMod !== srcMod) {
      externalMap.set(tgtMod, (externalMap.get(tgtMod) ?? 0) + 1);
    }
  }

  return moduleBoundaries.map((mb) => {
    const internal = internalMap.get(mb.moduleId)!;
    const external = externalMap.get(mb.moduleId)!;
    const total = internal + external;
    return {
      moduleId: mb.moduleId,
      internalEdges: internal,
      externalEdges: external,
      cohesionRatio: total === 0 ? 0 : internal / total,
    };
  });
}
