/**
 * @aspect/engine — Recommendation generator
 *
 * Produces prioritized, actionable, human/LLM-readable recommendations
 * from analysis results.  The goal is to guide a codebase from chaotic
 * structure to well-separated architecture whose concerns map to the
 * file-system layout.
 */

import type { AnalysisResult, AnalysisSummary } from './orchestrator.js';
import type { GroupCouplingResult } from './group-coupling.js';

/** Subset of GroupCouplingResult used by recommendations */
type GroupCouplingInput = Pick<GroupCouplingResult, 'profiles' | 'mergeCandidates'>;

// ── Public types ────────────────────────────────────────────────────────

export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low';
export type RecommendationCategory =
  | 'file-move'
  | 'group-separation'
  | 'group-merge'
  | 'cycle-break'
  | 'contract-extraction'
  | 'complexity-hotspot'
  | 'dependency-inversion';

export interface Recommendation {
  id: string;
  priority: RecommendationPriority;
  category: RecommendationCategory;
  /** Short title (1 line). */
  title: string;
  /** Detailed explanation (1–3 sentences). */
  description: string;
  /** Entity IDs involved (for IDE navigation). */
  entityIds: string[];
  /** File paths involved. */
  filePaths: string[];
  /** Estimated impact on architecture quality (0–1). */
  impact: number;
}

export interface ArchitecturalSummary {
  /** One-paragraph overview of the codebase's architectural health. */
  overview: string;
  /** Key metrics in human-readable form. */
  keyMetrics: Array<{ label: string; value: string; assessment: 'good' | 'warning' | 'critical' }>;
  /** Prioritised list of recommendations. */
  recommendations: Recommendation[];
  /** Groups that are well-structured (positive feedback). */
  wellStructuredGroups: Array<{ groupId: string; reason: string }>;
  /** Overall architectural health score (0–100). */
  healthScore: number;
}

// ── Constants ───────────────────────────────────────────────────────────

const MAX_RECOMMENDATIONS = 20;

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? filePath;
}

let nextId = 0;
function recId(category: RecommendationCategory): string {
  return `${category}-${++nextId}`;
}

function resetIdCounter(): void {
  nextId = 0;
}

// ── Health score ────────────────────────────────────────────────────────

function calculateHealthScore(summary: AnalysisSummary): number {
  // Coherence (25 pts)
  const coherence = clamp(summary.overallCoherenceScore, 0, 1) * 25;

  // Grouping similarity (20 pts)
  const grouping = clamp(summary.groupingSimilarityScore, 0, 1) * 20;

  // Cycle-free (15 pts) — 1 if 0 cycles, degrades
  const cycleFree =
    summary.cycleCount === 0
      ? 1
      : Math.max(0, 1 - summary.cycleCount * 0.15);
  const cycles = clamp(cycleFree, 0, 1) * 15;

  // Complexity (15 pts) — avg cyclomatic < 10 is good
  const complexityRaw =
    summary.avgCyclomaticComplexity <= 10
      ? 1
      : Math.max(0, 1 - (summary.avgCyclomaticComplexity - 10) / 20);
  const complexity = clamp(complexityRaw, 0, 1) * 15;

  // Coupling (15 pts) — moderate instability is ideal
  const couplingRaw = summary.mostCoupledEntities.length > 0
    ? Math.max(0, 1 - (summary.mostCoupledEntities[0].totalCoupling / 50))
    : 1;
  const coupling = clamp(couplingRaw, 0, 1) * 15;

  // Duplication (10 pts) — 100% minus duplication%
  const duplication = clamp(1 - summary.overallDuplicationPercentage / 100, 0, 1) * 10;

  return Math.round(clamp(coherence + grouping + cycles + complexity + coupling + duplication, 0, 100));
}

// ── Assessment helpers ──────────────────────────────────────────────────

function healthAssessment(score: number): string {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'needs attention';
  return 'poor';
}

type MetricAssessment = 'good' | 'warning' | 'critical';

function coherenceAssessment(score: number): MetricAssessment {
  if (score >= 0.7) return 'good';
  if (score >= 0.4) return 'warning';
  return 'critical';
}

function cycleAssessment(count: number): MetricAssessment {
  if (count === 0) return 'good';
  if (count <= 3) return 'warning';
  return 'critical';
}

function duplicationAssessment(pct: number): MetricAssessment {
  if (pct < 5) return 'good';
  if (pct <= 15) return 'warning';
  return 'critical';
}

function groupingAssessment(score: number): MetricAssessment {
  if (score >= 0.7) return 'good';
  if (score >= 0.4) return 'warning';
  return 'critical';
}

function complexityAssessment(avg: number): MetricAssessment {
  if (avg < 10) return 'good';
  if (avg <= 20) return 'warning';
  return 'critical';
}

// ── Key metrics builder ─────────────────────────────────────────────────

function buildKeyMetrics(summary: AnalysisSummary): ArchitecturalSummary['keyMetrics'] {
  const metrics: ArchitecturalSummary['keyMetrics'] = [];

  metrics.push({
    label: 'Structural Coherence',
    value: `${(summary.overallCoherenceScore * 100).toFixed(0)}%`,
    assessment: coherenceAssessment(summary.overallCoherenceScore),
  });

  metrics.push({
    label: 'Dependency Cycles',
    value: String(summary.cycleCount),
    assessment: cycleAssessment(summary.cycleCount),
  });

  metrics.push({
    label: 'Code Duplication',
    value: `${summary.overallDuplicationPercentage.toFixed(1)}%`,
    assessment: duplicationAssessment(summary.overallDuplicationPercentage),
  });

  metrics.push({
    label: 'Grouping Alignment',
    value: `${(summary.groupingSimilarityScore * 100).toFixed(0)}%`,
    assessment: groupingAssessment(summary.groupingSimilarityScore),
  });

  metrics.push({
    label: 'Average Complexity',
    value: summary.avgCyclomaticComplexity.toFixed(1),
    assessment: complexityAssessment(summary.avgCyclomaticComplexity),
  });

  if (summary.misplacedFileCount > 0) {
    metrics.push({
      label: 'Misplaced Files',
      value: String(summary.misplacedFileCount),
      assessment: summary.misplacedFileCount > 5 ? 'critical' : 'warning',
    });
  }

  if (summary.tangledDirectoryCount > 0) {
    metrics.push({
      label: 'Tangled Directories',
      value: String(summary.tangledDirectoryCount),
      assessment: summary.tangledDirectoryCount > 3 ? 'critical' : 'warning',
    });
  }

  return metrics;
}

// ── Recommendation generators ───────────────────────────────────────────

function generateFileMoveRecs(result: AnalysisResult): Recommendation[] {
  const recs: Recommendation[] = [];

  // From coherence.misplacedFiles
  if (result.coherence?.misplacedFiles) {
    for (const mf of result.coherence.misplacedFiles) {
      const crossGroupDeps = mf.peersInSuggestedDir - mf.peersInCurrentDir;
      const impact = clamp(crossGroupDeps / 20, 0.1, 1);
      recs.push({
        id: recId('file-move'),
        priority: crossGroupDeps >= 5 ? 'high' : 'medium',
        category: 'file-move',
        title: `Move ${fileName(mf.filePath)} from ${mf.currentDirectory} to ${mf.suggestedDirectory}`,
        description:
          `${fileName(mf.filePath)} belongs to a dependency community concentrated in ${mf.suggestedDirectory} ` +
          `(${mf.peersInSuggestedDir} peers) but currently sits in ${mf.currentDirectory} (${mf.peersInCurrentDir} peers).`,
        entityIds: [mf.entityId],
        filePaths: [mf.filePath],
        impact,
      });
    }
  }

  // From groupingComparison.suggestions
  if (result.groupingComparison?.suggestions) {
    const alreadySuggested = new Set(
      result.coherence?.misplacedFiles?.map((mf) => mf.entityId) ?? [],
    );
    for (const sug of result.groupingComparison.suggestions) {
      if (alreadySuggested.has(sug.entityId)) continue;
      recs.push({
        id: recId('file-move'),
        priority: sug.impactEstimate > 0.05 ? 'high' : 'medium',
        category: 'file-move',
        title: `Move ${fileName(sug.filePath)} from ${sug.fromGroup} to ${sug.toGroup}`,
        description: sug.reason,
        entityIds: [sug.entityId],
        filePaths: [sug.filePath],
        impact: clamp(sug.impactEstimate * 5, 0.1, 1),
      });
    }
  }

  return recs;
}

function generateGroupSeparationRecs(groupCoupling?: GroupCouplingInput): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!groupCoupling?.profiles) return recs;

  for (const profile of groupCoupling.profiles) {
    if (profile.separabilityIndex > 0.7) {
      recs.push({
        id: recId('group-separation'),
        priority: 'medium',
        category: 'group-separation',
        title: `Extract ${profile.groupLabel} as a separate package`,
        description:
          `${profile.groupLabel} has high internal cohesion (${(profile.internalCohesion * 100).toFixed(0)}%) ` +
          `and a separability index of ${(profile.separabilityIndex * 100).toFixed(0)}%, ` +
          `making it a strong candidate for extraction as an independent package.`,
        entityIds: [],
        filePaths: [],
        impact: clamp(profile.separabilityIndex * 0.8, 0.3, 0.9),
      });
    }
  }

  return recs;
}

function generateGroupMergeRecs(groupCoupling?: GroupCouplingInput): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!groupCoupling?.mergeCandidates) return recs;

  for (const mc of groupCoupling.mergeCandidates) {
    recs.push({
      id: recId('group-merge'),
      priority: mc.couplingDensity > 0.7 ? 'high' : 'medium',
      category: 'group-merge',
      title: `Merge ${mc.groupIdA} and ${mc.groupIdB} — too tightly coupled to maintain separately`,
      description:
        `${mc.reason} Coupling density between the two groups is ` +
        `${(mc.couplingDensity * 100).toFixed(0)}%.`,
      entityIds: [],
      filePaths: [],
      impact: clamp(mc.couplingDensity, 0.3, 1),
    });
  }

  return recs;
}

function generateCycleBreakRecs(result: AnalysisResult): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!result.graph?.cycles.cycles) return recs;

  for (const cycle of result.graph.cycles.cycles) {
    if (cycle.entityIds.length < 2) continue;
    const [e1, e2] = cycle.entityIds;
    recs.push({
      id: recId('cycle-break'),
      priority: 'critical',
      category: 'cycle-break',
      title: `Break cycle: ${e1} ↔ ${e2}`,
      description:
        `A dependency cycle of size ${cycle.size} was detected involving ${cycle.entityIds.join(', ')}. ` +
        `Consider removing the weakest edge to break this cycle.`,
      entityIds: cycle.entityIds,
      filePaths: [],
      impact: clamp(cycle.size / 10, 0.5, 1),
    });
  }

  return recs;
}

function generateContractExtractionRecs(result: AnalysisResult): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!result.codeRoles?.contractViolations) return recs;

  for (const cv of result.codeRoles.contractViolations) {
    recs.push({
      id: recId('contract-extraction'),
      priority: 'high',
      category: 'contract-extraction',
      title: `Extract contracts from ${fileName(cv.filePath)} — contract file imports implementations`,
      description:
        `${fileName(cv.filePath)} is classified as a contract but imports ` +
        `${cv.implementationImports.length} implementation(s): ${cv.implementationImports.join(', ')}. ` +
        `Contracts should only depend on other contracts or types.`,
      entityIds: [cv.entityId],
      filePaths: [cv.filePath],
      impact: clamp(cv.implementationImports.length / 5, 0.3, 0.9),
    });
  }

  return recs;
}

function generateComplexityHotspotRecs(result: AnalysisResult): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!result.summary.mostComplexEntities.length) return recs;

  const srpViolations = new Set(
    result.summary.worstSrpEntities.map((e) => e.entityId),
  );

  for (let i = 0; i < result.summary.mostComplexEntities.length; i++) {
    const entity = result.summary.mostComplexEntities[i];
    const hasSrpViolation = srpViolations.has(entity.entityId);
    const isTop3 = i < 3;
    const baseImpact = clamp(entity.cyclomatic / 30, 0.2, 0.9);

    recs.push({
      id: recId('complexity-hotspot'),
      priority: isTop3 ? 'high' : 'medium',
      category: 'complexity-hotspot',
      title: `Reduce complexity in ${entity.entityId} (cyclomatic: ${entity.cyclomatic})`,
      description:
        `This entity has a cyclomatic complexity of ${entity.cyclomatic}, ` +
        `placing it in the top complexity hotspots.` +
        (hasSrpViolation
          ? ' It also has a Single-Responsibility Principle violation, suggesting it should be split.'
          : ''),
      entityIds: [entity.entityId],
      filePaths: [],
      impact: hasSrpViolation ? clamp(baseImpact + 0.15, 0.2, 1) : baseImpact,
    });
  }

  return recs;
}

function generateDipRecs(result: AnalysisResult): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!result.solid?.dip) return recs;

  for (const dip of result.solid.dip) {
    if (dip.dipScore < 0.3) {
      recs.push({
        id: recId('dependency-inversion'),
        priority: 'medium',
        category: 'dependency-inversion',
        title: `Introduce abstractions in ${dip.entityId} — depends on ${dip.concreteDependencyCount} concrete implementations`,
        description:
          `${dip.entityId} has a DIP score of ${(dip.dipScore * 100).toFixed(0)}% ` +
          `with ${dip.concreteDependencyCount} concrete dependencies. ` +
          `Introduce interfaces or abstract types to decouple high-level policy from low-level details.`,
        entityIds: [dip.entityId],
        filePaths: [],
        impact: clamp((1 - dip.dipScore) * 0.7, 0.2, 0.8),
      });
    }
  }

  return recs;
}

// ── Well-structured groups ──────────────────────────────────────────────

function findWellStructuredGroups(
  groupCoupling?: GroupCouplingInput,
): ArchitecturalSummary['wellStructuredGroups'] {
  const groups: ArchitecturalSummary['wellStructuredGroups'] = [];
  if (!groupCoupling?.profiles) return groups;

  for (const profile of groupCoupling.profiles) {
    if (profile.internalCohesion >= 0.7 && profile.separabilityIndex >= 0.6) {
      groups.push({
        groupId: profile.groupId,
        reason:
          `High internal cohesion (${(profile.internalCohesion * 100).toFixed(0)}%) ` +
          `and clean separation (separability ${(profile.separabilityIndex * 100).toFixed(0)}%).`,
      });
    }
  }

  return groups;
}

// ── Overview text ───────────────────────────────────────────────────────

function buildOverview(summary: AnalysisSummary, healthScore: number, recs: Recommendation[]): string {
  const assessment = healthAssessment(healthScore);

  const issues: string[] = [];
  if (summary.cycleCount > 0) {
    issues.push(`${summary.cycleCount} dependency cycle(s) were detected`);
  }
  if (summary.misplacedFileCount > 0) {
    issues.push(`${summary.misplacedFileCount} file(s) appear misplaced relative to their dependency community`);
  }
  if (summary.avgCyclomaticComplexity > 10) {
    issues.push(`average cyclomatic complexity is ${summary.avgCyclomaticComplexity.toFixed(1)}, above the recommended threshold of 10`);
  }
  if (summary.overallDuplicationPercentage > 5) {
    issues.push(`code duplication is at ${summary.overallDuplicationPercentage.toFixed(1)}%`);
  }

  const strengths: string[] = [];
  if (summary.overallCoherenceScore >= 0.7) {
    strengths.push('structural coherence');
  }
  if (summary.cycleCount === 0) {
    strengths.push('cycle-free dependencies');
  }
  if (summary.avgCyclomaticComplexity < 10) {
    strengths.push('low complexity');
  }
  if (summary.overallDuplicationPercentage < 5) {
    strengths.push('minimal duplication');
  }

  let text =
    `This codebase has ${summary.entityCount} code entities across ${summary.moduleCount} modules. ` +
    `Architecture health is ${healthScore}/100 (${assessment}).`;

  if (issues.length > 0) {
    text += ` ${issues[0].charAt(0).toUpperCase() + issues[0].slice(1)}.`;
  }
  if (issues.length > 1) {
    text += ` ${issues[1].charAt(0).toUpperCase() + issues[1].slice(1)}.`;
  }
  if (strengths.length > 0) {
    text += ` The strongest area is ${strengths[0]}.`;
  }

  return text;
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Generate a prioritised, actionable architectural summary from analysis
 * results and optional group-coupling data.
 */
export function generateRecommendations(
  result: AnalysisResult,
  groupCoupling?: GroupCouplingInput,
): ArchitecturalSummary {
  resetIdCounter();

  const healthScore = calculateHealthScore(result.summary);

  // Collect all recommendations
  const allRecs: Recommendation[] = [
    ...generateCycleBreakRecs(result),
    ...generateContractExtractionRecs(result),
    ...generateFileMoveRecs(result),
    ...generateGroupMergeRecs(groupCoupling),
    ...generateGroupSeparationRecs(groupCoupling),
    ...generateComplexityHotspotRecs(result),
    ...generateDipRecs(result),
  ];

  // Sort: priority first, then by impact descending
  allRecs.sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.impact - a.impact;
  });

  const recommendations = allRecs.slice(0, MAX_RECOMMENDATIONS);
  const keyMetrics = buildKeyMetrics(result.summary);
  const wellStructuredGroups = findWellStructuredGroups(groupCoupling);
  const overview = buildOverview(result.summary, healthScore, recommendations);

  return {
    overview,
    keyMetrics,
    recommendations,
    wellStructuredGroups,
    healthScore,
  };
}
