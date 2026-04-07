/**
 * @aspect/engine — Centrality analysis
 *
 * Computes betweenness centrality and PageRank from the pipeline's
 * weighted edge graph. Identifies bridge files — high-centrality
 * nodes that connect different clusters.
 */

import Graph from 'graphology';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness.js';
import pagerank from 'graphology-metrics/centrality/pagerank.js';

import type {
  WeightedEdge, FileClassificationEntry, Community,
  FileCentrality,
} from './types.js';
import { round3, buildFileCommunityIndex } from './types.js';

// ── Centrality computation ──────────────────────────────────────────────

export function computeCentrality(
  weightedEdges: WeightedEdge[],
  fileClassifications: FileClassificationEntry[],
  communities: Community[],
): FileCentrality[] {
  const codeFiles = fileClassifications.filter((f) => f.category === 'code');
  if (codeFiles.length < 2) return [];

  const pathMap = new Map(codeFiles.map((f) => [f.fileId, f.filePath]));

  // Build directed graph
  const graph = new Graph({ type: 'directed', multi: false });
  for (const f of codeFiles) graph.mergeNode(f.fileId);

  for (const edge of weightedEdges) {
    if (!graph.hasNode(edge.sourceFileId) || !graph.hasNode(edge.targetFileId)) continue;
    if (edge.sourceFileId === edge.targetFileId) continue;
    const key = `${edge.sourceFileId}->${edge.targetFileId}`;
    if (graph.hasEdge(key)) {
      const w = (graph.getEdgeAttribute(key, 'weight') as number) ?? 0;
      graph.setEdgeAttribute(key, 'weight', w + edge.weight);
    } else {
      graph.addEdgeWithKey(key, edge.sourceFileId, edge.targetFileId, { weight: edge.weight });
    }
  }

  if (graph.size === 0) return [];

  // Betweenness centrality
  const bc = betweennessCentrality(graph, { normalized: true });
  // PageRank
  const pr = pagerank(graph, { alpha: 0.85, maxIterations: 100, tolerance: 1e-6, getEdgeWeight: 'weight' });

  // Build community index for bridge detection
  const fileCommunityIdx = buildFileCommunityIndex(communities);

  const results: FileCentrality[] = [];
  for (const f of codeFiles) {
    const betweenness = round3(bc[f.fileId] ?? 0);
    const prScore = round3(pr[f.fileId] ?? 0);

    // Bridge detection: high centrality file that appears in ≥2 communities
    const communityIds = fileCommunityIdx.get(f.fileId) ?? [];
    const isBridge = betweenness > 0.05 && communityIds.length >= 2;

    results.push({
      fileId: f.fileId,
      filePath: pathMap.get(f.fileId) ?? f.fileId,
      betweenness,
      pageRank: prScore,
      isBridge,
      bridgeBetween: isBridge && communityIds.length >= 2
        ? [communityIds[0], communityIds[1]]
        : undefined,
    });
  }

  results.sort((a, b) => b.betweenness - a.betweenness);
  return results;
}
