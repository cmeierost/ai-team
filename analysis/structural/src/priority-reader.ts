/**
 * @aspect/engine — LLM priority reader
 *
 * Produces a compact, ranked action queue from a full structural result.
 * Goal: make it trivial for an LLM to pick the single most important fix,
 * then continue with the next one.
 */

import type {
  StructuralPipelineResult,
  RecommendationPriority,
  LlmPriorityIssue,
  LlmPriorityReaderResult,
  LlmPriorityReaderOptions,
} from './types.js';

const PRIORITY_WEIGHT: Record<RecommendationPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const DEFAULT_MAX_ITEMS = 8;

function recommendationBaseScore(priority: RecommendationPriority, impact: number): number {
  return PRIORITY_WEIGHT[priority] * 100 + Math.round(Math.max(0, impact) * 100);
}

function warningPriority(severity: 'info' | 'warning' | 'critical'): RecommendationPriority {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'medium';
  return 'low';
}

function shallownessPriority(band: 'medium' | 'high' | 'critical'): RecommendationPriority {
  if (band === 'critical') return 'critical';
  if (band === 'high') return 'high';
  return 'medium';
}

function dedupeIssues(issues: LlmPriorityIssue[]): LlmPriorityIssue[] {
  const byKey = new Map<string, LlmPriorityIssue>();

  for (const issue of issues) {
    const fileKey = issue.filePaths[0] ?? issue.title;
    const key = `${issue.category}:${fileKey}`;
    const existing = byKey.get(key);
    if (!existing || issue.score > existing.score) byKey.set(key, issue);
  }

  return [...byKey.values()];
}

/**
 * Build a compact ordered queue of the most important architectural fixes.
 */
export function buildLlmPriorityReader(
  result: StructuralPipelineResult,
  options?: LlmPriorityReaderOptions
): LlmPriorityReaderResult {
  const maxItems = Math.max(1, options?.maxItems ?? DEFAULT_MAX_ITEMS);
  const issues: LlmPriorityIssue[] = [];

  for (const rec of result.recommendations ?? []) {
    issues.push({
      id: rec.id,
      source: 'recommendation',
      priority: rec.priority,
      category: rec.category,
      title: rec.title,
      action: rec.description,
      rationale: `Priority ${rec.priority}, impact ${rec.impact}.`,
      filePaths: rec.filePaths,
      score: recommendationBaseScore(rec.priority, rec.impact),
    });
  }

  for (const finding of result.shallownessDiagnostics?.findings ?? []) {
    const priority = shallownessPriority(finding.riskBand);
    const strategy = finding.classificationAwareRecommendation?.strategy ?? 'reduce-export-surface';
    issues.push({
      id: `shallowness:${finding.fileId}`,
      source: 'shallowness',
      priority,
      category: 'shallowness',
      title: `Reduce shallowness in ${finding.filePath}`,
      action: `Apply strategy '${strategy}' and reduce over-exposed API surface for this file.`,
      rationale: `Risk ${finding.riskBand}, score ${finding.score}.`,
      filePaths: [finding.filePath],
      score: recommendationBaseScore(priority, Math.min(1, finding.score / 100)),
    });
  }

  for (const warning of result.alignment.warnings ?? []) {
    const priority = warningPriority(warning.severity);
    issues.push({
      id: `warning:${warning.kind}:${warning.target}`,
      source: 'warning',
      priority,
      category: warning.kind,
      title: warning.message,
      action: `Resolve warning '${warning.kind}' for ${warning.target}.`,
      rationale: `Severity ${warning.severity}, value ${warning.value}, threshold ${warning.threshold}.`,
      filePaths: [warning.target],
      score: recommendationBaseScore(
        priority,
        Math.min(1, warning.value / Math.max(1, warning.threshold))
      ),
    });
  }

  const ranked = dedupeIssues(issues)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems);

  return {
    generatedAt: new Date().toISOString(),
    healthScore: result.healthScore,
    issueCount: ranked.length,
    current: ranked[0],
    next: ranked.slice(1),
  };
}
