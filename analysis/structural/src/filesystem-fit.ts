/**
 * @aspect/engine — Filesystem-fit metrics
 *
 * Compares the actual filesystem structure (files grouped by directory)
 * against the desired structure (files grouped by cluster). Uses ARI,
 * NMI, and MoJoFM to quantify how well the on-disk layout matches the
 * dependency-derived clusters.
 */

import type { FileClassificationEntry, Community } from './types.js';
import { parentDir, round3, buildFileCommunityIndex } from './types.js';
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
  communities: Community[],
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

  // Build file → community mapping (first community wins for multi-community files)
  const fileCommunityIndex = buildFileCommunityIndex(communities);
  const fileToCommunity = new Map<string, string>();
  let singletonIdx = 0;
  for (const f of codeFiles) {
    const communityIds = fileCommunityIndex.get(f.fileId);
    if (communityIds && communityIds.length > 0) {
      fileToCommunity.set(f.fileId, communityIds[0]);
    } else {
      fileToCommunity.set(f.fileId, `singleton-${singletonIdx++}`);
    }
  }

  // Build file → directory mapping
  const fileToDir = new Map<string, string>();
  for (const f of codeFiles) {
    fileToDir.set(f.fileId, parentDir(f.filePath));
  }

  // Build label arrays for ARI / NMI
  const dirLabels = new Map<string, number>();
  const communityLabelMap = new Map<string, number>();
  const labelsA: number[] = [];
  const labelsB: number[] = [];

  for (const f of codeFiles) {
    const dir = fileToDir.get(f.fileId)!;
    const community = fileToCommunity.get(f.fileId)!;

    if (!dirLabels.has(dir)) dirLabels.set(dir, dirLabels.size);
    if (!communityLabelMap.has(community)) communityLabelMap.set(community, communityLabelMap.size);

    labelsA.push(dirLabels.get(dir)!);
    labelsB.push(communityLabelMap.get(community)!);
  }

  const adjustedRandIndex = round3(computeARI(labelsA, labelsB));
  const normalizedMutualInfo = round3(Math.max(0, computeNMI(labelsA, labelsB)));

  // Build community → dominant directory
  const communityDirCounts = new Map<string, Map<string, number>>();
  for (const f of codeFiles) {
    const community = fileToCommunity.get(f.fileId)!;
    const dir = fileToDir.get(f.fileId)!;
    let dirCounts = communityDirCounts.get(community);
    if (!dirCounts) { dirCounts = new Map(); communityDirCounts.set(community, dirCounts); }
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  const communityDominantDir = new Map<string, string>();
  for (const [community, dirCounts] of communityDirCounts) {
    let bestDir = '';
    let bestCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > bestCount) { bestCount = count; bestDir = dir; }
    }
    communityDominantDir.set(community, bestDir);
  }

  // Count misplaced files (not in their community's dominant directory)
  let filesToMove = 0;
  for (const f of codeFiles) {
    const community = fileToCommunity.get(f.fileId)!;
    const dir = fileToDir.get(f.fileId)!;
    const dominantDir = communityDominantDir.get(community)!;
    if (dir !== dominantDir) filesToMove++;
  }

  // MoJoFM = (1 - moves / max_moves) × 100
  const uniqueCommunities = new Set(fileToCommunity.values()).size;
  const maxMoves = codeFiles.length - uniqueCommunities;
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
    const communityCounts = new Map<string, number>();
    for (const f of dirFileList) {
      const community = fileToCommunity.get(f.fileId)!;
      communityCounts.set(community, (communityCounts.get(community) ?? 0) + 1);
    }

    let dominantClusterId = '';
    let dominantCount = 0;
    for (const [communityId, count] of communityCounts) {
      if (count > dominantCount) { dominantCount = count; dominantClusterId = communityId; }
    }

    const dominantClusterRatio = round3(dominantCount / dirFileList.length);

    const misplacedFiles: MisplacedFileInfo[] = [];
    for (const f of dirFileList) {
      const community = fileToCommunity.get(f.fileId)!;
      if (community !== dominantClusterId) {
        const suggestedDir = communityDominantDir.get(community) ?? dir;
        misplacedFiles.push({
          fileId: f.fileId,
          filePath: f.filePath,
          currentDirectory: dir,
          currentClusterId: community,
          suggestedDirectory: suggestedDir,
        });
      }
    }

    perDirectory.push({
      directory: dir,
      fileCount: dirFileList.length,
      clusterCount: communityCounts.size,
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
