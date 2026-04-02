/**
 * DOT (Graphviz) exporter — dependency graph visualisation.
 */

import type { AnalysisResult } from '../orchestrator.js';
import type { CollectedData } from './types.js';
import { buildEntityMap } from './types.js';

// ── Options ─────────────────────────────────────────────────────────────

export interface DotOptions {
  /** Which graph to render. */
  graphType?: 'dependency' | 'module';
  /** Highlight cycle edges in red (default: true). */
  highlightCycles?: boolean;
  /** Colour nodes by community membership. */
  colorByCommunity?: boolean;
  /** Scale node size by metric value. */
  sizeByMetric?: 'complexity' | 'coupling' | 'pageRank';
  /** Include only cross-module edges. */
  crossModuleOnly?: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────

const COMMUNITY_COLORS = [
  '#4285F4',
  '#EA4335',
  '#FBBC05',
  '#34A853',
  '#FF6D01',
  '#46BDC6',
  '#7B1FA2',
  '#C2185B',
  '#00897B',
  '#FFB300',
];

// ── Helpers ─────────────────────────────────────────────────────────────

function escapeLabel(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Module-level graph builder ──────────────────────────────────────────

function buildModuleGraph(
  result: AnalysisResult,
  collectedData: CollectedData,
  lines: string[],
  highlightCycles: boolean,
): string {
  for (const mod of collectedData.moduleBoundaries) {
    lines.push(
      `  "${escapeLabel(mod.moduleId)}" [label="${escapeLabel(mod.moduleId)}"];`,
    );
  }

  if (result.coupling) {
    const { moduleIds, matrix } = result.coupling.moduleDependencyMatrix;
    for (let i = 0; i < moduleIds.length; i++) {
      for (let j = 0; j < moduleIds.length; j++) {
        if (i !== j && matrix[i][j] > 0) {
          lines.push(
            `  "${escapeLabel(moduleIds[i])}" -> "${escapeLabel(moduleIds[j])}" [label="${matrix[i][j]}"];`,
          );
        }
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

// ── Main exporter ───────────────────────────────────────────────────────

export function toDot(
  result: AnalysisResult,
  collectedData: CollectedData,
  options?: DotOptions,
): string {
  const graphType = options?.graphType ?? 'dependency';
  const highlightCycles = options?.highlightCycles ?? true;
  const colorByCommunity = options?.colorByCommunity ?? false;
  const sizeByMetric = options?.sizeByMetric;
  const crossModuleOnly = options?.crossModuleOnly ?? false;

  const lines: string[] = ['digraph dependencies {', '  rankdir=LR;'];

  if (graphType === 'module') {
    return buildModuleGraph(result, collectedData, lines, highlightCycles);
  }

  // ── Entity-level dependency graph ──

  const entityMap = buildEntityMap(collectedData.entities);

  // Cycle edges for highlighting
  const cycleEdges = new Set<string>();
  if (highlightCycles && result.graph) {
    for (const cycle of result.graph.cycles.cycles) {
      for (let i = 0; i < cycle.entityIds.length; i++) {
        const from = cycle.entityIds[i];
        const to = cycle.entityIds[(i + 1) % cycle.entityIds.length];
        cycleEdges.add(`${from}|${to}`);
      }
    }
  }

  // Community membership
  const communityMap = new Map<string, number>();
  if (colorByCommunity && result.graph) {
    for (let i = 0; i < result.graph.communities.communities.length; i++) {
      for (const id of result.graph.communities.communities[i].entityIds) {
        communityMap.set(id, i);
      }
    }
  }

  // Metric values for sizing
  const metricMap = new Map<string, number>();
  if (sizeByMetric === 'complexity' && result.complexity) {
    for (const c of result.complexity.cyclomatic) {
      metricMap.set(c.entityId, c.cyclomaticComplexity);
    }
  } else if (sizeByMetric === 'coupling' && result.coupling) {
    for (const c of result.coupling.entities) {
      metricMap.set(c.entityId, c.totalCoupling);
    }
  } else if (sizeByMetric === 'pageRank' && result.graph) {
    for (const p of result.graph.pageRank) {
      metricMap.set(p.entityId, p.pageRank);
    }
  }

  const maxMetric =
    metricMap.size > 0 ? Math.max(...metricMap.values(), 1) : 1;

  // Nodes
  const nodeIds = new Set<string>();
  for (const entity of collectedData.entities) {
    nodeIds.add(entity.id);
    const attrs: string[] = [
      `label="${escapeLabel(entity.filePath)}"`,
    ];

    if (colorByCommunity && communityMap.has(entity.id)) {
      const ci = communityMap.get(entity.id)!;
      const color = COMMUNITY_COLORS[ci % COMMUNITY_COLORS.length];
      attrs.push(
        `color="${color}"`,
        'style=filled',
        `fillcolor="${color}22"`,
      );
    }

    if (sizeByMetric && metricMap.has(entity.id)) {
      const scale = 0.5 + (metricMap.get(entity.id)! / maxMetric) * 1.5;
      attrs.push(`width=${scale.toFixed(2)}`, `height=${scale.toFixed(2)}`);
    }

    lines.push(`  "${escapeLabel(entity.id)}" [${attrs.join(', ')}];`);
  }

  // Edges
  for (const rel of collectedData.relationships) {
    if (crossModuleOnly && !rel.crossModule) continue;
    if (!nodeIds.has(rel.sourceEntityId) || !nodeIds.has(rel.targetEntityId))
      continue;

    const edgeKey = `${rel.sourceEntityId}|${rel.targetEntityId}`;
    const attrs: string[] = [];

    if (highlightCycles && cycleEdges.has(edgeKey)) {
      attrs.push('color=red', 'penwidth=2');
    }

    const attrStr = attrs.length > 0 ? ` [${attrs.join(', ')}]` : '';
    lines.push(
      `  "${escapeLabel(rel.sourceEntityId)}" -> "${escapeLabel(rel.targetEntityId)}"${attrStr};`,
    );
  }

  lines.push('}');
  return lines.join('\n');
}
