/**
 * Reference completeness diagnostics.
 *
 * Analyses the resolution quality of all relationships in the codebase,
 * producing per-file and aggregate statistics on resolved / proxy / unresolved
 * references.
 */

import type { Relationship } from '@aspect/contracts';
import { round3 } from './types.js';

// ── Public types ────────────────────────────────────────────────────────

export interface ReferenceDiagnostics {
  totalReferences: number;
  resolvedCount: number;
  proxyCount: number;
  unresolvedCount: number;
  resolutionRate: number;
  proxyRate: number;
  unresolvedRate: number;
  topUnresolvedTargets: Array<{ target: string; count: number }>;
  perFileStats: FileReferenceDiagnostic[];
}

export interface FileReferenceDiagnostic {
  fileId: string;
  filePath: string;
  outgoingTotal: number;
  outgoingResolved: number;
  outgoingProxy: number;
  outgoingUnresolved: number;
  resolutionRate: number;
}

// ── Computation ─────────────────────────────────────────────────────────

interface FileAccumulator {
  filePath: string;
  resolved: number;
  proxy: number;
  unresolved: number;
}

/**
 * Compute reference completeness diagnostics from the relationship set.
 *
 * Groups relationships by source file and counts resolution outcomes using
 * `resolutionKind`.  Produces a top-10 list of the most-frequently unresolved
 * target paths.
 */
export function computeReferenceDiagnostics(
  relationships: Relationship[],
): ReferenceDiagnostics {
  const perFile = new Map<string, FileAccumulator>();
  const unresolvedTargetCounts = new Map<string, number>();

  let resolvedCount = 0;
  let proxyCount = 0;
  let unresolvedCount = 0;

  for (const rel of relationships) {
    const sourceId = rel.sourceEntityId;
    const sourcePath = rel.sourceFilePath;

    let acc = perFile.get(sourceId);
    if (!acc) {
      acc = { filePath: sourcePath, resolved: 0, proxy: 0, unresolved: 0 };
      perFile.set(sourceId, acc);
    }

    switch (rel.resolutionKind) {
      case 'resolved':
        resolvedCount++;
        acc.resolved++;
        break;
      case 'proxy':
        proxyCount++;
        acc.proxy++;
        break;
      case 'unresolved':
        unresolvedCount++;
        acc.unresolved++;
        {
          const target = rel.targetFilePath ?? rel.targetEntityId ?? '<unknown>';
          unresolvedTargetCounts.set(target, (unresolvedTargetCounts.get(target) ?? 0) + 1);
        }
        break;
    }
  }

  const totalReferences = resolvedCount + proxyCount + unresolvedCount;
  const safeDivide = (n: number, d: number) => (d === 0 ? 0 : n / d);

  const topUnresolvedTargets = [...unresolvedTargetCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([target, count]) => ({ target, count }));

  // Build per-file breakdown, keyed by sourceFilePath (deduplicate by path)
  const byPath = new Map<string, FileAccumulator>();
  for (const [fileId, acc] of perFile) {
    const existing = byPath.get(acc.filePath);
    if (existing) {
      existing.resolved += acc.resolved;
      existing.proxy += acc.proxy;
      existing.unresolved += acc.unresolved;
    } else {
      byPath.set(acc.filePath, { ...acc });
    }
    // Keep fileId→path association; we'll use filePath as the grouping key
    // but expose the first fileId encountered per path.
    if (!byPath.has(acc.filePath + '#id')) {
      (byPath as any).set(acc.filePath + '#id', fileId);
    }
  }

  const perFileStats: FileReferenceDiagnostic[] = [];
  for (const [key, acc] of perFile) {
    const total = acc.resolved + acc.proxy + acc.unresolved;
    perFileStats.push({
      fileId: key,
      filePath: acc.filePath,
      outgoingTotal: total,
      outgoingResolved: acc.resolved,
      outgoingProxy: acc.proxy,
      outgoingUnresolved: acc.unresolved,
      resolutionRate: round3(safeDivide(acc.resolved, total)),
    });
  }

  return {
    totalReferences,
    resolvedCount,
    proxyCount,
    unresolvedCount,
    resolutionRate: round3(safeDivide(resolvedCount, totalReferences)),
    proxyRate: round3(safeDivide(proxyCount, totalReferences)),
    unresolvedRate: round3(safeDivide(unresolvedCount, totalReferences)),
    topUnresolvedTargets,
    perFileStats,
  };
}
