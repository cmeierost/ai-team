/**
 * @aspect/engine — Step 7: Community glob fingerprinting
 *
 * For each community, produce a set of glob patterns that best describe
 * its file membership:
 *
 *   1. Find the best-matching parent folder (highest file overlap)
 *   2. Filter to matching file extensions
 *   3. Exclude sub-folders that don't belong
 *   4. Result: globs + precision/recall metrics
 *
 * These globs serve as the community's "fingerprint" for naming and
 * for generating structural recommendations.
 */

import type { Community } from './types.js';
import { parentDir } from './types.js';
import * as path from 'path';

export interface CommunityGlobFingerprint {
  communityId: string;
  /** Glob patterns that best describe this community's files. */
  globs: string[];
  /** Community files matched by the globs. */
  matchedFiles: string[];
  /** Community files NOT matched by any glob. */
  unmatchedFiles: string[];
  /** matchedFiles / totalCommunityFiles. */
  recall: number;
  /** Suggested community label derived from globs + dominant role. */
  suggestedLabel: string;
}

export interface CommunityGlobResult {
  fingerprints: CommunityGlobFingerprint[];
}

/**
 * For each community, find glob patterns that best describe its file membership.
 */
export function computeCommunityGlobs(
  communities: Community[],
  allFilePaths: string[],
): CommunityGlobResult {
  const allFileSet = new Set(allFilePaths.map(normalizePath));
  const fingerprints: CommunityGlobFingerprint[] = [];

  for (const community of communities) {
    if (community.memberFileIds.length === 0) continue;
    const fp = fingerprintCommunity(community, allFileSet);
    fingerprints.push(fp);
  }

  return { fingerprints };
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function fingerprintCommunity(
  community: Community,
  allFiles: Set<string>,
): CommunityGlobFingerprint {
  const memberPaths = community.memberFileIds.map(normalizePath);

  // 1. Find the best parent folder — the one containing the most community members
  const folderCounts = new Map<string, number>();
  for (const fp of memberPaths) {
    let dir = parentDir(fp);
    while (dir && dir !== '.') {
      folderCounts.set(dir, (folderCounts.get(dir) ?? 0) + 1);
      const parent = parentDir(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Score folders by: (community files in folder) / (total files in folder)
  // weighted by coverage of community members
  const folderScores: { folder: string; coverage: number; precision: number }[] = [];
  for (const [folder, count] of folderCounts) {
    const coverage = count / memberPaths.length;
    // Count all repo files in this folder
    let totalInFolder = 0;
    for (const f of allFiles) {
      if (f.startsWith(folder + '/') || f === folder) totalInFolder++;
    }
    const precision = totalInFolder > 0 ? count / totalInFolder : 0;
    folderScores.push({ folder, coverage, precision });
  }

  // Prefer folders with high coverage, then high precision
  folderScores.sort((a, b) => {
    // Minimum 50% coverage required
    const aCov = a.coverage >= 0.5 ? 1 : 0;
    const bCov = b.coverage >= 0.5 ? 1 : 0;
    if (aCov !== bCov) return bCov - aCov;
    // Among qualifying folders, prefer the most specific (deepest)
    const aDepth = a.folder.split('/').length;
    const bDepth = b.folder.split('/').length;
    if (aDepth !== bDepth) return bDepth - aDepth;
    return b.precision - a.precision;
  });

  const bestFolder = folderScores[0]?.folder ?? '';
  const memberSet = new Set(memberPaths);

  // 2. Determine dominant file extensions
  const extCounts = new Map<string, number>();
  for (const fp of memberPaths) {
    const ext = path.extname(fp);
    if (ext) extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }

  // Keep extensions that cover at least 10% of community files
  const significantExts = [...extCounts.entries()]
    .filter(([, count]) => count / memberPaths.length >= 0.1)
    .map(([ext]) => ext);

  // 3. Build glob patterns
  const globs: string[] = [];

  if (bestFolder && significantExts.length > 0) {
    if (significantExts.length === 1) {
      globs.push(`${bestFolder}/**/*${significantExts[0]}`);
    } else {
      const extGroup = `{${significantExts.join(',')}}`;
      globs.push(`${bestFolder}/**/*${extGroup}`);
    }
  } else if (bestFolder) {
    globs.push(`${bestFolder}/**/*`);
  }

  // 4. Compute matched/unmatched
  const matchedFiles: string[] = [];
  const unmatchedFiles: string[] = [];

  for (const fp of memberPaths) {
    const inBestFolder = bestFolder && fp.startsWith(bestFolder + '/');
    const hasMatchingExt = significantExts.length === 0 || significantExts.some((ext) => fp.endsWith(ext));
    if (inBestFolder && hasMatchingExt) {
      matchedFiles.push(fp);
    } else {
      unmatchedFiles.push(fp);
    }
  }

  const recall = memberPaths.length > 0
    ? Math.round((matchedFiles.length / memberPaths.length) * 1000) / 1000
    : 0;

  // 5. Derive a suggested label
  const folderName = bestFolder ? bestFolder.split('/').pop() ?? bestFolder : 'misc';
  const role = community.dominantRole ?? 'mixed';
  const tech = community.dominantTechnology ?? '';
  const labelParts = [folderName];
  if (tech && tech !== folderName) labelParts.push(tech);
  labelParts.push(`(${role})`);
  const suggestedLabel = labelParts.join(' ');

  return {
    communityId: community.id,
    globs,
    matchedFiles,
    unmatchedFiles,
    recall,
    suggestedLabel,
  };
}
