/**
 * @aspect/engine — Step 9: Recommendations
 *
 * Consumes the full structural pipeline result and produces
 * prioritised, actionable recommendations. This is the layer
 * that makes the pipeline useful to humans — it translates raw
 * metrics into specific "do this next" instructions.
 *
 * Categories:
 *   file-move       — file lives in the wrong directory
 *   cluster-split   — cluster is too large or mixes concerns
 *   folder-cleanup  — directory is unfocused / tangled
 *   bridge-decouple — high-centrality bridge file needs abstraction
 *   cohesion-split  — file has poor internal cohesion (high LCOM4)
 *   cycle-break     — dependency cycle to break
 */

import type {
  StructuralPipelineResult, PipelineRecommendation,
  RecommendationPriority, RecommendationCategory,
} from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fileName(fp: string): string {
  const parts = fp.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? fp;
}

let nextId = 0;
function recId(cat: RecommendationCategory): string {
  return `${cat}-${++nextId}`;
}

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

const MAX_RECOMMENDATIONS = 25;

// ── Recommendation generators ───────────────────────────────────────────

function fileMoveRecs(result: StructuralPipelineResult): PipelineRecommendation[] {
  const recs: PipelineRecommendation[] = [];
  if (!result.communities?.misplacedFiles) return recs;

  for (const mf of result.communities.misplacedFiles) {
    recs.push({
      id: recId('file-move'),
      priority: mf.peerCount >= 5 ? 'high' : 'medium',
      category: 'file-move',
      title: `Move ${fileName(mf.filePath)} → ${mf.suggestedDirectory}`,
      description:
        `${fileName(mf.filePath)} is in ${mf.currentDirectory} but its dependency community ` +
        `(${mf.communityId}) has ${mf.peerCount} peers in ${mf.suggestedDirectory}.`,
      fileIds: [mf.fileId],
      filePaths: [mf.filePath],
      impact: clamp(mf.peerCount / 15, 0.1, 1),
    });
  }

  // Also from grouping comparison suggestions
  const alreadySuggested = new Set(result.communities.misplacedFiles.map((mf) => mf.fileId));
  for (const comp of result.groupingComparisons ?? []) {
    for (const sug of comp.suggestions) {
      if (alreadySuggested.has(sug.fileId)) continue;
      alreadySuggested.add(sug.fileId);
      recs.push({
        id: recId('file-move'),
        priority: 'medium',
        category: 'file-move',
        title: `Move ${fileName(sug.filePath)} from ${sug.fromGroup} → ${sug.toGroup}`,
        description: sug.reason,
        fileIds: [sug.fileId],
        filePaths: [sug.filePath],
        impact: 0.3,
      });
    }
  }

  return recs;
}

function clusterSplitRecs(result: StructuralPipelineResult): PipelineRecommendation[] {
  const recs: PipelineRecommendation[] = [];

  for (const cq of result.alignment.clusterQuality) {
    if (cq.hasMixedConcerns && cq.concernConflict) {
      recs.push({
        id: recId('cluster-split'),
        priority: cq.fileCount > 10 ? 'critical' : 'high',
        category: 'cluster-split',
        title: `Split cluster ${cq.clusterId} — mixes ${cq.concernConflict}`,
        description:
          `Cluster has ${cq.fileCount} files mixing ${cq.concernConflict}. ` +
          `Separate these concerns into distinct modules.`,
        fileIds: [],
        filePaths: [],
        impact: clamp(cq.fileCount / 20, 0.3, 1),
      });
    }

    if (cq.spansPackages && cq.packageCount > 2) {
      recs.push({
        id: recId('cluster-split'),
        priority: 'high',
        category: 'cluster-split',
        title: `Cluster ${cq.clusterId} spans ${cq.packageCount} packages`,
        description:
          `Tightly coupled files spread across ${cq.packages.join(', ')}. ` +
          `Consolidate into one package or introduce an abstraction boundary.`,
        fileIds: [],
        filePaths: [],
        impact: clamp(cq.packageCount / 5, 0.3, 0.9),
      });
    }
  }

  return recs;
}

function folderCleanupRecs(result: StructuralPipelineResult): PipelineRecommendation[] {
  const recs: PipelineRecommendation[] = [];

  // Tangled directories (from community detection)
  for (const td of result.communities?.tangledDirectories ?? []) {
    recs.push({
      id: recId('folder-cleanup'),
      priority: td.communityCount > 5 ? 'critical' : 'high',
      category: 'folder-cleanup',
      title: `Untangle ${td.directory} — ${td.communityCount} communities in one folder`,
      description:
        `${td.fileCount} files from ${td.communityCount} different dependency communities share this directory. ` +
        `Split into sub-directories that match the community structure.`,
      fileIds: [],
      filePaths: [],
      impact: clamp(td.communityCount / 8, 0.3, 1),
    });
  }

  // Unfocused folders (from step 7)
  for (const ff of result.alignment.folderFocus) {
    if (ff.assessment === 'mixed' && ff.fileCount > 3) {
      recs.push({
        id: recId('folder-cleanup'),
        priority: 'medium',
        category: 'folder-cleanup',
        title: `Reorganize ${ff.folderPath} — mixed roles and clusters`,
        description:
          `Focus score ${ff.focusScore}: ${ff.clusterCount} clusters and ${ff.roleCount} roles. ` +
          `Files serving different purposes should be in separate directories.`,
        fileIds: [],
        filePaths: [],
        impact: clamp((1 - ff.focusScore) * 0.7, 0.1, 0.7),
      });
    }
  }

  return recs;
}

function bridgeDecoupleRecs(result: StructuralPipelineResult): PipelineRecommendation[] {
  const recs: PipelineRecommendation[] = [];
  if (!result.centrality) return recs;

  for (const fc of result.centrality) {
    if (!fc.isBridge) continue;
    recs.push({
      id: recId('bridge-decouple'),
      priority: fc.betweenness > 0.15 ? 'high' : 'medium',
      category: 'bridge-decouple',
      title: `Decouple bridge file ${fileName(fc.filePath)}`,
      description:
        `Betweenness centrality ${fc.betweenness} — this file bridges clusters ` +
        `${fc.bridgeBetween?.[0] ?? '?'} and ${fc.bridgeBetween?.[1] ?? '?'}. ` +
        `Extract an interface or split responsibilities to reduce coupling risk.`,
      fileIds: [fc.fileId],
      filePaths: [fc.filePath],
      impact: clamp(fc.betweenness * 3, 0.2, 1),
    });
  }

  return recs;
}

function cohesionSplitRecs(result: StructuralPipelineResult): PipelineRecommendation[] {
  const recs: PipelineRecommendation[] = [];

  for (const f of result.fileClassifications) {
    if (f.lcom4 != null && f.lcom4 > 2) {
      recs.push({
        id: recId('cohesion-split'),
        priority: f.lcom4 >= 4 ? 'high' : 'medium',
        category: 'cohesion-split',
        title: `Split ${fileName(f.filePath)} — LCOM4 = ${f.lcom4}`,
        description:
          `This file has ${f.lcom4} disconnected method groups that don't share state. ` +
          `Each group is a separate responsibility and should be its own file.`,
        fileIds: [f.fileId],
        filePaths: [f.filePath],
        impact: clamp((f.lcom4 - 1) / 5, 0.2, 0.9),
      });
    }
  }

  return recs;
}

// ── Health score ────────────────────────────────────────────────────────

export function calculateHealthScore(result: StructuralPipelineResult): number {
  let score = 100;

  // Warnings penalty (max -30)
  const criticals = result.alignment.warnings.filter((w) => w.severity === 'critical').length;
  const warnings = result.alignment.warnings.filter((w) => w.severity === 'warning').length;
  score -= Math.min(30, criticals * 8 + warnings * 3);

  // Community alignment penalty (max -25)
  const refDirComp = result.groupingComparisons?.find(
    (c) => c.sourceId === 'reference' && c.targetId === 'directory',
  );
  if (refDirComp) {
    score -= Math.round((1 - refDirComp.ari) * 25);
  }

  // Misplaced files penalty (max -15)
  const misplaced = result.communities?.misplacedFiles.length ?? 0;
  score -= Math.min(15, misplaced * 2);

  // Cluster quality penalty (max -15)
  const mixedClusters = result.alignment.clusterQuality.filter((c) => c.hasMixedConcerns).length;
  score -= Math.min(15, mixedClusters * 5);

  // Cohesion penalty (max -15)
  const lowCohesionFiles = result.fileClassifications.filter(
    (f) => f.lcom4 != null && f.lcom4 > 2,
  ).length;
  score -= Math.min(15, lowCohesionFiles * 3);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function splitFileRecs(result: StructuralPipelineResult): PipelineRecommendation[] {
  const recs: PipelineRecommendation[] = [];
  if (!result.communities?.splitFileCandidates) return recs;

  for (const sf of result.communities.splitFileCandidates) {
    if (sf.communityCount < 2) continue;
    const breakdown = sf.communityBreakdown
      .map((b) => `${b.communityId} (${b.entityCount} entities, ${b.entityLoc} LOC)`)
      .join(', ');
    recs.push({
      id: recId('cohesion-split'),
      priority: sf.communityCount >= 3 ? 'high' : 'medium',
      category: 'cohesion-split',
      title: `Split ${fileName(sf.filePath)} — entities in ${sf.communityCount} communities`,
      description:
        `This file has entities landing in ${sf.communityCount} different communities: ${breakdown}. ` +
        `Each community's entities should be in their own file.`,
      fileIds: [sf.fileId],
      filePaths: [sf.filePath],
      impact: clamp((sf.communityCount - 1) / 4, 0.2, 0.9),
    });
  }

  return recs;
}

// ── Main entry point ────────────────────────────────────────────────────

export function generateRecommendations(
  result: StructuralPipelineResult,
): { recommendations: PipelineRecommendation[]; healthScore: number } {
  nextId = 0;

  const allRecs = [
    ...clusterSplitRecs(result),
    ...fileMoveRecs(result),
    ...bridgeDecoupleRecs(result),
    ...cohesionSplitRecs(result),
    ...splitFileRecs(result),
    ...folderCleanupRecs(result),
  ];

  allRecs.sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pd !== 0) return pd;
    return b.impact - a.impact;
  });

  const recommendations = allRecs.slice(0, MAX_RECOMMENDATIONS);
  const healthScore = calculateHealthScore(result);

  return { recommendations, healthScore };
}
