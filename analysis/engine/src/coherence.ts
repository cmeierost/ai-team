// @aspect/engine — Structural coherence calculator
// Compares actual folder structure against dependency-graph communities
// to expose organizational mismatches.

import type { Entity, Relationship } from '@aspect/contracts';
import { buildDependencyGraph, detectCommunities } from './graph-metrics.js';
import type { SourceLocation } from './location.js';
import { buildLocationMap } from './location.js';

// ── Result types ────────────────────────────────────────────────────────

/** A grouping of files by their directory path at a given depth */
export interface DirectoryGroup {
  /** Directory path (relative to root, forward slashes) */
  directory: string;
  /** Entity IDs of files in this directory (and subdirectories) */
  entityIds: string[];
  /** Number of files */
  fileCount: number;
}

/** Cross-reference flow between two directory groups */
export interface CrossReference {
  /** Source directory */
  sourceDirectory: string;
  /** Target directory */
  targetDirectory: string;
  /** Number of import relationships from source to target */
  referenceCount: number;
  /** Entity ID pairs */
  references: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    sourceLocation?: SourceLocation;
    targetLocation?: SourceLocation;
  }>;
}

/** A detected dependency community mapped to the directories it spans */
export interface CommunityMapping {
  /** Community ID from Louvain detection */
  communityId: string;
  /** Entity IDs in this community */
  entityIds: string[];
  /** Which directories this community spans */
  directories: string[];
  /** How many directories this community spans (higher = more scattered) */
  directorySpread: number;
  /** Ratio of files in the dominant directory vs total (1.0 = perfectly located) */
  concentrationRatio: number;
}

/** A file that lives in a different folder from most of its community */
export interface MisplacedFile {
  entityId: string;
  filePath: string;
  /** Current directory */
  currentDirectory: string;
  /** Community it belongs to */
  communityId: string;
  /** Where most of its community peers live */
  suggestedDirectory: string;
  /** Number of peers in current dir vs suggested dir */
  peersInCurrentDir: number;
  peersInSuggestedDir: number;
}

/** A directory that contains files from many different communities (should be split) */
export interface TangledDirectory {
  directory: string;
  /** Number of distinct communities represented in this directory */
  communityCount: number;
  /** Largest community fraction (low = very tangled) */
  dominantCommunityRatio: number;
  /** Community breakdown */
  communities: Array<{ communityId: string; fileCount: number }>;
}

/** Cross-reference matrix between directories */
export interface DirectoryCouplingMatrix {
  /** Directory names (row/column labels) */
  directories: string[];
  /** matrix[i][j] = number of references from directories[i] to directories[j] */
  matrix: number[][];
}

/** Full coherence analysis result */
export interface CoherenceResult {
  /** How well dependency clusters match folder structure (0-1, higher = better) */
  overallCoherenceScore: number;
  /** Directory groupings used for analysis */
  directoryGroups: DirectoryGroup[];
  /** Cross-reference flows between directories */
  crossReferences: CrossReference[];
  /** Coupling matrix between directories */
  couplingMatrix: DirectoryCouplingMatrix;
  /** Community-to-directory mappings */
  communityMappings: CommunityMapping[];
  /** Files that appear misplaced relative to their community */
  misplacedFiles: MisplacedFile[];
  /** Directories that mix too many communities (candidates for splitting) */
  tangledDirectories: TangledDirectory[];
  /** Directories with zero outgoing/incoming cross-refs (well isolated) */
  isolatedDirectories: string[];
}

export interface CoherenceOptions {
  /** Directory depth for grouping (default: computed automatically) */
  directoryDepth?: number;
  /** Minimum files in a directory group to include (default: 1) */
  minGroupSize?: number;
  /** Threshold for tangled directory detection — max dominant community ratio (default: 0.6) */
  tangledThreshold?: number;
  /** Minimum community size to include in analysis (default: 2) */
  minCommunitySize?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function getDirectory(filePath: string, depth: number): string {
  const parts = normalizePath(filePath).split('/');
  // Remove the filename (last segment)
  const dirParts = parts.slice(0, -1);
  const truncated = dirParts.slice(0, depth);
  return truncated.join('/') || '.';
}

function maxPathDepth(filePaths: string[]): number {
  let max = 0;
  for (const fp of filePaths) {
    // directory segments = total segments - 1 (filename)
    const depth = normalizePath(fp).split('/').length - 1;
    if (depth > max) max = depth;
  }
  return max;
}

function autoDetectDepth(filePaths: string[]): number {
  const maxDepth = maxPathDepth(filePaths);
  for (let d = 1; d <= maxDepth; d++) {
    const groups = new Set(filePaths.map((fp) => getDirectory(fp, d)));
    if (groups.size >= 3 && groups.size <= 30) return d;
  }
  // If we never hit 3..30, pick the depth that gives the most groups (capped at maxDepth)
  // or fall back to 1
  if (maxDepth === 0) return 1;
  let bestDepth = 1;
  let bestCount = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const count = new Set(filePaths.map((fp) => getDirectory(fp, d))).size;
    if (count > bestCount) {
      bestCount = count;
      bestDepth = d;
    }
  }
  return bestDepth;
}

// ── Main calculator ─────────────────────────────────────────────────────

export function calculateCoherence(
  entities: Entity[],
  relationships: Relationship[],
  options?: CoherenceOptions,
): CoherenceResult {
  const minGroupSize = options?.minGroupSize ?? 1;
  const tangledThreshold = options?.tangledThreshold ?? 0.6;
  const minCommunitySize = options?.minCommunitySize ?? 2;
  const locationMap = buildLocationMap(entities);

  // Filter to file-kind entities only, excluding external/third-party paths.
  // dep-cruiser creates entities for Node built-ins (bare names like 'path', 'fs')
  // and relative external refs ('../something'). Only keep proper source paths.
  const fileEntities = entities.filter(
    (e) =>
      e.kind === 'file' &&
      e.filePath != null &&
      normalizePath(e.filePath).includes('/') &&
      !normalizePath(e.filePath).startsWith('../') &&
      !normalizePath(e.filePath).includes('node_modules/'),
  );

  if (fileEntities.length === 0) {
    return {
      overallCoherenceScore: 1,
      directoryGroups: [],
      crossReferences: [],
      couplingMatrix: { directories: [], matrix: [] },
      communityMappings: [],
      misplacedFiles: [],
      tangledDirectories: [],
      isolatedDirectories: [],
    };
  }

  const fileEntityIds = new Set(fileEntities.map((e) => e.id));
  const filePaths = fileEntities.map((e) => normalizePath(e.filePath));

  // 1. Determine directory depth
  const depth =
    options?.directoryDepth ?? autoDetectDepth(filePaths);

  // 2. Group files by directory
  const dirToEntityIds = new Map<string, string[]>();
  const entityIdToDir = new Map<string, string>();
  for (const e of fileEntities) {
    const dir = getDirectory(e.filePath, depth);
    entityIdToDir.set(e.id, dir);
    const list = dirToEntityIds.get(dir) ?? [];
    list.push(e.id);
    dirToEntityIds.set(dir, list);
  }

  // Apply minGroupSize filter
  const directoryGroups: DirectoryGroup[] = [];
  for (const [dir, ids] of dirToEntityIds) {
    if (ids.length >= minGroupSize) {
      directoryGroups.push({
        directory: dir,
        entityIds: ids.sort(),
        fileCount: ids.length,
      });
    }
  }
  directoryGroups.sort((a, b) => a.directory.localeCompare(b.directory));

  const includedDirs = new Set(directoryGroups.map((g) => g.directory));

  // 3. Build cross-reference matrix
  const crossRefMap = new Map<string, CrossReference>();
  const filteredRels = relationships.filter(
    (r) =>
      fileEntityIds.has(r.sourceEntityId) &&
      fileEntityIds.has(r.targetEntityId) &&
      !r.thirdParty,
  );

  for (const r of filteredRels) {
    const srcDir = entityIdToDir.get(r.sourceEntityId);
    const tgtDir = entityIdToDir.get(r.targetEntityId);
    if (
      srcDir == null ||
      tgtDir == null ||
      srcDir === tgtDir ||
      !includedDirs.has(srcDir) ||
      !includedDirs.has(tgtDir)
    ) {
      continue;
    }
    const key = `${srcDir}->${tgtDir}`;
    const existing = crossRefMap.get(key);
    if (existing) {
      existing.referenceCount++;
      existing.references.push({
        sourceEntityId: r.sourceEntityId,
        targetEntityId: r.targetEntityId,
        sourceLocation: locationMap.get(r.sourceEntityId),
        targetLocation: locationMap.get(r.targetEntityId),
      });
    } else {
      crossRefMap.set(key, {
        sourceDirectory: srcDir,
        targetDirectory: tgtDir,
        referenceCount: 1,
        references: [
          {
            sourceEntityId: r.sourceEntityId,
            targetEntityId: r.targetEntityId,
            sourceLocation: locationMap.get(r.sourceEntityId),
            targetLocation: locationMap.get(r.targetEntityId),
          },
        ],
      });
    }
  }

  const crossReferences = [...crossRefMap.values()].sort(
    (a, b) => b.referenceCount - a.referenceCount,
  );

  // 4. Build coupling matrix
  const dirList = directoryGroups.map((g) => g.directory);
  const dirIndex = new Map(dirList.map((d, i) => [d, i]));
  const matrix: number[][] = dirList.map(() => dirList.map(() => 0));

  for (const cr of crossReferences) {
    const i = dirIndex.get(cr.sourceDirectory);
    const j = dirIndex.get(cr.targetDirectory);
    if (i != null && j != null) {
      matrix[i][j] = cr.referenceCount;
    }
  }

  const couplingMatrix: DirectoryCouplingMatrix = {
    directories: dirList,
    matrix,
  };

  // 5. Run community detection (reuse graph-metrics)
  const graph = buildDependencyGraph(fileEntities, filteredRels);
  const communityResult = detectCommunities(graph);

  // 6. Map communities to directories
  const communityMappings: CommunityMapping[] = [];
  const entityToCommunity = new Map<string, string>();

  for (const community of communityResult.communities) {
    // Only include entities that are in our file set
    const memberIds = community.entityIds.filter((id) => fileEntityIds.has(id));
    if (memberIds.length < minCommunitySize) continue;

    for (const id of memberIds) {
      entityToCommunity.set(id, community.id);
    }

    // Count files per directory
    const dirCounts = new Map<string, number>();
    for (const id of memberIds) {
      const dir = entityIdToDir.get(id);
      if (dir != null && includedDirs.has(dir)) {
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }
    }

    const directories = [...dirCounts.keys()].sort();
    const maxCount = Math.max(...dirCounts.values(), 0);
    const total = memberIds.filter(
      (id) => entityIdToDir.get(id) != null && includedDirs.has(entityIdToDir.get(id)!),
    ).length;

    communityMappings.push({
      communityId: community.id,
      entityIds: memberIds.sort(),
      directories,
      directorySpread: directories.length,
      concentrationRatio: total > 0 ? maxCount / total : 1,
    });
  }

  // 7. Find misplaced files
  const misplacedFiles: MisplacedFile[] = [];

  for (const mapping of communityMappings) {
    // Find dominant directory for this community
    const dirCounts = new Map<string, number>();
    for (const id of mapping.entityIds) {
      const dir = entityIdToDir.get(id);
      if (dir != null && includedDirs.has(dir)) {
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }
    }

    let dominantDir = '';
    let dominantCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantDir = dir;
      }
    }

    for (const id of mapping.entityIds) {
      const currentDir = entityIdToDir.get(id);
      if (
        currentDir == null ||
        !includedDirs.has(currentDir) ||
        currentDir === dominantDir
      ) {
        continue;
      }

      const peersInCurrentDir = dirCounts.get(currentDir) ?? 0;
      const peersInSuggestedDir = dominantCount;

      // Only flag if suggested directory has at least 2x more peers
      if (peersInSuggestedDir >= peersInCurrentDir * 2) {
        const entity = fileEntities.find((e) => e.id === id);
        misplacedFiles.push({
          entityId: id,
          filePath: entity ? normalizePath(entity.filePath) : id,
          currentDirectory: currentDir,
          communityId: mapping.communityId,
          suggestedDirectory: dominantDir,
          peersInCurrentDir,
          peersInSuggestedDir,
        });
      }
    }
  }

  // Sort misplaced files by gap (peersInSuggestedDir - peersInCurrentDir) descending
  misplacedFiles.sort(
    (a, b) =>
      b.peersInSuggestedDir -
      b.peersInCurrentDir -
      (a.peersInSuggestedDir - a.peersInCurrentDir),
  );

  // 8. Find tangled directories
  const tangledDirectories: TangledDirectory[] = [];

  for (const group of directoryGroups) {
    const communityCounts = new Map<string, number>();
    for (const id of group.entityIds) {
      const cid = entityToCommunity.get(id);
      if (cid != null) {
        communityCounts.set(cid, (communityCounts.get(cid) ?? 0) + 1);
      }
    }

    if (communityCounts.size <= 1) continue;

    const communities = [...communityCounts.entries()]
      .map(([communityId, fileCount]) => ({ communityId, fileCount }))
      .sort((a, b) => b.fileCount - a.fileCount);

    const totalMapped = communities.reduce((s, c) => s + c.fileCount, 0);
    const dominantRatio =
      totalMapped > 0 ? communities[0].fileCount / totalMapped : 1;

    if (dominantRatio <= tangledThreshold) {
      tangledDirectories.push({
        directory: group.directory,
        communityCount: communities.length,
        dominantCommunityRatio: dominantRatio,
        communities,
      });
    }
  }

  // 9. Find isolated directories (zero cross-references in either direction)
  const dirsWithCrossRefs = new Set<string>();
  for (const cr of crossReferences) {
    dirsWithCrossRefs.add(cr.sourceDirectory);
    dirsWithCrossRefs.add(cr.targetDirectory);
  }
  const isolatedDirectories = dirList
    .filter((d) => !dirsWithCrossRefs.has(d))
    .sort();

  // 10. Calculate overall coherence score
  // Weighted average of concentrationRatio across communities
  let totalWeight = 0;
  let weightedSum = 0;
  for (const mapping of communityMappings) {
    const weight = mapping.entityIds.length;
    weightedSum += mapping.concentrationRatio * weight;
    totalWeight += weight;
  }
  const overallCoherenceScore =
    totalWeight > 0 ? weightedSum / totalWeight : 1;

  return {
    overallCoherenceScore,
    directoryGroups,
    crossReferences,
    couplingMatrix,
    communityMappings,
    misplacedFiles,
    tangledDirectories,
    isolatedDirectories,
  };
}
