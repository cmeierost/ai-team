/**
 * @aspect/engine — Filesystem-fit metrics
 *
 * Compares the actual filesystem structure (files grouped by directory)
 * against the desired structure (files grouped by cluster). Uses ARI,
 * NMI, and MoJoFM to quantify how well the on-disk layout matches the
 * dependency-derived clusters.
 */

import type { FileClassificationEntry, FileCluster } from './types.js';
import { parentDir, round3, buildFileClusterIndex } from './types.js';
import { computeARI, computeNMI } from './grouping-comparison.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface FilesystemFitResult {
  /** Adjusted Rand Index: -1 to 1, 1 = perfect match */
  adjustedRandIndex: number;
  /** Normalized Mutual Information: 0 to 1, 1 = perfect match */
  normalizedMutualInfo: number;
  /** MoJoFM: 0 to 100, 100 = perfect match */
  mojoFmScore: number;
  /** Number of files that need to move to match cluster structure */
  filesToMove: number;
  /** Total files compared */
  totalFiles: number;
  /** Per-directory alignment details */
  perDirectory: DirectoryFitInfo[];
}

export interface DirectoryFitInfo {
  directory: string;
  fileCount: number;
  /** How many different clusters share this directory */
  clusterCount: number;
  /** Dominant cluster ID */
  dominantClusterId: string;
  /** Ratio of files belonging to dominant cluster */
  dominantClusterRatio: number;
  /** Files that don't belong to the dominant cluster */
  misplacedFiles: MisplacedFileInfo[];
}

export interface MisplacedFileInfo {
  fileId: string;
  filePath: string;
  currentDirectory: string;
  currentClusterId: string;
  suggestedDirectory: string;
}

// ── Main entry ──────────────────────────────────────────────────────────

export function computeFilesystemFit(
  files: FileClassificationEntry[],
  clusters: FileCluster[],
): FilesystemFitResult {
  const codeFiles = files.filter((f) => f.category === 'code');
  if (codeFiles.length === 0) {
    return {
      adjustedRandIndex: 1,
      normalizedMutualInfo: 1,
      mojoFmScore: 100,
      filesToMove: 0,
      totalFiles: 0,
      perDirectory: [],
    };
  }

  // Build file → cluster mapping (first cluster wins for multi-cluster files)
  const fileClusterIndex = buildFileClusterIndex(clusters);
  const fileToCluster = new Map<string, string>();
  let singletonIdx = 0;
  for (const f of codeFiles) {
    const clusterIds = fileClusterIndex.get(f.fileId);
    if (clusterIds && clusterIds.length > 0) {
      fileToCluster.set(f.fileId, clusterIds[0]);
    } else {
      fileToCluster.set(f.fileId, `singleton-${singletonIdx++}`);
    }
  }

  // Build file → directory mapping
  const fileToDir = new Map<string, string>();
  for (const f of codeFiles) {
    fileToDir.set(f.fileId, parentDir(f.filePath));
  }

  // Build label arrays for ARI / NMI
  const dirLabels = new Map<string, number>();
  const clusterLabelMap = new Map<string, number>();
  const labelsA: number[] = [];
  const labelsB: number[] = [];

  for (const f of codeFiles) {
    const dir = fileToDir.get(f.fileId)!;
    const cluster = fileToCluster.get(f.fileId)!;

    if (!dirLabels.has(dir)) dirLabels.set(dir, dirLabels.size);
    if (!clusterLabelMap.has(cluster)) clusterLabelMap.set(cluster, clusterLabelMap.size);

    labelsA.push(dirLabels.get(dir)!);
    labelsB.push(clusterLabelMap.get(cluster)!);
  }

  const adjustedRandIndex = round3(computeARI(labelsA, labelsB));
  const normalizedMutualInfo = round3(Math.max(0, computeNMI(labelsA, labelsB)));

  // Build cluster → dominant directory
  const clusterDirCounts = new Map<string, Map<string, number>>();
  for (const f of codeFiles) {
    const cluster = fileToCluster.get(f.fileId)!;
    const dir = fileToDir.get(f.fileId)!;
    let dirCounts = clusterDirCounts.get(cluster);
    if (!dirCounts) { dirCounts = new Map(); clusterDirCounts.set(cluster, dirCounts); }
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  const clusterDominantDir = new Map<string, string>();
  for (const [cluster, dirCounts] of clusterDirCounts) {
    let bestDir = '';
    let bestCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > bestCount) { bestCount = count; bestDir = dir; }
    }
    clusterDominantDir.set(cluster, bestDir);
  }

  // Count misplaced files (not in their cluster's dominant directory)
  let filesToMove = 0;
  for (const f of codeFiles) {
    const cluster = fileToCluster.get(f.fileId)!;
    const dir = fileToDir.get(f.fileId)!;
    const dominantDir = clusterDominantDir.get(cluster)!;
    if (dir !== dominantDir) filesToMove++;
  }

  // MoJoFM = (1 - moves / max_moves) × 100
  const uniqueClusters = new Set(fileToCluster.values()).size;
  const maxMoves = codeFiles.length - uniqueClusters;
  const mojoFmScore = maxMoves <= 0
    ? 100
    : round3(Math.max(0, (1 - filesToMove / maxMoves)) * 100);

  // Per-directory breakdown
  const dirFiles = new Map<string, FileClassificationEntry[]>();
  for (const f of codeFiles) {
    const dir = fileToDir.get(f.fileId)!;
    let list = dirFiles.get(dir);
    if (!list) { list = []; dirFiles.set(dir, list); }
    list.push(f);
  }

  const perDirectory: DirectoryFitInfo[] = [];
  for (const [dir, dirFileList] of dirFiles) {
    const clusterCounts = new Map<string, number>();
    for (const f of dirFileList) {
      const cluster = fileToCluster.get(f.fileId)!;
      clusterCounts.set(cluster, (clusterCounts.get(cluster) ?? 0) + 1);
    }

    let dominantClusterId = '';
    let dominantCount = 0;
    for (const [clusterId, count] of clusterCounts) {
      if (count > dominantCount) { dominantCount = count; dominantClusterId = clusterId; }
    }

    const dominantClusterRatio = round3(dominantCount / dirFileList.length);

    const misplacedFiles: MisplacedFileInfo[] = [];
    for (const f of dirFileList) {
      const cluster = fileToCluster.get(f.fileId)!;
      if (cluster !== dominantClusterId) {
        const suggestedDir = clusterDominantDir.get(cluster) ?? dir;
        misplacedFiles.push({
          fileId: f.fileId,
          filePath: f.filePath,
          currentDirectory: dir,
          currentClusterId: cluster,
          suggestedDirectory: suggestedDir,
        });
      }
    }

    perDirectory.push({
      directory: dir,
      fileCount: dirFileList.length,
      clusterCount: clusterCounts.size,
      dominantClusterId,
      dominantClusterRatio,
      misplacedFiles,
    });
  }

  perDirectory.sort((a, b) => a.directory.localeCompare(b.directory));

  return {
    adjustedRandIndex,
    normalizedMutualInfo,
    mojoFmScore,
    filesToMove,
    totalFiles: codeFiles.length,
    perDirectory,
  };
}
