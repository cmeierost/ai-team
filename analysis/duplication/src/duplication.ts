/**
 * Duplication calculator — derives duplication metrics from collected clone data.
 *
 * Pure math engine: no source code access, works from DuplicationSignal + Entity data.
 */

import type { DuplicationSignal, Entity, ModuleBoundary } from '@aspect/contracts';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface FileDuplicationResult {
  filePath: string;
  /** Lines involved in at least one clone. */
  duplicatedLines: number;
  /** Total lines from entity LOC. */
  totalLines: number;
  /** 0–100 duplication percentage. */
  duplicationPercentage: number;
  /** How many distinct clone pairs involve this file. */
  cloneCount: number;
}

export interface ProjectDuplicationResult {
  totalLines: number;
  duplicatedLines: number;
  /** 0–100 duplication percentage. */
  duplicationPercentage: number;
  totalClones: number;
}

export interface CrossModuleDuplication {
  sourceModule: string;
  targetModule: string;
  cloneCount: number;
  totalDuplicatedLines: number;
}

export interface DuplicationResults {
  project: ProjectDuplicationResult;
  files: FileDuplicationResult[];
  crossModule: CrossModuleDuplication[];
  /** Top N files by duplication percentage. */
  hotspots: FileDuplicationResult[];
}

export interface DuplicationOptions {
  /** Number of hotspot files to return (default: 10). */
  hotspotCount?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function findModule(
  filePath: string,
  boundaries: ModuleBoundary[],
): string | null {
  const normalized = normalizePath(filePath);
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

// ---------------------------------------------------------------------------
// Main calculator
// ---------------------------------------------------------------------------

const DEFAULT_HOTSPOT_COUNT = 10;

/**
 * Derive duplication metrics from one or more DuplicationSignal payloads.
 *
 * Per-file duplication uses a Set of line numbers to avoid double-counting
 * overlapping clone ranges.  Project-level statistics are taken directly from
 * signal data.  Cross-module analysis compares clone file locations against
 * the supplied module boundaries.
 */
export function calculateDuplication(
  duplicationSignals: DuplicationSignal[],
  entities: Entity[],
  moduleBoundaries: ModuleBoundary[],
  options?: DuplicationOptions,
): DuplicationResults {
  const hotspotCount = options?.hotspotCount ?? DEFAULT_HOTSPOT_COUNT;

  // 1. Build file → total-lines lookup from file entities
  const fileLinesMap = new Map<string, number>();
  for (const entity of entities) {
    if (entity.kind === 'file') {
      const path = normalizePath(entity.filePath);
      const loc = entity.rawCounts?.linesOfCode;
      if (loc != null && loc > 0) {
        fileLinesMap.set(path, loc);
      }
    }
  }

  // 2. Collect duplicated line sets and clone IDs per file
  const fileDupLines = new Map<string, Set<number>>();
  const fileCloneIds = new Map<string, Set<string>>();
  let totalClones = 0;

  for (const signal of duplicationSignals) {
    for (const clone of signal.clones) {
      totalClones++;
      const locations = [clone.firstFile, clone.secondFile];

      for (const loc of locations) {
        const path = normalizePath(loc.filePath);

        if (!fileDupLines.has(path)) {
          fileDupLines.set(path, new Set());
        }
        const lineSet = fileDupLines.get(path)!;
        for (let line = loc.startLine; line <= loc.endLine; line++) {
          lineSet.add(line);
        }

        if (!fileCloneIds.has(path)) {
          fileCloneIds.set(path, new Set());
        }
        fileCloneIds.get(path)!.add(clone.id);
      }
    }
  }

  // 3. Per-file duplication results
  const allFilePaths = new Set([...fileLinesMap.keys(), ...fileDupLines.keys()]);
  const fileResults: FileDuplicationResult[] = [];

  for (const filePath of allFilePaths) {
    const totalLines = fileLinesMap.get(filePath) ?? 0;
    const dupLines = fileDupLines.get(filePath)?.size ?? 0;
    const cloneCount = fileCloneIds.get(filePath)?.size ?? 0;

    if (totalLines === 0 && dupLines === 0) continue;

    fileResults.push({
      filePath,
      duplicatedLines: dupLines,
      totalLines,
      duplicationPercentage: totalLines > 0 ? (dupLines / totalLines) * 100 : 0,
      cloneCount,
    });
  }

  // 4. Project-level statistics from signal data
  let projectTotalLines = 0;
  let projectDuplicatedLines = 0;

  for (const signal of duplicationSignals) {
    projectTotalLines += signal.statistics.totalLines;
    projectDuplicatedLines += signal.statistics.duplicatedLines;
  }

  const project: ProjectDuplicationResult = {
    totalLines: projectTotalLines,
    duplicatedLines: projectDuplicatedLines,
    duplicationPercentage:
      projectTotalLines > 0
        ? (projectDuplicatedLines / projectTotalLines) * 100
        : 0,
    totalClones,
  };

  // 5. Cross-module duplication
  const crossModuleMap = new Map<
    string,
    { cloneCount: number; totalDuplicatedLines: number }
  >();

  for (const signal of duplicationSignals) {
    for (const clone of signal.clones) {
      const firstMod = findModule(clone.firstFile.filePath, moduleBoundaries);
      const secondMod = findModule(clone.secondFile.filePath, moduleBoundaries);

      if (firstMod != null && secondMod != null && firstMod !== secondMod) {
        const [source, target] =
          firstMod < secondMod
            ? [firstMod, secondMod]
            : [secondMod, firstMod];
        const key = `${source}|${target}`;
        const lines =
          clone.firstFile.endLine -
          clone.firstFile.startLine +
          1 +
          (clone.secondFile.endLine - clone.secondFile.startLine + 1);

        const existing = crossModuleMap.get(key);
        if (existing) {
          existing.cloneCount++;
          existing.totalDuplicatedLines += lines;
        } else {
          crossModuleMap.set(key, { cloneCount: 1, totalDuplicatedLines: lines });
        }
      }
    }
  }

  const crossModule: CrossModuleDuplication[] = [];
  for (const [key, value] of crossModuleMap) {
    const [source, target] = key.split('|');
    crossModule.push({
      sourceModule: source,
      targetModule: target,
      cloneCount: value.cloneCount,
      totalDuplicatedLines: value.totalDuplicatedLines,
    });
  }

  // 6. Hotspots — top N files by duplication percentage
  const hotspots = [...fileResults]
    .filter((f) => f.duplicationPercentage > 0)
    .sort((a, b) => b.duplicationPercentage - a.duplicationPercentage)
    .slice(0, hotspotCount);

  return { project, files: fileResults, crossModule, hotspots };
}
