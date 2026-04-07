/**
 * @aspect/engine — Move suggestions
 *
 * Generates concrete file-move suggestions with rationale, impact
 * metrics, confidence, and priority. For each file whose directory
 * does not match its cluster's dominant directory, a suggestion is
 * produced explaining why the file should move and what effect it
 * would have on modularity.
 */

import type { FileClassificationEntry, FileCluster, WeightedEdge } from './types.js';
import { parentDir, round3, buildFileClusterIndex } from './types.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface MoveSuggestion {
  fileId: string;
  filePath: string;
  currentDirectory: string;
  suggestedDirectory: string;
  rationale: string;
  impact: MoveImpact;
  confidence: 'high' | 'medium' | 'low';
  priority: number; // 0-100, higher = more urgent
}

export interface MoveImpact {
  /** How much modularity improves if this file moves */
  deltaModularity: number;
  /** How many cross-cluster edges this removes */
  crossClusterEdgesRemoved: number;
  /** How many same-cluster edges this adds */
  sameClusterEdgesAdded: number;
  /** LOC being moved */
  fileLoc: number;
}

export interface MoveSuggestionResult {
  suggestions: MoveSuggestion[];
  totalFilesToMove: number;
  estimatedModularityGain: number;
}

// ── Main entry ──────────────────────────────────────────────────────────

export function generateMoveSuggestions(
  files: FileClassificationEntry[],
  clusters: FileCluster[],
  weightedEdges: WeightedEdge[],
): MoveSuggestionResult {
  const codeFiles = files.filter((f) => f.category === 'code');
  if (codeFiles.length === 0 || clusters.length === 0) {
    return { suggestions: [], totalFilesToMove: 0, estimatedModularityGain: 0 };
  }

  // Build file → cluster mapping (first cluster wins)
  const fileClusterIndex = buildFileClusterIndex(clusters);
  const fileToCluster = new Map<string, string>();
  for (const f of codeFiles) {
    const clusterIds = fileClusterIndex.get(f.fileId);
    if (clusterIds && clusterIds.length > 0) {
      fileToCluster.set(f.fileId, clusterIds[0]);
    }
  }

  // Build file → directory and lookup maps
  const fileToDir = new Map<string, string>();
  const fileLocMap = new Map<string, number>();
  for (const f of codeFiles) {
    fileToDir.set(f.fileId, parentDir(f.filePath));
    fileLocMap.set(f.fileId, f.linesOfCode ?? 0);
  }

  // Build cluster member sets
  const clusterMembers = new Map<string, Set<string>>();
  for (const c of clusters) {
    clusterMembers.set(c.id, new Set(c.fileIds));
  }

  // Build cluster → dominant directory
  const clusterDirCounts = new Map<string, Map<string, number>>();
  const clusterTotalFiles = new Map<string, number>();
  for (const c of clusters) {
    const dirCounts = new Map<string, number>();
    for (const fileId of c.fileIds) {
      const dir = fileToDir.get(fileId);
      if (dir != null) {
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }
    }
    clusterDirCounts.set(c.id, dirCounts);
    clusterTotalFiles.set(c.id, c.fileIds.length);
  }

  const clusterDominantDir = new Map<string, string>();
  const clusterDominantDirCount = new Map<string, number>();
  for (const [clusterId, dirCounts] of clusterDirCounts) {
    let bestDir = '';
    let bestCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > bestCount) { bestCount = count; bestDir = dir; }
    }
    clusterDominantDir.set(clusterId, bestDir);
    clusterDominantDirCount.set(clusterId, bestCount);
  }

  // Build per-file edge adjacency
  const totalEdgeWeight = weightedEdges.reduce((sum, e) => sum + e.weight, 0);
  const fileEdges = new Map<string, WeightedEdge[]>();
  for (const edge of weightedEdges) {
    let srcList = fileEdges.get(edge.sourceFileId);
    if (!srcList) { srcList = []; fileEdges.set(edge.sourceFileId, srcList); }
    srcList.push(edge);
    let tgtList = fileEdges.get(edge.targetFileId);
    if (!tgtList) { tgtList = []; fileEdges.set(edge.targetFileId, tgtList); }
    tgtList.push(edge);
  }

  // Generate suggestions
  const suggestions: MoveSuggestion[] = [];
  let totalModularityGain = 0;

  for (const f of codeFiles) {
    const clusterId = fileToCluster.get(f.fileId);
    if (!clusterId) continue; // unclustered — no suggestion

    const currentDir = fileToDir.get(f.fileId)!;
    const suggestedDir = clusterDominantDir.get(clusterId)!;

    if (currentDir === suggestedDir) continue; // already in correct directory

    const memberSet = clusterMembers.get(clusterId)!;
    const edges = fileEdges.get(f.fileId) ?? [];

    // Impact: count edge changes from the move
    let crossClusterEdgesRemoved = 0;
    let sameClusterEdgesAdded = 0;

    for (const edge of edges) {
      const otherFileId = edge.sourceFileId === f.fileId ? edge.targetFileId : edge.sourceFileId;
      const otherDir = fileToDir.get(otherFileId);
      const otherInCluster = memberSet.has(otherFileId);

      if (otherInCluster && otherDir === suggestedDir) {
        sameClusterEdgesAdded++;
      }
      if (!otherInCluster && otherDir === currentDir) {
        crossClusterEdgesRemoved++;
      }
    }

    const deltaModularity = totalEdgeWeight > 0
      ? round3((sameClusterEdgesAdded - crossClusterEdgesRemoved) / totalEdgeWeight)
      : 0;

    const fileLoc = fileLocMap.get(f.fileId) ?? 0;

    // Confidence based on how dominant the suggested directory is
    const totalInCluster = clusterTotalFiles.get(clusterId) ?? 1;
    const dominantCount = clusterDominantDirCount.get(clusterId) ?? 0;
    const dominantRatio = dominantCount / totalInCluster;
    const confidence: 'high' | 'medium' | 'low' =
      dominantRatio > 0.8 ? 'high' :
        dominantRatio > 0.5 ? 'medium' : 'low';

    // Priority: high cross-cluster coupling, large file, low intra-cluster coupling
    const edgeCount = edges.length;
    const crossClusterRatio = edgeCount > 0
      ? edges.filter((e) => {
        const other = e.sourceFileId === f.fileId ? e.targetFileId : e.sourceFileId;
        return !memberSet.has(other);
      }).length / edgeCount
      : 0;

    const priority = Math.round(
      Math.min(100, (
        crossClusterRatio * 40 +
        Math.min(fileLoc / 300, 1) * 30 +
        (1 - (sameClusterEdgesAdded / Math.max(edgeCount, 1))) * 30
      )),
    );

    // Rationale
    const rationale =
      `${dominantCount} of ${totalInCluster} cluster files are in ${suggestedDir}, ` +
      `but this file is in ${currentDir}`;

    totalModularityGain += deltaModularity;

    suggestions.push({
      fileId: f.fileId,
      filePath: f.filePath,
      currentDirectory: currentDir,
      suggestedDirectory: suggestedDir,
      rationale,
      impact: {
        deltaModularity,
        crossClusterEdgesRemoved,
        sameClusterEdgesAdded,
        fileLoc,
      },
      confidence,
      priority,
    });
  }

  // Sort by priority descending (higher = more urgent)
  suggestions.sort((a, b) => b.priority - a.priority);

  return {
    suggestions,
    totalFilesToMove: suggestions.length,
    estimatedModularityGain: round3(totalModularityGain),
  };
}
