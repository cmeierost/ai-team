/**
 * @aspect/engine — Step 3: Import analysis
 *
 * Extracts dependency edges from collector relationships and computes
 * per-file import statistics. This is the bridge between raw collector
 * data and the weighted edge model.
 *
 * Produces:
 *   - Raw dependency edges (source → target, type-only flag)
 *   - Per-file coupling stats (fan-in, fan-out, type/value breakdown)
 */

import type { Entity, Relationship } from '@aspect/contracts';
import type { RawDependencyEdge, FileCouplingStats } from './types.js';

const IMPORT_RELATIONSHIP_KINDS = new Set(['import', 'use', 'reference', 're-export']);

// ── Raw edge extraction ─────────────────────────────────────────────────

/**
 * Build raw dependency edges from collector entities and relationships.
 *
 * Resolves child entities to their parent file, deduplicates self-edges,
 * and maps relationship.typeOnly to edge.isTypeOnly.
 */
export function buildRawEdges(
  entities: Entity[],
  relationships: Relationship[],
): RawDependencyEdge[] {
  const entityToFile = buildEntityToFileMap(entities);
  const edges: RawDependencyEdge[] = [];

  for (const rel of relationships) {
    if (!IMPORT_RELATIONSHIP_KINDS.has(rel.kind)) continue;

    const sourceFile = entityToFile.get(rel.sourceEntityId);
    const targetFile = entityToFile.get(rel.targetEntityId);
    if (!sourceFile || !targetFile || sourceFile === targetFile) continue;

    edges.push({
      sourceFileId: sourceFile,
      targetFileId: targetFile,
      isTypeOnly: rel.typeOnly ?? false,
    });
  }

  return edges;
}

// ── Per-file coupling statistics ────────────────────────────────────────

/**
 * Compute per-file import statistics from collector data.
 *
 * For each file, produces:
 * - fanIn / fanOut (distinct file count)
 * - incoming / outgoing totals
 * - type-only vs value import breakdown
 * - type-only ratio
 */
export function computeFileCouplingStats(
  entities: Entity[],
  relationships: Relationship[],
): Map<string, FileCouplingStats> {
  const entityToFile = buildEntityToFileMap(entities);
  const stats = new Map<string, FileCouplingStats>();

  const fanInSets = new Map<string, Set<string>>();
  const fanOutSets = new Map<string, Set<string>>();

  for (const rel of relationships) {
    if (!IMPORT_RELATIONSHIP_KINDS.has(rel.kind)) continue;

    const sourceFile = entityToFile.get(rel.sourceEntityId);
    const targetFile = entityToFile.get(rel.targetEntityId);
    if (!sourceFile || !targetFile || sourceFile === targetFile) continue;

    const isTypeOnly = rel.typeOnly ?? false;

    // Outgoing from source
    const srcStats = getOrCreate(stats, sourceFile);
    srcStats.outgoingTotal++;
    if (isTypeOnly) srcStats.outgoingTypeOnly++;
    else srcStats.outgoingValue++;

    // Incoming to target
    const tgtStats = getOrCreate(stats, targetFile);
    tgtStats.incomingTotal++;
    if (isTypeOnly) tgtStats.incomingTypeOnly++;
    else tgtStats.incomingValue++;

    // Fan-in / fan-out sets
    let outSet = fanOutSets.get(sourceFile);
    if (!outSet) { outSet = new Set(); fanOutSets.set(sourceFile, outSet); }
    outSet.add(targetFile);

    let inSet = fanInSets.get(targetFile);
    if (!inSet) { inSet = new Set(); fanInSets.set(targetFile, inSet); }
    inSet.add(sourceFile);
  }

  // Finalize fan counts and ratios
  for (const [id, s] of stats) {
    s.fanIn = fanInSets.get(id)?.size ?? 0;
    s.fanOut = fanOutSets.get(id)?.size ?? 0;
    s.typeOnlyInRatio = s.incomingTotal > 0 ? s.incomingTypeOnly / s.incomingTotal : 0;
    s.typeOnlyOutRatio = s.outgoingTotal > 0 ? s.outgoingTypeOnly / s.outgoingTotal : 0;
  }

  return stats;
}

// ── Internal helpers ────────────────────────────────────────────────────

function buildEntityToFileMap(entities: Entity[]): Map<string, string> {
  const fileIds = new Set(entities.filter((e) => e.kind === 'file').map((e) => e.id));
  const entityToFile = new Map<string, string>();

  for (const e of entities) {
    if (e.kind === 'file') {
      entityToFile.set(e.id, e.id);
    } else if (e.parentEntityId && fileIds.has(e.parentEntityId)) {
      entityToFile.set(e.id, e.parentEntityId);
    }
  }

  return entityToFile;
}

function getOrCreate(map: Map<string, FileCouplingStats>, key: string): FileCouplingStats {
  let entry = map.get(key);
  if (!entry) {
    entry = {
      fanIn: 0, fanOut: 0,
      incomingTotal: 0, incomingTypeOnly: 0, incomingValue: 0, typeOnlyInRatio: 0,
      outgoingTotal: 0, outgoingTypeOnly: 0, outgoingValue: 0, typeOnlyOutRatio: 0,
    };
    map.set(key, entry);
  }
  return entry;
}
