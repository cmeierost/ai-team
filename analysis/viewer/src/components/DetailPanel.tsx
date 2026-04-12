/**
 * @aspect/viewer — DetailPanel
 *
 * Context-aware detail panel for the right sidebar.
 * Shows cluster or file details based on the current selection.
 */

import React from 'react';
import type {
  StructuralPipelineResult,
  FileClassificationEntry,
  ClusterQuality,
  StructuralWarning,
  FileCentrality,
  WeightedEdge,
  FileExportInfo,
  CommunityGroup,
  CommunityGroupChild,
} from '../types.js';
import type { Selection, EntityRefLite, RelationshipRefLite } from '../types.js';
import { ROLE_COLORS, SEVERITY_COLORS, healthColor, pct, shortPath, shortName } from '../types.js';
import { EntityDetailPane } from './EntityDetailPane.js';

export interface DetailPanelProps {
  data: StructuralPipelineResult;
  selection: Selection;
  clusterFileIds?: Set<string>;
  onSelectFile?: (fileId: string) => void;
  onSelectCluster?: (clusterId: string) => void;
  entities?: EntityRefLite[];
  relationships?: RelationshipRefLite[];
  showCommunityGroups?: boolean;
}

// ── Styles ──────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  overflowY: 'auto',
  height: '100%',
  boxSizing: 'border-box',
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  fontSize: 13,
  color: '#888',
  textAlign: 'center',
  padding: 24,
};

const headingStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#e0e0e0',
  wordBreak: 'break-all',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#888',
  marginBottom: 4,
};

const metricRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 12,
  padding: '3px 0',
  borderBottom: '1px solid #2d2d30',
};

const badge = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 600,
  padding: '1px 7px',
  borderRadius: 6,
  background: bg,
  color: fg,
});

const fileRowStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 0',
  borderBottom: '1px solid #2d2d30',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const fileLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#e0e0e0',
  padding: 0,
  textAlign: 'left',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
};

const listRow: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 0',
  borderBottom: '1px solid #2d2d30',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const warningRowStyle = (severity: string): React.CSSProperties => ({
  fontSize: 12,
  padding: 8,
  borderRadius: 4,
  background: '#2d2d30',
  borderLeft: `3px solid ${SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS] ?? SEVERITY_COLORS.info}`,
  marginBottom: 4,
});

// ── Helpers ─────────────────────────────────────────────────────────────

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? ROLE_COLORS.unknown;
}

function RoleBadge({ role }: { role: string }) {
  const c = roleColor(role);
  return <span style={badge(`${c}20`, c)}>{role}</span>;
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div style={metricRow}>
      <span style={{ color: '#888' }}>{label}</span>
      {children ?? <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{value}</span>}
    </div>
  );
}

function CohesionBar({ ratio }: { ratio: number }) {
  const pctVal = Math.round(ratio * 100);
  const color = ratio >= 0.7 ? '#4caf50' : ratio >= 0.4 ? '#ff9800' : '#f44336';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span style={{ color: '#888' }}>Cohesion</span>
        <span style={{ fontWeight: 700, color }}>{pctVal}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pctVal}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function CompositionBar({ composition }: { composition: Record<string, number> }) {
  const entries = Object.entries(composition).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div>
      <div style={sectionTitle}>Composition</div>
      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
        {entries.map(([role, val]) => {
          const w = (val / total) * 100;
          if (w < 1) return null;
          return (
            <div key={role} title={`${role}: ${Math.round(w)}%`}
              style={{ width: `${w}%`, background: roleColor(role), minWidth: 2 }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: '#a0a0a0' }}>
        {entries.map(([role, val]) => (
          <span key={role} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: roleColor(role), flexShrink: 0 }} />
            {role}: {Math.round((val / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function flattenCommunityGroups(
  roots: NonNullable<StructuralPipelineResult['communities']>['communityGroups'],
): NonNullable<StructuralPipelineResult['communities']>['communityGroups'] {
  const all: NonNullable<StructuralPipelineResult['communities']>['communityGroups'] = [];
  const walk = (sc: NonNullable<StructuralPipelineResult['communities']>['communityGroups'][number]) => {
    all.push(sc);
    for (const child of sc.children ?? []) {
      if (child.kind === 'communityGroup') walk(child.cluster);
    }
  };
  for (const root of roots) walk(root);
  return all;
}

function CommunityGroupDetail({
  data,
  CommunityGroupId,
  onSelectFile,
}: {
  data: StructuralPipelineResult;
  CommunityGroupId: string;
  onSelectFile?: (fileId: string) => void;
}) {
  const all = flattenCommunityGroups(data.communities?.communityGroups ?? []);
  const sc = all.find((s) => s.id === CommunityGroupId);
  if (!sc) return <div style={emptyStyle}>CommunityGroup "{CommunityGroupId}" not found</div>;

  const communityIds: string[] = [];
  const subSuperCount = sc.children.filter((c) => c.kind === 'communityGroup').length;
  for (const child of sc.children) {
    if (child.kind === 'community') communityIds.push(child.communityId);
    else {
      const stack = [child.cluster];
      while (stack.length) {
        const n = stack.pop()!;
        for (const c of n.children ?? []) {
          if (c.kind === 'community') communityIds.push(c.communityId);
          else stack.push(c.cluster);
        }
      }
    }
  }

  const fileClassMap = new Map(data.fileClassifications.map((f) => [f.fileId, f]));
  const sharedFiles = (sc.sharedContractFileIds ?? [])
    .map((fid) => fileClassMap.get(fid))
    .filter(Boolean) as FileClassificationEntry[];
  const sharedRoleCounts = new Map<string, number>();
  for (const f of sharedFiles) {
    const role = f.contentRole ?? 'unknown';
    sharedRoleCounts.set(role, (sharedRoleCounts.get(role) ?? 0) + 1);
  }
  const roleMix = Object.fromEntries(sharedRoleCounts.entries());

  return (
    <>
      <div>
        <div style={headingStyle}>{sc.label || sc.id}</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{sc.id}</div>
        <div style={{ fontSize: 12, color: '#a0a0a0', marginTop: 2 }}>
          {sc.totalFiles} files · {communityIds.length} communities · {subSuperCount} sub-groups
        </div>
      </div>

      <div>
        <div style={sectionTitle}>Scope</div>
        <Row label="Coordinator scope" value={sc.coordinatorScope || '—'} />
        <Row label="Dominant technology" value={sc.dominantTechnology || '—'} />
        <Row label="Dominant role" value={sc.dominantRole || '—'} />
        <Row label="Exposure" value={sc.exposureRatio != null ? `${Math.round(sc.exposureRatio * 100)}%` : '—'} />
      </div>

      <div>
        <div style={sectionTitle}>Shared glue ownership</div>
        <Row label="Shared LOC" value={String(Math.round(sc.sharedContractLoc ?? 0))} />
        <Row label="Shared files" value={String((sc.sharedContractFileIds ?? []).length)} />
      </div>

      {Object.keys(roleMix).length > 0 && (
        <CompositionBar composition={roleMix} />
      )}

      {sharedFiles.length > 0 && (
        <div>
          <div style={sectionTitle}>Shared files</div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {sharedFiles.slice(0, 40).map((f) => (
              <div key={f.fileId} style={fileRowStyle}>
                {onSelectFile ? (
                  <button style={fileLinkStyle} onClick={() => onSelectFile(f.fileId)} title={f.filePath}>
                    {shortName(f.filePath)}
                  </button>
                ) : (
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {shortName(f.filePath)}
                  </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {f.linesOfCode != null && (
                    <span style={{ fontSize: 10, color: '#666', fontVariantNumeric: 'tabular-nums' }}>
                      {f.linesOfCode}
                    </span>
                  )}
                  <RoleBadge role={f.contentRole ?? 'unknown'} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Cross-reference helper ──────────────────────────────────────────────

interface CrossRefEntry {
  id: string;
  label: string;
  weight: number;
  edgeCount: number;
}

function buildCrossReferences(
  communityId: string,
  data: StructuralPipelineResult,
  showCommunityGroups?: boolean,
): { uses: CrossRefEntry[]; usedBy: CrossRefEntry[] } {
  const edges = data.communities?.crossGroupEdges ?? [];
  if (edges.length === 0) return { uses: [], usedBy: [] };

  const communities = data.communities?.communities ?? [];
  const groups = data.communities?.communityGroups ?? [];

  // Build community→rootGroup mapping when showing groups
  const communityToGroup = new Map<string, string>();
  if (showCommunityGroups && groups.length > 0) {
    const walkGroup = (g: CommunityGroup, rootId: string) => {
      for (const child of g.children) {
        if (child.kind === 'community') {
          communityToGroup.set(child.communityId, rootId);
        } else {
          walkGroup(child.cluster, rootId);
        }
      }
    };
    for (const g of groups) {
      walkGroup(g, g.id);
    }
  }

  const resolveId = (cid: string): string => {
    if (showCommunityGroups && communityToGroup.has(cid)) {
      return communityToGroup.get(cid)!;
    }
    return cid;
  };

  const resolvedId = resolveId(communityId);

  // Aggregate edges
  const usesMap = new Map<string, { weight: number; edgeCount: number }>();
  const usedByMap = new Map<string, { weight: number; edgeCount: number }>();

  for (const edge of edges) {
    const src = resolveId(edge.sourceGroupId);
    const tgt = resolveId(edge.targetGroupId);
    if (src === resolvedId && tgt !== resolvedId) {
      const prev = usesMap.get(tgt) ?? { weight: 0, edgeCount: 0 };
      usesMap.set(tgt, { weight: prev.weight + edge.weight, edgeCount: prev.edgeCount + edge.edgeCount });
    }
    if (tgt === resolvedId && src !== resolvedId) {
      const prev = usedByMap.get(src) ?? { weight: 0, edgeCount: 0 };
      usedByMap.set(src, { weight: prev.weight + edge.weight, edgeCount: prev.edgeCount + edge.edgeCount });
    }
  }

  const resolveLabel = (id: string): string => {
    if (showCommunityGroups) {
      const g = groups.find((gr) => gr.id === id);
      if (g) return g.label ?? id;
    }
    const c = communities.find((cm) => cm.id === id);
    if (c) return c.label ?? id;
    const g = groups.find((gr) => gr.id === id);
    if (g) return g.label ?? id;
    return id;
  };

  const toEntries = (map: Map<string, { weight: number; edgeCount: number }>): CrossRefEntry[] =>
    [...map.entries()]
      .map(([id, v]) => ({ id, label: resolveLabel(id), ...v }))
      .sort((a, b) => b.weight - a.weight);

  return { uses: toEntries(usesMap), usedBy: toEntries(usedByMap) };
}

// ── Cluster Detail ──────────────────────────────────────────────────────

function ClusterDetail({
  data,
  clusterId,
  onSelectFile,
  onSelectCluster,
  entities,
  showCommunityGroups,
}: {
  data: StructuralPipelineResult;
  clusterId: string;
  onSelectFile?: (fileId: string) => void;
  onSelectCluster?: (clusterId: string) => void;
  entities?: EntityRefLite[];
  showCommunityGroups?: boolean;
}) {
  // Use communities for group lookup
  const community = data.communities?.communities?.find((c) => c.id === clusterId);
  const entityIds = community?.memberEntityIds;
  const quality = data.alignment.clusterQuality.find((q) => q.clusterId === clusterId);
  const warnings = data.alignment.warnings.filter((w) => w.target === clusterId);

  if (!entityIds) {
    return <div style={emptyStyle}>Community "{clusterId}" not found</div>;
  }

  // Build entity lookup
  const entityIdSet = new Set(entityIds);
  const entityMap = new Map<string, EntityRefLite>();
  if (entities) {
    for (const e of entities) {
      if (entityIdSet.has(e.id)) entityMap.set(e.id, e);
    }
  }
  const communityEntities = entityIds
    .map((eid) => entityMap.get(eid))
    .filter((e): e is EntityRefLite => e != null);

  // Compute stats from entities
  const concernCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  let totalLoc = 0;
  let exportedCount = 0;
  let privateCount = 0;
  for (const e of communityEntities) {
    const concern = e.classification?.codeConcern ?? 'unknown';
    concernCounts.set(concern, (concernCounts.get(concern) ?? 0) + 1);
    const dir = e.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    fileCounts.set(dir, (fileCounts.get(dir) ?? 0) + 1);
    totalLoc += e.rawCounts?.linesOfCode ?? 0;
    const isExported = e.classification?.isExported !== false;
    const vis = e.classification?.visibility;
    if (isExported && vis !== 'private' && vis !== 'protected') exportedCount++;
    else privateCount++;
  }
  const sortedConcerns = [...concernCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedDirs = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);
  const uniqueFiles = new Set(communityEntities.map((e) => e.filePath));

  // Cross-references: Uses / Used by
  const crossRefs = buildCrossReferences(
    clusterId, data, showCommunityGroups,
  );

  return (
    <>
      {/* Header */}
      <div>
        <div style={headingStyle}>{community.label ?? clusterId}</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{clusterId}</div>
        <div style={{ fontSize: 12, color: '#a0a0a0', marginTop: 2 }}>
          {communityEntities.length} entities · {uniqueFiles.size} files · {totalLoc.toLocaleString()} LOC
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
          {exportedCount} exported · {privateCount} private
        </div>
      </div>

      {/* Concern breakdown */}
      <div>
        <div style={sectionTitle}>Concerns</div>
        {sortedConcerns.map(([concern, count]) => (
          <div key={concern} style={{ ...fileRowStyle, gap: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: roleColor(concern), flexShrink: 0 }} />
              {concern}
            </span>
            <span style={{ fontWeight: 600, color: '#e0e0e0' }}>{count}</span>
          </div>
        ))}
        {quality?.hasMixedConcerns && (
          <div style={{ marginTop: 6, fontSize: 11, padding: '4px 8px', borderRadius: 4, background: 'rgba(255,152,0,0.12)', color: '#ff9800' }}>
            ⚠ Mixed concerns: {quality.concernConflict ?? 'multiple roles'}
          </div>
        )}
      </div>

      {/* Directory structure */}
      <div>
        <div style={sectionTitle}>
          Directories ({sortedDirs.length})
          {quality?.spansPackages && (
            <span style={{ ...badge('#fef2f2', '#ef4444'), marginLeft: 8 }}>spans packages</span>
          )}
        </div>
        {sortedDirs.slice(0, 10).map(([dir, count]) => (
          <div key={dir} style={{ fontSize: 12, color: '#a0a0a0', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              {shortPath(dir, 4)}
            </span>
            <span style={{ fontWeight: 600, color: '#666', flexShrink: 0, marginLeft: 8 }}>{count}</span>
          </div>
        ))}
        {sortedDirs.length > 10 && (
          <div style={{ fontSize: 11, color: '#666' }}>+{sortedDirs.length - 10} more</div>
        )}
      </div>

      {/* Cross-references: Uses */}
      {crossRefs.uses.length > 0 && (
        <div>
          <div style={sectionTitle}>Uses ({crossRefs.uses.length})</div>
          {crossRefs.uses.map((ref) => (
            <div
              key={ref.id}
              style={{ ...listRow, cursor: onSelectCluster ? 'pointer' : 'default' }}
              onClick={() => onSelectCluster?.(ref.id)}
            >
              <span style={{ fontWeight: 500 }}>{ref.label}</span>
              <span style={{ color: '#888', fontSize: 11 }}>
                {ref.edgeCount} ref{ref.edgeCount !== 1 ? 's' : ''} · w{ref.weight.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Cross-references: Used by */}
      {crossRefs.usedBy.length > 0 && (
        <div>
          <div style={sectionTitle}>Used by ({crossRefs.usedBy.length})</div>
          {crossRefs.usedBy.map((ref) => (
            <div
              key={ref.id}
              style={{ ...listRow, cursor: onSelectCluster ? 'pointer' : 'default' }}
              onClick={() => onSelectCluster?.(ref.id)}
            >
              <span style={{ fontWeight: 500 }}>{ref.label}</span>
              <span style={{ color: '#888', fontSize: 11 }}>
                {ref.edgeCount} ref{ref.edgeCount !== 1 ? 's' : ''} · w{ref.weight.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div>
          <div style={sectionTitle}>Warnings ({warnings.length})</div>
          {warnings.map((w, i) => (
            <div key={i} style={warningRowStyle(w.severity)}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{w.kind}</div>
              <div style={{ color: '#a0a0a0' }}>{w.message}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const ENTITY_KIND_GLYPHS: Record<string, string> = {
  class: '◆',
  interface: '◇',
  'type-alias': '◇',
  function: 'ƒ',
  method: 'ƒ',
  enum: 'E',
  namespace: 'N',
  module: 'M',
  field: '•',
  property: '•',
};

function entityKindGlyph(kind: string): string {
  return ENTITY_KIND_GLYPHS[kind] ?? '·';
}

// ── File Detail ─────────────────────────────────────────────────────────

function FileDetail({
  data,
  fileId,
  clusterFileIds,
  entities,
}: {
  data: StructuralPipelineResult;
  fileId: string;
  clusterFileIds?: Set<string>;
  entities?: EntityRefLite[];
}) {
  const file = data.fileClassifications.find((f) => f.fileId === fileId);
  const centrality = data.centrality?.find((c) => c.fileId === fileId);
  const misplaced = data.communities?.misplacedFiles?.find((m) => m.fileId === fileId);
  const exportInfo = data.exportAnalysis?.files.find((f) => f.fileId === fileId);
  const fileMetric = data.fileMetrics?.find((m) => m.fileId === fileId);

  const incomingEdges = data.weightedEdges.filter((e) => e.targetFileId === fileId);
  const outgoingEdges = data.weightedEdges.filter((e) => e.sourceFileId === fileId);
  const consumerFiles = new Set(incomingEdges.map((e) => e.sourceFileId));
  const insideRefs = clusterFileIds
    ? [...consumerFiles].filter((fid) => clusterFileIds.has(fid)).length
    : 0;
  const outsideRefs = consumerFiles.size - insideRefs;

  if (!file) {
    return <div style={emptyStyle}>File "{fileId}" not found</div>;
  }

  const role = file.contentRole ?? 'unknown';
  const rc = roleColor(role);
  const baseComposition = file.contentClassification?.composition;

  // Enrich composition with re-export count so re-exports show in the bar.
  // baseComposition has proportions summing to ~1.0; CompositionBar normalises,
  // so we scale own proportions to entity counts then add re-exports as peers.
  const reexportCount = exportInfo?.reexportSources?.length ?? 0;
  const enrichedComposition = (() => {
    if (!baseComposition && reexportCount === 0) return undefined;
    const comp: Record<string, number> = {};
    if (baseComposition) Object.assign(comp, baseComposition);
    if (reexportCount > 0) {
      const ownSum = Object.values(comp).reduce((s, v) => s + v, 0) || 0;
      const ownEntities = Math.max(1, (exportInfo?.totalExports ?? 1) - reexportCount);
      if (ownSum > 0) {
        const scale = ownEntities / ownSum;
        for (const k of Object.keys(comp)) comp[k] *= scale;
      }
      comp.reexport = reexportCount;
    }
    return comp;
  })();

  return (
    <>
      {/* Header */}
      <div>
        <div style={headingStyle}>{file.filePath}</div>
      </div>

      {/* Category */}
      <Row label="Category">
        <span style={badge('#2d2d30', '#ccc')}>{file.category}</span>
      </Row>

      {/* Content role */}
      <Row label="Content Role">
        <span style={badge(`${rc}20`, rc)}>{role}</span>
      </Row>

      {/* Lines of code */}
      {file.linesOfCode != null && (
        <Row label="Lines of Code" value={file.linesOfCode.toLocaleString()} />
      )}

      {/* Composition breakdown */}
      {enrichedComposition && <CompositionBar composition={enrichedComposition} />}

      {/* LCOM4 */}
      {file.lcom4 != null && (
        <Row label="LCOM4" value={String(file.lcom4)}>
          <span style={{ fontWeight: 600, color: file.lcom4 > 1 ? '#f44336' : '#e0e0e0' }}>
            {file.lcom4}{file.lcom4 > 1 && ' (split candidate)'}
          </span>
        </Row>
      )}

      {/* Centrality */}
      {centrality && (
        <div>
          <div style={sectionTitle}>Centrality</div>
          <Row label="Betweenness" value={centrality.betweenness.toFixed(4)} />
          <Row label="PageRank" value={centrality.pageRank.toFixed(4)} />
          {centrality.isBridge && (
            <div style={{ marginTop: 4, fontSize: 11, padding: '4px 8px', borderRadius: 4, background: 'rgba(0,122,204,0.12)', color: '#3794ff' }}>
              🌉 Bridge file
              {centrality.bridgeBetween && ` between ${centrality.bridgeBetween[0]} ↔ ${centrality.bridgeBetween[1]}`}
            </div>
          )}
        </div>
      )}

      {/* Misplaced */}
      {misplaced && (
        <div>
          <div style={sectionTitle}>Misplaced</div>
          <Row label="Current dir" value={shortPath(misplaced.currentDirectory)} />
          <Row label="Suggested dir" value={shortPath(misplaced.suggestedDirectory)} />
          <Row label="Peers in suggested" value={String(misplaced.peerCount)} />
        </div>
      )}

      {/* Edges */}
      <div>
        <div style={sectionTitle}>Edges</div>
        <Row label="Incoming" value={String(incomingEdges.length)} />
        <Row label="Outgoing" value={String(outgoingEdges.length)} />
      </div>

      {/* Exports */}
      {exportInfo && (
        <div>
          <div style={sectionTitle}>
            Exports ({exportInfo.totalExports})
            {exportInfo.isDeadFile && (
              <span style={{ ...badge('rgba(244,67,54,0.15)', '#f44336'), marginLeft: 8 }}>dead file</span>
            )}
          </div>
          <Row label="Logic exports" value={String(exportInfo.logicExports)} />
          <Row label="Contract exports" value={String(exportInfo.contractExports)} />
          <Row label="Consumer files" value={String(exportInfo.consumerCount)} />
          <Row label="Refs in cluster" value={String(insideRefs)} />
          <Row label="Refs outside cluster" value={String(outsideRefs)} />

          {/* Re-exports */}
          {exportInfo.reexportSources && exportInfo.reexportSources.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
                Re-exports from ({exportInfo.reexportSources.length}):
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                {exportInfo.reexportSources.map((src) => (
                  <div key={src} style={{ fontSize: 11, color: '#a0a0a0', padding: '1px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ↳ {shortPath(src, 3)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export symbol list */}
          {exportInfo.exports.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Symbols:</div>
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {exportInfo.exports.map((exp, i) => (
                  <div key={i} style={{ fontSize: 11, padding: '2px 0', borderBottom: '1px solid #2d2d30', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      <span style={{ color: '#e0e0e0' }}>{exp.name}</span>
                      <span style={{ color: '#555', marginLeft: 4 }}>{exp.kind}</span>
                      <span style={{ color: '#777', marginLeft: 8 }}>
                        in {insideRefs} / out {outsideRefs}
                      </span>
                    </span>
                    <span style={badge(
                      exp.nature === 'logic' ? 'rgba(0,122,204,0.15)' : 'rgba(156,39,176,0.15)',
                      exp.nature === 'logic' ? '#3794ff' : '#ce93d8',
                    )}>{exp.nature}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Entity-level details */}
      {(() => {
        const fileEntities = entities?.filter(
          (e) => e.filePath === fileId && e.kind !== 'file',
        );
        if (!fileEntities || fileEntities.length === 0) return null;

        const classificationMap = new Map(
          (data.entityClassification?.results ?? []).map((r) => [r.entityId, r]),
        );

        return (
          <div>
            <div style={sectionTitle}>Entities ({fileEntities.length})</div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {fileEntities.map((ent) => {
                const ec = classificationMap.get(ent.id);
                const concern = ec?.concern ?? ent.classification?.codeConcern ?? 'unknown';
                const surface = ent.rawCounts?.signatureSurface;
                const loc = ent.rawCounts?.linesOfCode;
                const branches = ent.rawCounts?.branchPoints;
                const narrowing = ent.rawCounts?.narrowingKind;

                const concernColors: Record<string, { bg: string; fg: string }> = {
                  contract:     { bg: 'rgba(6,182,212,0.15)',   fg: '#06b6d4' },
                  presentation: { bg: 'rgba(236,72,153,0.15)',  fg: '#ec4899' },
                  logic:        { bg: 'rgba(59,130,246,0.15)',  fg: '#3b82f6' },
                  unknown:      { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
                };
                const cc = concernColors[concern] ?? concernColors.unknown;

                const kindColors: Record<string, string> = {
                  function: '#4ec9b0',
                  class: '#4fc1ff',
                  interface: '#ce93d8',
                  'type-alias': '#c586c0',
                  enum: '#dcdcaa',
                  variable: '#9cdcfe',
                  method: '#4ec9b0',
                  property: '#9cdcfe',
                  'selector-rule': '#d7ba7d',
                  'custom-property': '#d7ba7d',
                  keyframes: '#d7ba7d',
                };
                const kindFg = kindColors[ent.kind] ?? '#888';

                return (
                  <div
                    key={ent.id}
                    style={{
                      fontSize: 11,
                      padding: '4px 0',
                      borderBottom: '1px solid #2d2d30',
                    }}
                  >
                    {/* Row 1: name + kind + concern */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: '#e0e0e0', minWidth: 0 }}>
                        {ent.name}
                      </span>
                      <span style={badge(`${kindFg}18`, kindFg)}>{ent.kind}</span>
                      <span style={badge(cc.bg, cc.fg)}>{concern}</span>
                    </div>

                    {/* Row 2: compact metrics */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 10, color: '#888' }}>
                      {loc != null && <span>LOC {loc}</span>}
                      {surface != null && (
                        <span style={{ color: surface > 20 ? '#f44336' : surface > 10 ? '#ffb74d' : '#888' }}>
                          surface {surface}
                        </span>
                      )}
                      {branches != null && branches > 0 && (
                        <span style={{ color: branches > 10 ? '#f44336' : branches > 5 ? '#ffb74d' : '#888' }}>
                          branches {branches}
                        </span>
                      )}
                      {narrowing && (
                        <span style={{ color: '#4ec9b0' }}>
                          {narrowing}{ent.rawCounts?.narrowedFieldCount != null ? `(${ent.rawCounts.narrowedFieldCount})` : ''}
                        </span>
                      )}
                    </div>

                    {/* Confidence indicator */}
                    {ec && ec.confidence < 0.3 && (
                      <div style={{ fontSize: 9, color: '#666', marginTop: 1 }}>
                        ⚠ low confidence ({(ec.confidence * 100).toFixed(0)}%)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {fileMetric && (
        <div>
          <div style={sectionTitle}>Interface change impact</div>
          <Row label="Cost score" value={Math.round(fileMetric.interfaceChangeCostScore).toString()} />
          <Row label="Risk band" value={fileMetric.interfaceChangeRiskBand} />
          <Row label="Leak score" value={fileMetric.sharedResponsibilityLeakScore.toFixed(2)} />
          <Row label="Hidden complexity" value={fileMetric.hiddenComplexityRatio.toFixed(2)} />
          <Row label="Consumer clusters" value={fileMetric.consumerClusterCount.toString()} />
          <Row label="Consumer groups" value={fileMetric.consumerCommunityGroupCount.toString()} />
        </div>
      )}
    </>
  );
}

function RepoDetail({ data }: { data: StructuralPipelineResult }) {
  const codeFiles = data.fileClassifications.filter((f) => f.category === 'code');
  const totalLoc = data.fileClassifications.reduce((s, f) => s + (f.linesOfCode ?? 0), 0);
  const roleCounts = new Map<string, number>();
  for (const f of codeFiles) {
    const role = f.contentRole ?? 'unknown';
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const topRoles = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <>
      <div>
        <div style={headingStyle}>Repository overview</div>
        <div style={{ fontSize: 12, color: '#a0a0a0', marginTop: 2 }}>
          {data.summary.totalFiles.toLocaleString()} files · {totalLoc.toLocaleString()} LOC
        </div>
      </div>

      <div>
        <div style={sectionTitle}>Health</div>
        <Row label="Health score">
          <span style={{ color: healthColor(data.healthScore ?? 0), fontWeight: 700 }}>
            {data.healthScore != null ? Math.round(data.healthScore) : '—'}
          </span>
        </Row>
        <Row label="Warnings" value={String(data.alignment.warnings.length)} />
        <Row label="Recommendations" value={String((data.recommendations ?? []).length)} />
      </div>

      <div>
        <div style={sectionTitle}>Structure</div>
        <Row label="Communities" value={String(data.communities?.communities.length ?? 0)} />
        <Row label="Community groups" value={String(data.communities?.communityGroups.length ?? 0)} />
        <Row label="Code files" value={String(codeFiles.length)} />
      </div>

      {topRoles.length > 0 && (
        <div>
          <div style={sectionTitle}>Top code roles</div>
          {topRoles.map(([role, count]) => (
            <div key={role} style={fileRowStyle}>
              <span>{role.replace('_', ' ')}</span>
              <span style={{ fontWeight: 600, color: '#e0e0e0' }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

export function DetailPanel({
  data,
  selection,
  clusterFileIds,
  onSelectFile,
  onSelectCluster,
  entities,
  relationships,
  showCommunityGroups,
}: DetailPanelProps) {
  if (selection.type == null) {
    return (
      <div style={panelStyle}>
        <RepoDetail data={data} />
      </div>
    );
  }

  if (selection.type === 'cluster') {
    return (
      <div style={panelStyle}>
        <ClusterDetail
          data={data}
          clusterId={selection.id}
          onSelectFile={onSelectFile}
          onSelectCluster={onSelectCluster}
          entities={entities}
          showCommunityGroups={showCommunityGroups}
        />
      </div>
    );
  }

  if (selection.type === 'communityGroup') {
    return (
      <div style={panelStyle}>
        <CommunityGroupDetail data={data} CommunityGroupId={selection.id} onSelectFile={onSelectFile} />
      </div>
    );
  }

  // Entity → show entity detail pane in sidebar
  if (selection.type === 'entity') {
    return (
      <div style={panelStyle}>
        <EntityDetailPane
          entityId={selection.id}
          entities={entities}
          relationships={relationships}
        />
      </div>
    );
  }

  // File → show file detail
  const fileId = selection.id;

  return (
    <div style={panelStyle}>
      <FileDetail
        data={data}
        fileId={fileId}
        clusterFileIds={clusterFileIds}
        entities={entities}
      />
    </div>
  );
}
