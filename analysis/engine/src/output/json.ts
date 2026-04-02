/**
 * JSON exporter — pretty-printed or compact JSON with optional section filtering.
 */

import type { AnalysisResult } from '../orchestrator.js';

// ── Options ─────────────────────────────────────────────────────────────

export interface JsonExportOptions {
  /** Indent output with 2-space formatting (default: true). */
  pretty?: boolean;
  /** Include per-calculator timing data (default: false). */
  includeTimings?: boolean;
  /** Restrict output to specific sections (default: all). */
  sections?: string[];
}

// ── Section key → result field mapping ──────────────────────────────────

const SECTION_MAP: Record<string, keyof AnalysisResult> = {
  complexity: 'complexity',
  coupling: 'coupling',
  graph: 'graph',
  cohesion: 'cohesion',
  solid: 'solid',
  duplication: 'duplication',
  module: 'moduleMetrics',
  moduleMetrics: 'moduleMetrics',
  summary: 'summary',
};

// ── Exporter ────────────────────────────────────────────────────────────

export function toJson(
  result: AnalysisResult,
  options?: JsonExportOptions,
): string {
  const pretty = options?.pretty ?? true;
  const includeTimings = options?.includeTimings ?? false;
  const sections = options?.sections;

  let output: Record<string, unknown>;

  if (sections && sections.length > 0) {
    output = {};
    for (const section of sections) {
      const key = SECTION_MAP[section];
      if (key) {
        output[section] = result[key];
      }
    }
    if (includeTimings) {
      output.timing = result.timing;
    }
  } else {
    // Include everything except timing (unless requested)
    const { timing, ...rest } = result;
    output = { ...rest };
    if (includeTimings) {
      output.timing = timing;
    }
  }

  return pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
}
