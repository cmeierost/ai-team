/**
 * @aspect/engine — Structural pipeline orchestrator
 *
 * Runs the full structural analysis pipeline from collector output:
 *
 *   1. File classification    → FileCategory per file
 *   2. Code classification    → CodeContentRole per code file (+LCOM4)
 *   3. Import analysis        → Raw edges + per-file coupling stats
 *   4. Edge weighting         → Weighted edges (incl. folder distance)
 *   5. Community detection    → Louvain communities + misplaced files
 *   6. Package comparison     → Package alignment scores
 *   7. Folder comparison      → Folder focus scores
 *   6–7b. Grouping comparison → ARI / NMI (reference vs directory vs boundary)
 *   8. Optimization           → Cluster quality, split candidates, warnings
 *   8b. Centrality            → Betweenness centrality, bridge file detection
 *   9. Recommendations        → Prioritised actionable suggestions + health score
 *
 * Steps 6–8 are run together via `analyseStructuralAlignment()`.
 */

import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';
import { calculateComplexity } from '@aspect/complexity';

import {
  classifyByFilename,
  type FileClassification,
  type FileCategory,
} from './1-file-classification.js';
import {
  classifyCodeContent,
  type ContentClassification,
  type CodeContentRole,
} from './2-code-classification.js';
import { buildRawEdges, computeFileCouplingStats } from './3-import-analysis.js';
import { weightAllEdges } from './4-edge-weighting.js';
import { analyseStructuralAlignment } from './8-optimization.js';
import { detectCommunities } from './community-detection.js';
import { compareAllGroupings } from './grouping-comparison.js';
import { computeCentrality } from './centrality.js';
import { generateRecommendations } from './9-recommendations.js';
import { computeFilesystemFit } from './filesystem-fit.js';
import { generateMoveSuggestions } from './move-suggestions.js';
import { analyseExports } from './export-analysis.js';
import { analyseEntryPoints } from './entry-point-analysis.js';
import { computeFileInterfaceMetrics } from './file-metrics.js';
import { computeShallownessDiagnostics } from './shallowness-diagnostics.js';
import { computeReferenceDiagnostics } from './reference-diagnostics.js';
import { computeCanonicalLocMetrics } from './loc-metrics.js';
import { computeNonQualifiedDiagnostics } from './nonqualified-diagnostics.js';
import { computeRoleSeparation } from './role-separation.js';
import { computeHierarchySummary } from './hierarchy-analysis.js';
import { computeInventorySummary } from './inventory-summary.js';
import { computeCoverageValidation } from './coverage-validation.js';
import { classifyAllEntities } from './entity-classification.js';

import type { LanguageProfile, MergedFileHints } from './language-profile.js';
import { mergeFileHints, findProfileForExtension } from './language-profile.js';
import { TYPESCRIPT_PROFILE } from './profiles/typescript.js';

import type {
  FileInfo,
  StructuralFileInfo,
  WeightedEdge,
  StructuralAlignmentResult,
  FileClassificationEntry,
  StructuralPipelineResult,
  PipelineSummary,
  StructuralPipelineOptions,
  WarningThresholds,
  EntityGraphArtefact,
  CommunityMapArtefact,
} from './types.js';
import { DEFAULT_THRESHOLDS } from './types.js';

// ── Pipeline runner ─────────────────────────────────────────────────────

/**
 * Run the full structural analysis pipeline from collector output.
 */
export function runStructuralPipeline(
  entities: Entity[],
  relationships: Relationship[],
  moduleBoundaries: ModuleBoundary[],
  options?: StructuralPipelineOptions
): StructuralPipelineResult {
  const thresholds: WarningThresholds = { ...DEFAULT_THRESHOLDS, ...options?.thresholds };

  // Resolve language profiles (default to TypeScript for backwards compat)
  const profiles: LanguageProfile[] = options?.profiles ?? [TYPESCRIPT_PROFILE];
  const fileHints: MergedFileHints = mergeFileHints(profiles);

  // Build module → package mapping
  const fileToPackage = new Map<string, string>();
  for (const mb of moduleBoundaries) {
    if (mb.isPackage) {
      for (const fp of mb.files) {
        fileToPackage.set(fp, mb.moduleId);
      }
    }
  }

  // ── Step 1: Classify files by filename ──────────────────────────────

  const fileEntities = entities.filter((e) => e.kind === 'file');
  const fileClassifications: FileClassificationEntry[] = [];
  const fileInfoMap = new Map<string, FileInfo>();

  for (const entity of fileEntities) {
    const filePath = entity.filePath ?? entity.name;
    const fc = classifyByFilename(filePath, fileHints);

    const entry: FileClassificationEntry = {
      fileId: entity.id,
      filePath,
      category: fc.category,
      linesOfCode: entity.rawCounts?.linesOfCode ?? undefined,
      packageId: fileToPackage.get(filePath),
      fileClassification: fc,
    };

    fileClassifications.push(entry);
    fileInfoMap.set(entity.id, {
      fileId: entity.id,
      filePath,
      category: fc.category,
    });
  }

  // ── Step 2: Classify code content ───────────────────────────────────

  const childEntities = entities.filter((e) => e.kind !== 'file' && e.parentEntityId);
  const fileChildMap = new Map<string, Entity[]>();
  for (const child of childEntities) {
    const pid = child.parentEntityId!;
    let list = fileChildMap.get(pid);
    if (!list) {
      list = [];
      fileChildMap.set(pid, list);
    }
    list.push(child);
  }

  const fileCouplingStats = computeFileCouplingStats(entities, relationships);

  for (const entry of fileClassifications) {
    if (entry.category !== 'code') continue;

    const children = fileChildMap.get(entry.fileId) ?? [];
    const entityKinds = children.map((c) => ({
      kind: c.kind as any,
      name: c.name,
      isExported: c.classification?.isExported ?? false,
      linesOfCode: c.rawCounts?.linesOfCode ?? 0,
      jsxElementCount: (c as any).jsxElementCount ?? (c.rawCounts as any)?.jsxElementCount ?? 0,
    }));

    const coupling = fileCouplingStats.get(entry.fileId);
    const ext = extname(entry.filePath);
    const fileProfile = findProfileForExtension(ext, profiles);

    const cc = classifyCodeContent({
      filePath: entry.filePath,
      fileExtension: ext,
      entities: entityKinds,
      coupling,
      profile: fileProfile,
    });

    entry.contentRole = cc.role;
    entry.contentClassification = cc;

    const info = fileInfoMap.get(entry.fileId);
    if (info) info.contentRole = cc.role;
  }

  // ── Step 2b: LCOM4 enrichment ────────────────────────────────────────

  for (const entry of fileClassifications) {
    if (entry.category !== 'code') continue;
    const children = fileChildMap.get(entry.fileId) ?? [];
    let worstLcom4 = 0;
    for (const child of children) {
      if (child.kind !== 'class') continue;
      const matrix = (child as any).methodFieldAccessMatrix as
        | Array<{ methodName: string; accessedFields: string[] }>
        | undefined;
      if (!matrix || matrix.length < 2) continue;
      const score = computeLcom4(matrix);
      if (score > worstLcom4) worstLcom4 = score;
    }
    if (worstLcom4 > 0) entry.lcom4 = worstLcom4;
  }

  // ── Step 3: Build raw edges ─────────────────────────────────────────

  const rawEdges = buildRawEdges(entities, relationships);

  // ── Step 4: Weight edges ────────────────────────────────────────────

  const weightedEdges = weightAllEdges(rawEdges, fileInfoMap);

  // ── Artefact 1: Entity dependency graph ─────────────────────────────
  // Self-contained checkpoint after steps 1–4.

  const entityGraph: EntityGraphArtefact = {
    fileClassifications,
    weightedEdges,
    fileInfoMap: Object.fromEntries(fileInfoMap),
  };

  // ── Step 5: Community detection (Louvain) ────────────────────────────

  const communities = detectCommunities(weightedEdges, fileClassifications, entities);

  // ── Artefact 2: Community map ─────────────────────────────────────────

  const communityMap: CommunityMapArtefact = {
    communities: communities.communities,
    communityGroups: communities.communityGroups,
    crossGroupEdges: communities.crossGroupEdges,
    splitFileCandidates: communities.splitFileCandidates,
    modularity: communities.modularity,
    clusterExposure: communities.clusterExposure,
    communityGroupExposure: communities.communityGroupExposure,
    misplacedFiles: communities.misplacedFiles,
    tangledDirectories: communities.tangledDirectories,
  };

  // ── Steps 6–8: Structural alignment ─────────────────────────────────

  const structFiles: StructuralFileInfo[] = fileClassifications.map((f) => ({
    fileId: f.fileId,
    filePath: f.filePath,
    category: f.category,
    contentRole: f.contentRole,
    packageId: f.packageId,
    linesOfCode: f.linesOfCode,
  }));

  const alignment = analyseStructuralAlignment(structFiles, communities.communities, thresholds);

  // ── Filesystem-fit metrics ──────────────────────────────────────────

  const filesystemFit = computeFilesystemFit(fileClassifications, communities.communities);

  // ── Move suggestions ──────────────────────────────────────────────

  const moveSuggestions = generateMoveSuggestions(
    fileClassifications,
    communities.communities,
    weightedEdges
  );

  // ── Steps 6–7b: Grouping comparison (ARI / NMI) ───────────────────

  const groupingComparisons =
    communities.communities.length > 0
      ? compareAllGroupings(communities.communities, fileClassifications)
      : [];

  // ── Step 8b: Centrality + bridge detection ─────────────────────────

  const centrality = computeCentrality(weightedEdges, fileClassifications, communities.communities);

  // Add bridge-file warnings
  for (const fc of centrality) {
    if (fc.isBridge) {
      alignment.warnings.push({
        kind: 'bridge-file',
        severity: fc.betweenness > 0.15 ? 'critical' : 'warning',
        target: fc.filePath,
        message: `Betweenness ${fc.betweenness} — bridges clusters ${fc.bridgeBetween?.[0] ?? '?'} and ${fc.bridgeBetween?.[1] ?? '?'}`,
        value: fc.betweenness,
        threshold: 0.05,
      });
    }
  }

  // Add LCOM4 warnings
  for (const f of fileClassifications) {
    if (f.lcom4 != null && f.lcom4 > 2) {
      alignment.warnings.push({
        kind: 'low-cohesion',
        severity: f.lcom4 >= 4 ? 'critical' : 'warning',
        target: f.filePath,
        message: `LCOM4 = ${f.lcom4} — ${f.lcom4} disconnected method groups in one file`,
        value: f.lcom4,
        threshold: 2,
      });
    }
  }

  // Add community-based warnings
  for (const mf of communities.misplacedFiles) {
    alignment.warnings.push({
      kind: 'misplaced-file',
      severity: mf.peerCount >= 5 ? 'critical' : 'warning',
      target: mf.filePath,
      message: `Dependency community is in ${mf.suggestedDirectory} (${mf.peerCount} peers) but file is in ${mf.currentDirectory}`,
      value: mf.peerCount,
      threshold: 2,
    });
  }
  for (const td of communities.tangledDirectories) {
    alignment.warnings.push({
      kind: 'tangled-directory',
      severity: td.communityCount > 5 ? 'critical' : 'warning',
      target: td.directory,
      message: `${td.communityCount} dependency communities share this directory (${td.fileCount} files)`,
      value: td.communityCount,
      threshold: 3,
    });
  }

  // Re-sort all warnings by severity
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alignment.warnings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ── Export analysis ──────────────────────────────────────────────────

  const exportAnalysis = analyseExports(entities, relationships);

  // ── Entry point reachability analysis ──────────────────────────────

  const entryPointAnalysis = analyseEntryPoints(
    moduleBoundaries,
    fileClassifications,
    weightedEdges
  );

  // ── File-level interface/change-cost metrics ───────────────────────

  const fileMetrics = computeFileInterfaceMetrics(
    entities,
    fileClassifications,
    weightedEdges,
    exportAnalysis,
    communities
  );

  // ── Shallowness diagnostics ─────────────────────────────────────────

  const shallownessDiagnostics = computeShallownessDiagnostics(
    fileMetrics,
    exportAnalysis,
    moveSuggestions,
    communities,
    weightedEdges,
    fileClassifications,
    options?.shallownessThresholds
  );

  // ── Complexity & Maintainability Index ──────────────────────────────

  const complexity = calculateComplexity(entities as any);

  // ── New analysis steps ─────────────────────────────────────────────

  const referenceDiagnostics = computeReferenceDiagnostics(relationships);
  const locMetrics = computeCanonicalLocMetrics(entities, relationships);
  const nonQualifiedDiagnostics = computeNonQualifiedDiagnostics(entities);
  const roleSeparation = computeRoleSeparation(communities.communities, fileClassifications);

  // ── Hierarchy analysis ─────────────────────────────────────────────

  const hierarchySummary = computeHierarchySummary(entities);

  // ── Inventory summary (optional) ───────────────────────────────────

  const inventorySummary = options?.fileInventory
    ? computeInventorySummary(options.fileInventory)
    : undefined;

  // ── Coverage validation ────────────────────────────────────────────

  const coverageValidation = computeCoverageValidation(entities);

  // ── Entity-level code concern classification ──────────────────────

  const entityClassification = classifyAllEntities(entities);

  // ── Step 9: Recommendations ────────────────────────────────────────

  // Build the result first (recommendations need it)
  const result: StructuralPipelineResult = {
    entityGraph,
    communityMap,
    fileClassifications,
    weightedEdges,
    alignment,
    communities,
    filesystemFit,
    moveSuggestions,
    groupingComparisons,
    centrality,
    exportAnalysis,
    fileMetrics,
    shallownessDiagnostics,
    entryPointAnalysis,
    referenceDiagnostics,
    locMetrics,
    nonQualifiedDiagnostics,
    roleSeparation,
    hierarchySummary,
    inventorySummary,
    coverageValidation,
    entityClassification,
    complexity,
    summary: undefined as any, // filled below
  };

  const { recommendations, healthScore } = generateRecommendations(result);
  result.recommendations = recommendations;
  result.healthScore = healthScore;

  // ── Build summary ───────────────────────────────────────────────────

  const categoryCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};
  let codeFiles = 0;

  for (const f of fileClassifications) {
    categoryCounts[f.category] = (categoryCounts[f.category] ?? 0) + 1;
    if (f.category === 'code') {
      codeFiles++;
      const role = f.contentRole ?? 'unknown';
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
  }

  const communitySizes = communities.communities.map((c) => c.memberFileIds.length);
  const oversizedFileCount = fileClassifications.filter(
    (f) => f.category === 'code' && f.linesOfCode && f.linesOfCode > thresholds.maxFileLoc
  ).length;

  result.summary = {
    totalFiles: fileClassifications.length,
    codeFiles,
    categoryCounts,
    roleCounts,
    clusterCount: communities.communities.length,
    avgClusterSize:
      communitySizes.length > 0
        ? Math.round(communitySizes.reduce((a, b) => a + b, 0) / communitySizes.length)
        : 0,
    maxClusterSize: communitySizes.length > 0 ? Math.max(...communitySizes) : 0,
    warningCount: alignment.warnings.length,
    criticalWarningCount: alignment.warnings.filter((w) => w.severity === 'critical').length,
    focusedFolderCount: alignment.folderFocus.filter((f) => f.assessment === 'focused').length,
    unfocusedFolderCount: alignment.folderFocus.filter(
      (f) => f.assessment === 'mixed' || f.assessment === 'cluster-scattered'
    ).length,
    splitCandidateCount: alignment.splitCandidates.length,
    oversizedFileCount,
    filesystemFitScore: filesystemFit.mojoFmScore,
    moveSuggestionCount: moveSuggestions.totalFilesToMove,
    communityCount: communities.communities.length,
    misplacedFileCount: communities.misplacedFiles.length,
    tangledDirectoryCount: communities.tangledDirectories.length,
    bridgeFileCount: centrality.filter((c) => c.isBridge).length,
    healthScore,
    recommendationCount: recommendations.length,
    shallownessFindingCount: shallownessDiagnostics.summary.flaggedFiles,
    shallownessMoveSuggestionCount: shallownessDiagnostics.summary.moveSuggestedCount,
    appEntryPointCount: entryPointAnalysis.summary.appEntryPointCount,
    exclusiveFileCount: entryPointAnalysis.summary.exclusiveFileCount,
    sharedFileCount: entryPointAnalysis.summary.sharedFileCount,
    unreachableFileCount: entryPointAnalysis.summary.unreachableFileCount,
    resolutionRate: referenceDiagnostics.resolutionRate,
    totalCanonicalLoc: locMetrics.totalCanonicalLoc,
    nonQualifiedRatio: nonQualifiedDiagnostics.nonQualifiedRatio,
    avgClusterSeparation: roleSeparation.repoSummary.avgClusterSeparation,
    avgMaintainabilityIndex:
      complexity.maintainability.entities.length > 0
        ? Math.round(
            (complexity.maintainability.entities.reduce((s, e) => s + e.maintainabilityIndex, 0) /
              complexity.maintainability.entities.length) *
              100
          ) / 100
        : undefined,
    miRedCount:
      complexity.maintainability.entities.filter((e) => e.riskBand === 'red').length || undefined,
    miYellowCount:
      complexity.maintainability.entities.filter((e) => e.riskBand === 'yellow').length ||
      undefined,
    miGreenCount:
      complexity.maintainability.entities.filter((e) => e.riskBand === 'green').length || undefined,
  };

  return result;
}

// ── Internal helpers ────────────────────────────────────────────────────

function extname(filePath: string): string {
  const name = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot) : '';
}

/**
 * Compute LCOM4 for a single class's method-field access matrix.
 * Returns the number of connected components (1 = cohesive, >1 = split candidate).
 */
function computeLcom4(matrix: Array<{ methodName: string; accessedFields: string[] }>): number {
  if (matrix.length === 0) return 0;

  const methods = matrix.map((m) => m.methodName);
  const fieldSets = new Map(matrix.map((m) => [m.methodName, new Set(m.accessedFields)]));

  // Build adjacency: edge between two methods if they share ≥ 1 field
  const adj = new Map<string, Set<string>>();
  for (const m of methods) adj.set(m, new Set());

  for (let i = 0; i < methods.length; i++) {
    const fi = fieldSets.get(methods[i])!;
    for (let j = i + 1; j < methods.length; j++) {
      const fj = fieldSets.get(methods[j])!;
      for (const f of fi) {
        if (fj.has(f)) {
          adj.get(methods[i])!.add(methods[j]);
          adj.get(methods[j])!.add(methods[i]);
          break;
        }
      }
    }
  }

  // BFS connected components
  const visited = new Set<string>();
  let components = 0;
  for (const m of methods) {
    if (visited.has(m)) continue;
    components++;
    const queue = [m];
    visited.add(m);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const neighbor of adj.get(cur)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }
  return components;
}
