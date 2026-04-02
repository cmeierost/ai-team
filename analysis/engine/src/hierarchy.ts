/**
 * @aspect/engine — Hierarchy distance & utility-file calculator
 *
 * Analyses folder hierarchy of import relationships:
 * - How far apart are files that reference each other?
 * - Which files are "utility" files (high fan-in, low fan-out)?
 * - Which relationships cross many folder boundaries?
 */

import type { Entity, Relationship } from '@aspect/contracts';
import type { SourceLocation } from './location.js';
import { buildLocationMap } from './location.js';

// ── Result types ────────────────────────────────────────────────────────

export interface HierarchyMetrics {
  /** Per-relationship distance metrics */
  relationships: RelationshipDistance[];
  /** Distribution of folder distances */
  distanceDistribution: DistanceDistribution;
  /** Files detected as utilities (high fan-in, low fan-out) */
  utilityFiles: UtilityFile[];
  /** Suspicious long-distance relationships (excluding utilities) */
  longDistanceImports: LongDistanceImport[];
}

export interface RelationshipDistance {
  sourceEntityId: string;
  targetEntityId: string;
  sourceLocation?: SourceLocation;
  targetLocation?: SourceLocation;
  /** Number of directory levels from source up to common ancestor */
  upDistance: number;
  /** Number of directory levels from common ancestor down to target */
  downDistance: number;
  /** Total distance = upDistance + downDistance */
  totalDistance: number;
  /** Common ancestor directory path */
  commonAncestor: string;
}

export interface DistanceDistribution {
  /** Count of relationships at each total distance (index = distance) */
  histogram: number[];
  /** Average distance across all relationships */
  mean: number;
  /** Median distance */
  median: number;
  /** 90th percentile distance */
  p90: number;
}

export interface UtilityFile {
  entityId: string;
  filePath: string;
  /** Number of files that import this file (fan-in) */
  fanIn: number;
  /** Number of files this file imports (fan-out) */
  fanOut: number;
  /** fanIn / (fanIn + fanOut) — high ratio = utility */
  utilityRatio: number;
}

export interface LongDistanceImport {
  sourceEntityId: string;
  targetEntityId: string;
  sourceLocation?: SourceLocation;
  targetLocation?: SourceLocation;
  /** The folder distance */
  totalDistance: number;
  /** Why this is flagged */
  reason: string;
}

// ── Options ─────────────────────────────────────────────────────────────

export interface HierarchyOptions {
  /** Distance threshold above which imports are flagged (default: 4) */
  longDistanceThreshold?: number;
  /** Fan-in threshold to consider a file a utility (default: 5) */
  utilityFanInThreshold?: number;
  /** Utility ratio threshold (default: 0.8) */
  utilityRatioThreshold?: number;
  /** Only analyze relationships between files (skip function/method/class level) */
  fileRelationshipsOnly?: boolean;
}

// ── Folder distance ─────────────────────────────────────────────────────

/**
 * Normalise a file path to forward-slash segments.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Return directory segments for a file path (excludes the filename).
 */
function dirSegments(filePath: string): string[] {
  const parts = normalizePath(filePath).split('/');
  // Drop the last segment (the filename)
  return parts.slice(0, -1);
}

/**
 * Calculate folder distance between two file paths.
 *
 * @example
 *   'packages/core/src/agent/index.ts' → 'packages/core/src/llm/index.ts'
 *   Common ancestor: 'packages/core/src'
 *   Up distance: 1 (agent → src)
 *   Down distance: 1 (src → llm)
 *   Total: 2
 */
export function calculateFolderDistance(
  sourcePath: string,
  targetPath: string,
): {
  upDistance: number;
  downDistance: number;
  totalDistance: number;
  commonAncestor: string;
} {
  const srcDirs = dirSegments(sourcePath);
  const tgtDirs = dirSegments(targetPath);

  // Find longest common prefix
  let commonLen = 0;
  const maxLen = Math.min(srcDirs.length, tgtDirs.length);
  while (commonLen < maxLen && srcDirs[commonLen] === tgtDirs[commonLen]) {
    commonLen++;
  }

  const upDistance = srcDirs.length - commonLen;
  const downDistance = tgtDirs.length - commonLen;
  const commonAncestor = srcDirs.slice(0, commonLen).join('/');

  return {
    upDistance,
    downDistance,
    totalDistance: upDistance + downDistance,
    commonAncestor,
  };
}

// ── Distribution helpers ────────────────────────────────────────────────

function buildDistribution(distances: number[]): DistanceDistribution {
  if (distances.length === 0) {
    return { histogram: [], mean: 0, median: 0, p90: 0 };
  }

  const maxDist = Math.max(...distances);
  const histogram = new Array<number>(maxDist + 1).fill(0);
  for (const d of distances) {
    histogram[d]++;
  }

  const sum = distances.reduce((a, b) => a + b, 0);
  const mean = sum / distances.length;

  const sorted = [...distances].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const p90Index = Math.ceil(sorted.length * 0.9) - 1;
  const p90 = sorted[Math.min(p90Index, sorted.length - 1)];

  return { histogram, mean, median, p90 };
}

// ── Main calculator ─────────────────────────────────────────────────────

function isNodeModules(filePath: string): boolean {
  const norm = normalizePath(filePath);
  return norm.startsWith('node_modules/') || norm.includes('/node_modules/');
}

/** Returns true for external/built-in paths that aren't real source files. */
function isExternalPath(filePath: string): boolean {
  const norm = normalizePath(filePath);
  // Bare names without '/' (e.g. 'path', 'fs', 'stream') are Node built-ins
  if (!norm.includes('/')) return true;
  // Relative paths escaping the project root
  if (norm.startsWith('../')) return true;
  return isNodeModules(norm);
}

export function calculateHierarchyMetrics(
  entities: Entity[],
  relationships: Relationship[],
  options?: HierarchyOptions,
): HierarchyMetrics {
  const longDistanceThreshold = options?.longDistanceThreshold ?? 4;
  const utilityFanInThreshold = options?.utilityFanInThreshold ?? 5;
  const utilityRatioThreshold = options?.utilityRatioThreshold ?? 0.8;
  const fileRelationshipsOnly = options?.fileRelationshipsOnly ?? false;

  // Build entity lookup
  const entityMap = new Map<string, Entity>();
  for (const e of entities) {
    entityMap.set(e.id, e);
  }

  const locationMap = buildLocationMap(entities);

  // Determine which entity IDs are file-level
  const fileEntityIds = new Set<string>();
  for (const e of entities) {
    if (e.kind === 'file') {
      fileEntityIds.add(e.id);
    }
  }

  // Filter relationships
  const filteredRels = relationships.filter((r) => {
    if (fileRelationshipsOnly) {
      return fileEntityIds.has(r.sourceEntityId) && fileEntityIds.has(r.targetEntityId);
    }
    return true;
  });

  // Resolve the file path for an entity (for non-file entities, use filePath)
  function getFilePath(entityId: string): string | undefined {
    const ent = entityMap.get(entityId);
    return ent?.filePath;
  }

  // Calculate per-relationship distances
  const relDistances: RelationshipDistance[] = [];
  for (const r of filteredRels) {
    const srcPath = getFilePath(r.sourceEntityId);
    const tgtPath = getFilePath(r.targetEntityId);
    if (srcPath == null || tgtPath == null) continue;

    const dist = calculateFolderDistance(srcPath, tgtPath);
    relDistances.push({
      sourceEntityId: r.sourceEntityId,
      targetEntityId: r.targetEntityId,
      sourceLocation: locationMap.get(r.sourceEntityId),
      targetLocation: locationMap.get(r.targetEntityId),
      ...dist,
    });
  }

  // Build distance distribution
  const allDistances = relDistances.map((r) => r.totalDistance);
  const distanceDistribution = buildDistribution(allDistances);

  // Fan-in / fan-out per file entity for utility detection
  const fanIn = new Map<string, Set<string>>();
  const fanOut = new Map<string, Set<string>>();

  for (const r of filteredRels) {
    const srcPath = getFilePath(r.sourceEntityId);
    const tgtPath = getFilePath(r.targetEntityId);
    if (srcPath == null || tgtPath == null) continue;

    // Use file paths for deduplication (same file may have multiple entities)
    if (!fanOut.has(srcPath)) fanOut.set(srcPath, new Set());
    if (!fanIn.has(tgtPath)) fanIn.set(tgtPath, new Set());
    if (srcPath !== tgtPath) {
      fanOut.get(srcPath)!.add(tgtPath);
      fanIn.get(tgtPath)!.add(srcPath);
    }
  }

  // Detect utility files
  const utilityFilePaths = new Set<string>();
  const utilityFiles: UtilityFile[] = [];

  // Build filePath → entityId map (use the file entity if present)
  const filePathToEntityId = new Map<string, string>();
  for (const e of entities) {
    if (e.kind === 'file') {
      filePathToEntityId.set(normalizePath(e.filePath), e.id);
    }
  }
  // Fallback: any entity's filePath
  for (const e of entities) {
    const norm = normalizePath(e.filePath);
    if (!filePathToEntityId.has(norm)) {
      filePathToEntityId.set(norm, e.id);
    }
  }

  const allFilePaths = new Set<string>([...fanIn.keys(), ...fanOut.keys()]);
  for (const fp of allFilePaths) {
    if (isExternalPath(fp)) continue;
    const inCount = fanIn.get(fp)?.size ?? 0;
    const outCount = fanOut.get(fp)?.size ?? 0;
    const total = inCount + outCount;
    if (total === 0) continue;
    const ratio = inCount / total;

    if (inCount >= utilityFanInThreshold && ratio >= utilityRatioThreshold) {
      utilityFilePaths.add(normalizePath(fp));
      const entityId = filePathToEntityId.get(normalizePath(fp)) ?? fp;
      utilityFiles.push({
        entityId,
        filePath: fp,
        fanIn: inCount,
        fanOut: outCount,
        utilityRatio: ratio,
      });
    }
  }

  // Sort utilities by utility ratio descending
  utilityFiles.sort((a, b) => b.utilityRatio - a.utilityRatio);

  // Detect long-distance imports
  const longDistanceImports: LongDistanceImport[] = [];
  for (const rd of relDistances) {
    if (rd.totalDistance <= longDistanceThreshold) continue;

    const tgtPath = getFilePath(rd.targetEntityId);
    if (tgtPath == null) continue;
    if (isExternalPath(tgtPath)) continue;

    const srcPath = getFilePath(rd.sourceEntityId);
    if (srcPath != null && isExternalPath(srcPath)) continue;

    // Skip if target is a utility file
    if (utilityFilePaths.has(normalizePath(tgtPath))) continue;

    longDistanceImports.push({
      sourceEntityId: rd.sourceEntityId,
      targetEntityId: rd.targetEntityId,
      sourceLocation: locationMap.get(rd.sourceEntityId),
      targetLocation: locationMap.get(rd.targetEntityId),
      totalDistance: rd.totalDistance,
      reason: `Import crosses ${rd.totalDistance} directory levels (threshold: ${longDistanceThreshold}) and target is not a utility file`,
    });
  }

  // Sort by distance descending
  longDistanceImports.sort((a, b) => b.totalDistance - a.totalDistance);

  return {
    relationships: relDistances,
    distanceDistribution,
    utilityFiles,
    longDistanceImports,
  };
}
