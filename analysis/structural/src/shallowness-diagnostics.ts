/**
 * @aspect/engine — Shallowness diagnostics
 *
 * Identifies files that likely expose too much interface surface relative to
 * how they are consumed, and augments findings with concrete move targets when
 * available from structural move-suggestion passes.
 */

import type {
  FileClassificationEntry,
  WeightedEdge,
  FileInterfaceMetrics,
  ExportAnalysis,
  CommunityDetectionResult,
  ShallownessDiagnostics,
  ShallownessFinding,
  ShallownessRiskBand,
  ShallownessMoveSuggestion,
  ShallownessDirectionality,
  ShallownessRemediation,
  ShallownessExportSurfaceHint,
  ShallownessClassificationRecommendation,
  ShallownessThresholds,
} from './types.js';
import type { CodeContentRole } from './2-code-classification.js';
import type { MoveSuggestionResult } from './move-suggestions.js';
import { DEFAULT_SHALLOWNESS_THRESHOLDS } from './types.js';
import { round3, parentDir } from './types.js';

function bandFor(score: number, thresholds: ShallownessThresholds): ShallownessRiskBand | 'low' {
  if (score >= thresholds.criticalRiskMinScore) return 'critical';
  if (score >= thresholds.highRiskMinScore) return 'high';
  if (score >= thresholds.mediumRiskMinScore) return 'medium';
  return 'low';
}

function buildMoveSuggestion(
  fileId: string,
  moveSuggestions?: MoveSuggestionResult,
  communities?: CommunityDetectionResult
): ShallownessMoveSuggestion | undefined {
  const move = moveSuggestions?.suggestions.find((s) => s.fileId === fileId);
  if (move) {
    return {
      suggestedDirectory: move.suggestedDirectory,
      confidence: move.confidence,
      source: 'move-suggestions',
      rationale: move.rationale,
    };
  }

  const misplaced = communities?.misplacedFiles.find((m) => m.fileId === fileId);
  if (misplaced) {
    return {
      suggestedDirectory: misplaced.suggestedDirectory,
      confidence: misplaced.peerCount >= 6 ? 'high' : misplaced.peerCount >= 3 ? 'medium' : 'low',
      source: 'misplaced-file',
      rationale: `Dependency community has ${misplaced.peerCount} peers in ${misplaced.suggestedDirectory}.`,
    };
  }

  return undefined;
}

function moduleIdForFilePath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const srcIdx = segments.indexOf('src');
  if (srcIdx >= 0 && segments.length > srcIdx + 1) {
    return segments.slice(0, srcIdx + 2).join('/');
  }
  return parentDir(normalized);
}

interface ModulePairWeights {
  outgoingBySource: Map<string, Map<string, number>>;
  incomingByTarget: Map<string, Map<string, number>>;
}

function buildModulePairWeights(
  filePathById: Map<string, string>,
  weightedEdges: WeightedEdge[]
): ModulePairWeights {
  const outgoingBySource = new Map<string, Map<string, number>>();
  const incomingByTarget = new Map<string, Map<string, number>>();

  for (const edge of weightedEdges) {
    const srcPath = filePathById.get(edge.sourceFileId);
    const tgtPath = filePathById.get(edge.targetFileId);
    if (!srcPath || !tgtPath) continue;

    const srcModule = moduleIdForFilePath(srcPath);
    const tgtModule = moduleIdForFilePath(tgtPath);
    if (srcModule === tgtModule) continue;

    let out = outgoingBySource.get(srcModule);
    if (!out) {
      out = new Map<string, number>();
      outgoingBySource.set(srcModule, out);
    }
    out.set(tgtModule, (out.get(tgtModule) ?? 0) + edge.weight);

    let inc = incomingByTarget.get(tgtModule);
    if (!inc) {
      inc = new Map<string, number>();
      incomingByTarget.set(tgtModule, inc);
    }
    inc.set(srcModule, (inc.get(srcModule) ?? 0) + edge.weight);
  }

  return { outgoingBySource, incomingByTarget };
}

function buildDirectionality(
  fileId: string,
  filePathById: Map<string, string>,
  modulePairWeights: ModulePairWeights
): ShallownessDirectionality | undefined {
  const filePath = filePathById.get(fileId);
  if (!filePath) return undefined;

  const providerModuleId = moduleIdForFilePath(filePath);

  const incomingByModule = modulePairWeights.incomingByTarget.get(providerModuleId);

  if (!incomingByModule || incomingByModule.size === 0) return undefined;

  let dependentModuleId = '';
  let dependentToProviderEdges = 0;
  for (const [moduleId, weight] of incomingByModule) {
    if (weight > dependentToProviderEdges) {
      dependentModuleId = moduleId;
      dependentToProviderEdges = weight;
    }
  }

  const providerToDependentEdges =
    modulePairWeights.outgoingBySource.get(providerModuleId)?.get(dependentModuleId) ?? 0;

  const providerImporters = new Set(incomingByModule.keys());
  const dependentImporters = new Set(
    modulePairWeights.incomingByTarget.get(dependentModuleId)?.keys() ?? []
  );
  let overlap = 0;
  for (const importer of providerImporters) {
    if (dependentImporters.has(importer)) overlap++;
  }
  const minImporterCount = Math.max(1, Math.min(providerImporters.size, dependentImporters.size));
  const coImportAffinity = round3(overlap / minImporterCount);

  return {
    providerModuleId,
    dependentModuleId,
    dependentToProviderEdges: round3(dependentToProviderEdges),
    providerToDependentEdges: round3(providerToDependentEdges),
    isBidirectional: dependentToProviderEdges > 0 && providerToDependentEdges > 0,
    directionalityRatio: round3(dependentToProviderEdges / Math.max(1, providerToDependentEdges)),
    coImportAffinity,
  };
}

function chooseRemediation(
  metric: FileInterfaceMetrics,
  directionality: ShallownessDirectionality | undefined,
  suggestedMove: ShallownessMoveSuggestion | undefined
): ShallownessRemediation | undefined {
  const hasConcentratedConsumer =
    metric.singleConsumerExportRatio >= 0.6 &&
    metric.consumerFileCount >= 1 &&
    metric.consumerClusterCount <= 2;
  const hasHighCoImportAffinity = (directionality?.coImportAffinity ?? 0) >= 0.5;

  if (
    directionality &&
    (hasConcentratedConsumer || hasHighCoImportAffinity) &&
    directionality.dependentToProviderEdges >= (hasHighCoImportAffinity ? 2 : 3)
  ) {
    const reverseRatio =
      directionality.providerToDependentEdges /
      Math.max(1, directionality.dependentToProviderEdges);

    if (reverseRatio <= 0.15) {
      return {
        strategy: 'deepen-dependent-module',
        targetModuleId: directionality.dependentModuleId,
        rationale: `Usage is strongly one-way (${directionality.dependentToProviderEdges} -> ${directionality.providerToDependentEdges}) and co-import affinity is ${directionality.coImportAffinity}; prefer moving ownership toward ${directionality.dependentModuleId}.`,
      };
    }

    return {
      strategy: 'improve-boundary-directionality',
      targetModuleId: directionality.dependentModuleId,
      rationale: `Heavy coupling is bidirectional (${directionality.dependentToProviderEdges} <-> ${directionality.providerToDependentEdges}); fix boundary direction before relocating ownership.`,
    };
  }

  if (suggestedMove) {
    return {
      strategy: 'move-provider',
      rationale: `Dependency placement suggests relocating provider toward ${suggestedMove.suggestedDirectory}.`,
    };
  }

  return undefined;
}

function buildExportSurfaceHint(
  metric: FileInterfaceMetrics,
  directionality: ShallownessDirectionality | undefined
): ShallownessExportSurfaceHint | undefined {
  const localConsumerScope =
    metric.consumerClusterCount <= 1 ? 'single-module-part' : 'few-module-parts';

  const hasLocalOnlyPattern =
    metric.consumerCommunityGroupCount <= 1 &&
    metric.consumerClusterCount <= 2 &&
    metric.sharedResponsibilityLeakScore <= 0.45;

  const hasNarrowUsagePattern =
    metric.singleConsumerExportRatio >= 0.5 || (directionality?.coImportAffinity ?? 0) >= 0.4;

  if (!hasLocalOnlyPattern || !hasNarrowUsagePattern || metric.exportedEntityCount === 0) {
    return undefined;
  }

  const consumerModuleId = directionality?.dependentModuleId;
  const scopeText =
    localConsumerScope === 'single-module-part'
      ? 'a single module part'
      : 'a small set of module parts';

  return {
    shouldStopFurtherExport: true,
    localConsumerScope,
    consumerModuleId,
    rationale: consumerModuleId
      ? `Exported surface appears to be consumed only within ${scopeText} (${consumerModuleId}); avoid propagating this export further.`
      : `Exported surface appears to be consumed only within ${scopeText}; avoid propagating this export further.`,
  };
}

function buildClassificationAwareRecommendation(
  metric: FileInterfaceMetrics,
  contentRole: CodeContentRole | 'unknown',
  thresholds: ShallownessThresholds
): ShallownessClassificationRecommendation | undefined {
  if (metric.exportedEntityCount === 0) return undefined;

  const typeLikeExportRatio = round3(
    metric.exportedTypeLikeCount / Math.max(1, metric.exportedEntityCount)
  );

  if (
    contentRole === 'contract' ||
    typeLikeExportRatio >= thresholds.contractTypeLikeExportRatio
  ) {
    return {
      strategy: 'extract-contract-types',
      rationale:
        'Contract-heavy export surface detected; keep runtime facade small and move shared types/contracts into a dedicated contracts/types area.',
      contentRole,
      typeLikeExportRatio,
    };
  }

  if (contentRole === 'logic' && typeLikeExportRatio <= thresholds.logicTypeLikeExportRatio) {
    return {
      strategy: 'internalize-runtime-exports',
      rationale:
        'Logic-heavy runtime surface with low type-export ratio; avoid broad re-exports and keep helpers/internal runtime symbols private to this module part.',
      contentRole,
      typeLikeExportRatio,
    };
  }

  return {
    strategy: 'split-runtime-and-types',
    rationale:
      'Mixed runtime/type export surface; split contracts/types from runtime implementation to reduce coupling and clarify public API.',
    contentRole,
    typeLikeExportRatio,
  };
}

/**
 * Compute shallowness findings from canonical file-interface metrics.
 *
 * Scoring focuses on:
 * - broad/churn-prone outward interface (`interfaceSurfaceComplexityScore`)
 * - leakage across consumers (`sharedResponsibilityLeakScore`)
 * - over-exposed API used by only one consumer (`singleConsumerExportRatio`)
 * - hidden implementation pressure (`hiddenComplexityRatio`)
 * - export density (`exportedEntityCount / LOC`)
 */
export function computeShallownessDiagnostics(
  fileMetrics: FileInterfaceMetrics[],
  exportAnalysis?: ExportAnalysis,
  moveSuggestions?: MoveSuggestionResult,
  communities?: CommunityDetectionResult,
  weightedEdges: WeightedEdge[] = [],
  fileClassifications: FileClassificationEntry[] = [],
  thresholds: Partial<ShallownessThresholds> = {}
): ShallownessDiagnostics {
  if (fileMetrics.length === 0) {
    return {
      findings: [],
      summary: {
        totalFiles: 0,
        flaggedFiles: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        moveSuggestedCount: 0,
      },
    };
  }

  const exportCountByFile = new Map<string, number>();
  for (const file of exportAnalysis?.files ?? []) {
    exportCountByFile.set(file.fileId, file.totalExports);
  }

  const filePathById = new Map<string, string>();
  for (const metric of fileMetrics) filePathById.set(metric.fileId, metric.filePath);
  for (const file of fileClassifications) {
    if (!filePathById.has(file.fileId)) filePathById.set(file.fileId, file.filePath);
  }
  const fileClassificationById = new Map(fileClassifications.map((f) => [f.fileId, f]));

  const modulePairWeights = buildModulePairWeights(filePathById, weightedEdges);
  const effectiveThresholds: ShallownessThresholds = {
    ...DEFAULT_SHALLOWNESS_THRESHOLDS,
    ...thresholds,
  };

  const findings: ShallownessFinding[] = [];
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let moveSuggestedCount = 0;

  for (const metric of fileMetrics) {
    const loc = Math.max(1, metric.linesOfCode);
    const exportCount = exportCountByFile.get(metric.fileId) ?? metric.exportedEntityCount;
    const exportsPer100Loc = (exportCount * 100) / loc;

    const interfaceSurfacePressure = Math.min(1, metric.interfaceSurfaceComplexityScore / 60);
    const leakPressure = Math.min(1, metric.sharedResponsibilityLeakScore / 1.5);
    const oversharePressure = Math.min(1, metric.singleConsumerExportRatio);
    const hiddenPressure = Math.min(1, metric.hiddenComplexityRatio / 10);
    const exportDensityPressure = Math.min(1, exportsPer100Loc / 8);

    const baseScore = round3(
      100 *
        (interfaceSurfacePressure * 0.3 +
          leakPressure * 0.25 +
          oversharePressure * 0.2 +
          hiddenPressure * 0.15 +
          exportDensityPressure * 0.1)
    );

    const directionality = buildDirectionality(metric.fileId, filePathById, modulePairWeights);
    const coImportBoost = (directionality?.coImportAffinity ?? 0) * 10;
    const score = round3(Math.min(100, baseScore + coImportBoost));

    const riskBand = bandFor(score, effectiveThresholds);
    if (riskBand === 'low') continue;

    const suggestedMove = buildMoveSuggestion(metric.fileId, moveSuggestions, communities);
    if (suggestedMove) moveSuggestedCount++;

    const remediation = chooseRemediation(metric, directionality, suggestedMove);
    const exportSurfaceHint = buildExportSurfaceHint(metric, directionality);
    const contentRole = fileClassificationById.get(metric.fileId)?.contentRole ?? 'unknown';
    const classificationAwareRecommendation = buildClassificationAwareRecommendation(
      metric,
      contentRole,
      effectiveThresholds
    );

    if (riskBand === 'critical') criticalCount++;
    else if (riskBand === 'high') highCount++;
    else mediumCount++;

    findings.push({
      fileId: metric.fileId,
      filePath: metric.filePath,
      score,
      riskBand,
      signals: {
        interfaceSurfaceComplexityScore: metric.interfaceSurfaceComplexityScore,
        sharedResponsibilityLeakScore: metric.sharedResponsibilityLeakScore,
        singleConsumerExportRatio: metric.singleConsumerExportRatio,
        hiddenComplexityRatio: metric.hiddenComplexityRatio,
        exportCount,
        exportsPer100Loc: round3(exportsPer100Loc),
        coImportAffinity: directionality?.coImportAffinity ?? 0,
      },
      directionality,
      remediation,
      classificationAwareRecommendation,
      exportSurfaceHint,
      suggestedMove,
    });
  }

  findings.sort((a, b) => b.score - a.score);

  return {
    findings,
    summary: {
      totalFiles: fileMetrics.length,
      flaggedFiles: findings.length,
      criticalCount,
      highCount,
      mediumCount,
      moveSuggestedCount,
    },
  };
}
