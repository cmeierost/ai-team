// @aspect/engine — Source location helper
// Builds entity → source-location lookup maps for IDE navigation.

import type { Entity, SourceRange } from '@aspect/contracts';

export interface SourceLocation {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * Build a lookup map from entity ID to SourceLocation.
 * Use this once per calculator, then look up per result.
 */
export function buildLocationMap(entities: Entity[]): Map<string, SourceLocation> {
  const map = new Map<string, SourceLocation>();
  for (const e of entities) {
    if (e.filePath && e.sourceRange) {
      map.set(e.id, {
        filePath: e.filePath,
        startLine: e.sourceRange.startLine,
        startColumn: e.sourceRange.startColumn,
        endLine: e.sourceRange.endLine,
        endColumn: e.sourceRange.endColumn,
      });
    }
  }
  return map;
}
