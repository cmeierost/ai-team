/**
 * Canonical LOC computation.
 *
 * Computes canonical lines-of-code per file entity by subtracting blank lines,
 * comment lines, and import/export-only lines from the raw line count.
 */

import type { Entity, Relationship } from '@aspect/contracts';
import { round3 } from './types.js';

// ── Public types ────────────────────────────────────────────────────────

export interface CanonicalLocMetrics {
  perFile: FileLocMetrics[];
  totalCanonicalLoc: number;
  totalRawLines: number;
  blankLineRatio: number;
  commentRatio: number;
  importExportOnlyRatio: number;
}

export interface FileLocMetrics {
  fileId: string;
  filePath: string;
  rawLines: number;
  blankLines: number;
  commentLines: number;
  importExportOnlyLines: number;
  canonicalLoc: number;
  documentationDensity: number;
}

// ── Computation ─────────────────────────────────────────────────────────

/**
 * Compute canonical LOC metrics from entity and relationship data.
 *
 * For each file entity, raw counts are taken directly from `rawCounts` when
 * available, or aggregated from child entities.  Import/export-only lines are
 * estimated from import / re-export relationship counts per source file.
 */
export function computeCanonicalLocMetrics(
  entities: Entity[],
  relationships: Relationship[],
): CanonicalLocMetrics {
  const fileEntities = entities.filter((e) => e.kind === 'file');
  const childMap = new Map<string, Entity[]>();

  for (const e of entities) {
    if (e.kind !== 'file' && e.parentEntityId) {
      let list = childMap.get(e.parentEntityId);
      if (!list) { list = []; childMap.set(e.parentEntityId, list); }
      list.push(e);
    }
  }

  // Estimate import/export-only lines per file from relationship counts
  const importExportLinesByFile = new Map<string, number>();
  for (const rel of relationships) {
    if (rel.kind === 'import' || rel.kind === 're-export') {
      const src = rel.sourceFilePath;
      importExportLinesByFile.set(src, (importExportLinesByFile.get(src) ?? 0) + 1);
    }
  }

  const perFile: FileLocMetrics[] = [];
  let totalRaw = 0;
  let totalBlank = 0;
  let totalComment = 0;
  let totalImportExport = 0;
  let totalCanonical = 0;

  for (const file of fileEntities) {
    const filePath = file.filePath ?? file.name;

    // Try file entity's own rawCounts first; fall back to summing children
    let rawLines = numVal(file.rawCounts?.linesOfCode);
    let blankLines = numVal(file.rawCounts?.blankLines);
    let commentLines = numVal(file.rawCounts?.commentLines);

    if (rawLines === 0) {
      const children = childMap.get(file.id) ?? [];
      for (const child of children) {
        rawLines += numVal(child.rawCounts?.linesOfCode);
        blankLines += numVal(child.rawCounts?.blankLines);
        commentLines += numVal(child.rawCounts?.commentLines);
      }
    }

    const importExportOnlyLines = importExportLinesByFile.get(filePath) ?? 0;

    const canonicalLoc = Math.max(0, rawLines - blankLines - commentLines - importExportOnlyLines);
    const documentationDensity = rawLines > 0 ? round3(commentLines / rawLines) : 0;

    perFile.push({
      fileId: file.id,
      filePath,
      rawLines,
      blankLines,
      commentLines,
      importExportOnlyLines,
      canonicalLoc,
      documentationDensity,
    });

    totalRaw += rawLines;
    totalBlank += blankLines;
    totalComment += commentLines;
    totalImportExport += importExportOnlyLines;
    totalCanonical += canonicalLoc;
  }

  const safeDivide = (n: number, d: number) => (d === 0 ? 0 : n / d);

  return {
    perFile,
    totalCanonicalLoc: totalCanonical,
    totalRawLines: totalRaw,
    blankLineRatio: round3(safeDivide(totalBlank, totalRaw)),
    commentRatio: round3(safeDivide(totalComment, totalRaw)),
    importExportOnlyRatio: round3(safeDivide(totalImportExport, totalRaw)),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function numVal(v: number | null | undefined): number {
  return typeof v === 'number' ? v : 0;
}
