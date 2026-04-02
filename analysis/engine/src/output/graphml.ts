/**
 * GraphML exporter — XML graph format for tools like yEd and Gephi.
 */

import type { AnalysisResult } from '../orchestrator.js';
import type { CollectedData } from './types.js';
import { buildEntityMap } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Exporter ────────────────────────────────────────────────────────────

export function toGraphML(
  result: AnalysisResult,
  collectedData: CollectedData,
): string {
  const entityMap = buildEntityMap(collectedData.entities);

  // Metric lookups
  const complexityMap = new Map<string, number>();
  if (result.complexity) {
    for (const c of result.complexity.cyclomatic) {
      complexityMap.set(c.entityId, c.cyclomaticComplexity);
    }
  }

  const couplingMap = new Map<string, number>();
  if (result.coupling) {
    for (const c of result.coupling.entities) {
      couplingMap.set(c.entityId, c.totalCoupling);
    }
  }

  const communityMap = new Map<string, string>();
  if (result.graph) {
    for (const community of result.graph.communities.communities) {
      for (const entityId of community.entityIds) {
        communityMap.set(entityId, community.id);
      }
    }
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<graphml xmlns="http://graphml.graphstruct.org/graphml">',
  );

  // Key definitions
  lines.push(
    '  <key id="d0" for="node" attr.name="label" attr.type="string"/>',
  );
  lines.push(
    '  <key id="d1" for="node" attr.name="complexity" attr.type="int"/>',
  );
  lines.push(
    '  <key id="d2" for="node" attr.name="coupling" attr.type="int"/>',
  );
  lines.push(
    '  <key id="d3" for="node" attr.name="community" attr.type="string"/>',
  );
  lines.push(
    '  <key id="d4" for="edge" attr.name="crossModule" attr.type="boolean"/>',
  );
  lines.push(
    '  <key id="d5" for="edge" attr.name="thirdParty" attr.type="boolean"/>',
  );
  lines.push(
    '  <key id="d6" for="edge" attr.name="kind" attr.type="string"/>',
  );
  lines.push('  <graph id="G" edgedefault="directed">');

  // Nodes
  const nodeIdMap = new Map<string, string>();
  let nodeIdx = 0;
  for (const entity of collectedData.entities) {
    const nid = `n${nodeIdx++}`;
    nodeIdMap.set(entity.id, nid);

    const complexity = complexityMap.get(entity.id) ?? 0;
    const coupling = couplingMap.get(entity.id) ?? 0;
    const community = communityMap.get(entity.id);

    lines.push(`    <node id="${nid}">`);
    lines.push(
      `      <data key="d0">${escapeXml(entity.filePath)}</data>`,
    );
    lines.push(`      <data key="d1">${complexity}</data>`);
    lines.push(`      <data key="d2">${coupling}</data>`);
    if (community) {
      lines.push(
        `      <data key="d3">${escapeXml(community)}</data>`,
      );
    }
    lines.push('    </node>');
  }

  // Edges
  let edgeIdx = 0;
  for (const rel of collectedData.relationships) {
    const sourceNode = nodeIdMap.get(rel.sourceEntityId);
    const targetNode = nodeIdMap.get(rel.targetEntityId);
    if (!sourceNode || !targetNode) continue;

    const eid = `e${edgeIdx++}`;
    lines.push(
      `    <edge id="${eid}" source="${sourceNode}" target="${targetNode}">`,
    );
    lines.push(
      `      <data key="d4">${rel.crossModule}</data>`,
    );
    lines.push(
      `      <data key="d5">${rel.thirdParty}</data>`,
    );
    lines.push(
      `      <data key="d6">${escapeXml(rel.kind)}</data>`,
    );
    lines.push('    </edge>');
  }

  lines.push('  </graph>');
  lines.push('</graphml>');
  return lines.join('\n');
}
