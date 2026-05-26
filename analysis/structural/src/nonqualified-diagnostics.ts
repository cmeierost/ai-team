/**
 * Non-qualified code diagnostics.
 *
 * Detects lines of code inside file entities that were not attributed to any
 * child entity — i.e., "loose" top-level code that sits outside functions,
 * classes, or other recognised constructs.
 */

import type { Entity } from '@aspect/contracts';
import { round3 } from './types.js';

// ── Public types ────────────────────────────────────────────────────────

export interface NonQualifiedDiagnostics {
  perFile: FileNonQualifiedInfo[];
  totalNonQualifiedLoc: number;
  totalFileLoc: number;
  nonQualifiedRatio: number;
}

export interface FileNonQualifiedInfo {
  fileId: string;
  filePath: string;
  totalLines: number;
  entityCoveredLines: number;
  nonQualifiedLines: number;
  nonQualifiedRatio: number;
}

// ── Computation ─────────────────────────────────────────────────────────

/**
 * Compute non-qualified code diagnostics.
 *
 * For each file entity, compares `rawCounts.linesOfCode` against the sum of
 * `rawCounts.linesOfCode` for all its *direct* child entities.  The gap
 * represents lines not attributed to any recognised entity.
 */
export function computeNonQualifiedDiagnostics(
  entities: Entity[],
): NonQualifiedDiagnostics {
  const fileEntities = entities.filter((e) => e.kind === 'file');

  // Build parent → direct children map
  const childMap = new Map<string, Entity[]>();
  for (const e of entities) {
    if (e.kind !== 'file' && e.parentEntityId) {
      let list = childMap.get(e.parentEntityId);
      if (!list) { list = []; childMap.set(e.parentEntityId, list); }
      list.push(e);
    }
  }

  const perFile: FileNonQualifiedInfo[] = [];
  let totalNonQualified = 0;
  let totalFile = 0;

  for (const file of fileEntities) {
    const filePath = file.filePath ?? file.name;
    const totalLines = numVal(file.rawCounts?.linesOfCode);

    const children = childMap.get(file.id) ?? [];
    // Only count direct children (parentEntityId === file.id)
    let entityCoveredLines = 0;
    for (const child of children) {
      if (child.parentEntityId === file.id) {
        entityCoveredLines += numVal(child.rawCounts?.linesOfCode);
      }
    }

    const nonQualifiedLines = Math.max(0, totalLines - entityCoveredLines);
    const nonQualifiedRatio = totalLines > 0 ? round3(nonQualifiedLines / totalLines) : 0;

    perFile.push({
      fileId: file.id,
      filePath,
      totalLines,
      entityCoveredLines,
      nonQualifiedLines,
      nonQualifiedRatio,
    });

    totalNonQualified += nonQualifiedLines;
    totalFile += totalLines;
  }

  return {
    perFile,
    totalNonQualifiedLoc: totalNonQualified,
    totalFileLoc: totalFile,
    nonQualifiedRatio: totalFile > 0 ? round3(totalNonQualified / totalFile) : 0,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function numVal(v: number | null | undefined): number {
  return typeof v === 'number' ? v : 0;
}
