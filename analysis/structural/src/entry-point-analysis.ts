/**
 * @aspect/engine — Entry point reachability analysis
 *
 * Traces the import graph from application entry points to determine
 * which code is exclusive to a single app vs shared across multiple.
 *
 * Key distinction:
 *   - **App entry points** (bin scripts, server start files, web app main)
 *     are immovable roots. Their transitive dependencies define app scopes.
 *   - **Library entry points** (package main/exports) are NOT used as roots
 *     because the analyzer's job is to question whether library boundaries
 *     are optimal — not to reinforce them.
 *
 * Generic — works on any TypeScript/JavaScript monorepo. Reads entry point
 * metadata from ModuleBoundary.entryPoints (populated by the collector from
 * package.json bin/main/exports fields).
 */

import type { ModuleBoundary } from '@aspect/contracts';
import type { WeightedEdge, FileClassificationEntry } from './types.js';

// ── Public types ────────────────────────────────────────────────────────

/** Classification of a discovered app entry point. */
export interface AppEntryPoint {
  /** File ID (matches FileClassificationEntry.fileId). */
  fileId: string;
  /** Repo-relative file path. */
  filePath: string;
  /** The package this entry point belongs to. */
  packageId: string;
  /** How we know this is an app entry point. */
  evidence: EntryPointEvidence;
  /** The bin command name, if applicable. */
  name?: string;
}

export type EntryPointEvidence =
  | 'bin'             // package.json bin field
  | 'server-script'   // scripts.start / scripts.serve running a file
  | 'web-entry'       // Vite/webpack HTML entry (main.tsx, index.html)
  | 'extension-main'  // VS Code extension main field
  | 'heuristic';      // Fallback

/** Per-file reachability result. */
export interface FileReachability {
  fileId: string;
  filePath: string;
  /** Entry point IDs that can reach this file (empty = unreachable from any app). */
  reachableFrom: string[];
  /** Scope classification derived from reachability. */
  scope: FileScope;
}

export type FileScope =
  | 'app-exclusive'   // reachable from exactly one app entry point
  | 'shared'          // reachable from 2+ app entry points
  | 'unreachable'     // not reachable from any app entry point
  | 'entry-point';    // is an app entry point itself

/** Full result of entry point analysis. */
export interface EntryPointAnalysis {
  /** Discovered app entry points. */
  appEntryPoints: AppEntryPoint[];
  /** Per-file reachability and scope. */
  fileReachability: FileReachability[];
  /** Summary statistics. */
  summary: {
    appEntryPointCount: number;
    exclusiveFileCount: number;
    sharedFileCount: number;
    unreachableFileCount: number;
    /** Map from entry point fileId → count of exclusive files. */
    exclusiveCountByApp: Record<string, number>;
    /** File IDs shared across all entry points. */
    universallySharedFiles: string[];
  };
}

// ── App entry point discovery ────────────────────────────────────────────

/**
 * Detect app entry points from module boundaries.
 * Reads isAppEntry flags set by the collector from package.json analysis.
 * No heuristics — the manifest is the source of truth.
 */
export function discoverAppEntryPoints(
  moduleBoundaries: ModuleBoundary[],
  fileClassifications: FileClassificationEntry[],
): AppEntryPoint[] {
  const result: AppEntryPoint[] = [];
  const seen = new Set<string>();

  // Build lookup: filePath → fileId
  const pathToId = new Map<string, string>();
  for (const fc of fileClassifications) {
    const norm = fc.filePath.replace(/\\/g, '/');
    pathToId.set(norm, fc.fileId);
  }

  for (const mb of moduleBoundaries) {
    if (!mb.isPackage || !mb.entryPoints) continue;

    for (const ep of mb.entryPoints) {
      if (!ep.isAppEntry) continue;

      const norm = ep.file.replace(/\\/g, '/');
      const fileId = pathToId.get(norm);
      if (!fileId || seen.has(fileId)) continue;
      seen.add(fileId);

      result.push({
        fileId,
        filePath: norm,
        packageId: mb.moduleId,
        evidence: ep.kind === 'bin' ? 'bin'
          : ep.kind === 'browser' ? 'web-entry'
          : mb.appKind === 'extension' ? 'extension-main'
          : mb.appKind === 'web-app' ? 'web-entry'
          : mb.appKind === 'server' ? 'server-script'
          : 'heuristic',
        name: ep.name,
      });
    }
  }

  return result;
}

// ── Reachability analysis ────────────────────────────────────────────────

/**
 * BFS from each app entry point through the import graph.
 * Returns which entry points can reach each file.
 */
export function analyseReachability(
  appEntryPoints: AppEntryPoint[],
  weightedEdges: WeightedEdge[],
  fileClassifications: FileClassificationEntry[],
): FileReachability[] {
  // Build adjacency: source → targets (follow import direction)
  const adj = new Map<string, Set<string>>();
  for (const edge of weightedEdges) {
    let targets = adj.get(edge.sourceFileId);
    if (!targets) { targets = new Set(); adj.set(edge.sourceFileId, targets); }
    targets.add(edge.targetFileId);
  }

  const entryIds = new Set(appEntryPoints.map((ep) => ep.fileId));

  // BFS from each entry point
  const reachableFrom = new Map<string, Set<string>>();
  for (const ep of appEntryPoints) {
    const visited = new Set<string>();
    const queue = [ep.fileId];
    visited.add(ep.fileId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      // Record reachability
      let fromSet = reachableFrom.get(current);
      if (!fromSet) { fromSet = new Set(); reachableFrom.set(current, fromSet); }
      fromSet.add(ep.fileId);

      // Follow imports
      const targets = adj.get(current);
      if (targets) {
        for (const t of targets) {
          if (!visited.has(t)) {
            visited.add(t);
            queue.push(t);
          }
        }
      }
    }
  }

  // Build per-file results
  const codeFiles = fileClassifications.filter((f) => f.category === 'code');
  const results: FileReachability[] = [];

  for (const fc of codeFiles) {
    const from = reachableFrom.get(fc.fileId);
    const fromArray = from ? [...from] : [];

    let scope: FileScope;
    if (entryIds.has(fc.fileId)) {
      scope = 'entry-point';
    } else if (fromArray.length === 0) {
      scope = 'unreachable';
    } else if (fromArray.length === 1) {
      scope = 'app-exclusive';
    } else {
      scope = 'shared';
    }

    results.push({
      fileId: fc.fileId,
      filePath: fc.filePath,
      reachableFrom: fromArray,
      scope,
    });
  }

  return results;
}

// ── Combined analysis ────────────────────────────────────────────────────

/**
 * Run the full entry point analysis: discover app entries, then trace reachability.
 */
export function analyseEntryPoints(
  moduleBoundaries: ModuleBoundary[],
  fileClassifications: FileClassificationEntry[],
  weightedEdges: WeightedEdge[],
): EntryPointAnalysis {
  const appEntryPoints = discoverAppEntryPoints(
    moduleBoundaries, fileClassifications,
  );

  const fileReachability = analyseReachability(
    appEntryPoints, weightedEdges, fileClassifications,
  );

  // Build summary
  const exclusiveCountByApp: Record<string, number> = {};
  let exclusiveFileCount = 0;
  let sharedFileCount = 0;
  let unreachableFileCount = 0;
  const universallySharedFiles: string[] = [];
  const entryPointCount = appEntryPoints.length;

  for (const fr of fileReachability) {
    switch (fr.scope) {
      case 'app-exclusive':
        exclusiveFileCount++;
        exclusiveCountByApp[fr.reachableFrom[0]] =
          (exclusiveCountByApp[fr.reachableFrom[0]] ?? 0) + 1;
        break;
      case 'shared':
        sharedFileCount++;
        if (fr.reachableFrom.length === entryPointCount && entryPointCount > 1) {
          universallySharedFiles.push(fr.fileId);
        }
        break;
      case 'unreachable':
        unreachableFileCount++;
        break;
    }
  }

  return {
    appEntryPoints,
    fileReachability,
    summary: {
      appEntryPointCount: appEntryPoints.length,
      exclusiveFileCount,
      sharedFileCount,
      unreachableFileCount,
      exclusiveCountByApp,
      universallySharedFiles,
    },
  };
}
