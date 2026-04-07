/**
 * Entity hierarchy analysis — computes summary stats from the containment
 * hierarchy fields (parentEntityId, childEntityIds, entityDepth, hierarchyKind)
 * that every Entity carries from the contracts layer.
 */

import type { Entity } from '@aspect/contracts';

// ── Public types ────────────────────────────────────────────────────────

export interface EntityHierarchySummary {
  /** Total entities with parent-child relationships */
  totalHierarchicalEntities: number;
  /** Max depth across all entities */
  maxDepth: number;
  /** Entities at each depth level */
  depthDistribution: Record<number, number>;
  /** Container entities (entities with children) */
  containerCount: number;
  /** Leaf entities (no children) */
  leafCount: number;
  /** Per-file hierarchy info */
  perFile: FileHierarchyInfo[];
}

export interface FileHierarchyInfo {
  fileId: string;
  filePath: string;
  /** Top-level entities in this file (depth 0 or 1) */
  topLevelCount: number;
  /** Total entity count including nested */
  totalEntityCount: number;
  /** Max nesting depth in this file */
  maxDepth: number;
  /** Entities that are containers (have children) */
  containerKinds: string[];
}

// ── Implementation ──────────────────────────────────────────────────────

/**
 * Analyse hierarchy stats from entities that carry containment metadata.
 * Only non-file entities are counted (file entities are the roots, not part
 * of the logical containment hierarchy).
 */
export function computeHierarchySummary(entities: Entity[]): EntityHierarchySummary {
  const nonFileEntities = entities.filter((e) => e.kind !== 'file');

  // Global stats
  let maxDepth = 0;
  const depthDistribution: Record<number, number> = {};
  let containerCount = 0;
  let leafCount = 0;
  let totalHierarchicalEntities = 0;

  for (const e of nonFileEntities) {
    const depth = e.entityDepth ?? 0;
    depthDistribution[depth] = (depthDistribution[depth] ?? 0) + 1;
    if (depth > maxDepth) maxDepth = depth;

    if (e.parentEntityId || (e.childEntityIds && e.childEntityIds.length > 0)) {
      totalHierarchicalEntities++;
    }

    if (e.childEntityIds && e.childEntityIds.length > 0) {
      containerCount++;
    } else {
      leafCount++;
    }
  }

  // Per-file breakdown
  const fileMap = new Map<string, { fileId: string; filePath: string; entities: Entity[] }>();

  // Collect file entities for ID→path mapping
  for (const e of entities) {
    if (e.kind === 'file') {
      fileMap.set(e.id, { fileId: e.id, filePath: e.filePath ?? e.name, entities: [] });
    }
  }

  // Group non-file entities by their parent file
  for (const e of nonFileEntities) {
    const fileId = findFileId(e, entities);
    if (fileId) {
      const entry = fileMap.get(fileId);
      if (entry) entry.entities.push(e);
    }
  }

  const perFile: FileHierarchyInfo[] = [];
  for (const [, info] of fileMap) {
    if (info.entities.length === 0) continue;

    let fileMaxDepth = 0;
    let topLevelCount = 0;
    const containerKindsSet = new Set<string>();

    for (const e of info.entities) {
      const depth = e.entityDepth ?? 0;
      if (depth > fileMaxDepth) fileMaxDepth = depth;
      if (depth <= 1) topLevelCount++;
      if (e.childEntityIds && e.childEntityIds.length > 0) {
        containerKindsSet.add(e.kind);
      }
    }

    perFile.push({
      fileId: info.fileId,
      filePath: info.filePath,
      topLevelCount,
      totalEntityCount: info.entities.length,
      maxDepth: fileMaxDepth,
      containerKinds: [...containerKindsSet].sort(),
    });
  }

  return {
    totalHierarchicalEntities,
    maxDepth,
    depthDistribution,
    containerCount,
    leafCount,
    perFile,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Walk up the parentEntityId chain to find the file entity that contains
 * the given entity. Falls back to filePath matching if the chain is short.
 */
function findFileId(entity: Entity, allEntities: Entity[]): string | undefined {
  // Fast path: if the entity's filePath matches a file entity
  const fileEntity = allEntities.find(
    (e) => e.kind === 'file' && (e.filePath ?? e.name) === entity.filePath,
  );
  return fileEntity?.id;
}
