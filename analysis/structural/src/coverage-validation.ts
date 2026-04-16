/**
 * Entity coverage validation — checks entity kind distribution and flags
 * files that have no child entities (uncovered by analysis).
 */

import type { Entity } from '@aspect/contracts';

// ── Public types ────────────────────────────────────────────────────────

export interface CoverageValidation {
  /** Count of entities that are standalone (not import/reexport) */
  standaloneEntityCount: number;
  /** Count of entities incorrectly classified as entities (should be excluded) */
  importReexportEntityCount: number;
  /** Entity kinds found */
  kindDistribution: Record<string, number>;
  /** Files that have no child entities (uncovered) */
  uncoveredFileCount: number;
}

// ── Implementation ──────────────────────────────────────────────────────

/** Entity kinds that indicate import/reexport artefacts, not real code entities. */
const IMPORT_REEXPORT_KINDS = new Set([
  'import',
  'reexport',
  're-export',
  'import-declaration',
  'export-declaration',
]);

/**
 * Validate entity coverage: distribution of kinds, import/reexport leaks,
 * and files without child entities.
 */
export function computeCoverageValidation(entities: Entity[]): CoverageValidation {
  const kindDistribution: Record<string, number> = {};
  let standaloneEntityCount = 0;
  let importReexportEntityCount = 0;

  const fileIds = new Set<string>();
  const filesWithChildren = new Set<string>();

  for (const e of entities) {
    // Track kind distribution for all entities
    kindDistribution[e.kind] = (kindDistribution[e.kind] ?? 0) + 1;

    if (e.kind === 'file') {
      fileIds.add(e.id);
      continue;
    }

    // Check for import/reexport entity kinds that shouldn't exist
    if (IMPORT_REEXPORT_KINDS.has(e.kind)) {
      importReexportEntityCount++;
    } else {
      standaloneEntityCount++;
    }

    // Track which files have children
    if (e.parentEntityId) {
      filesWithChildren.add(e.parentEntityId);
    }
    // Also use filePath matching for entities that reference their file
    const fileByPath = entities.find(
      (f) => f.kind === 'file' && (f.filePath ?? f.name) === e.filePath,
    );
    if (fileByPath) {
      filesWithChildren.add(fileByPath.id);
    }
  }

  // Uncovered = file entities with no children at all
  const uncoveredFileCount = [...fileIds].filter(
    (id) => !filesWithChildren.has(id),
  ).length;

  return {
    standaloneEntityCount,
    importReexportEntityCount,
    kindDistribution,
    uncoveredFileCount,
  };
}
