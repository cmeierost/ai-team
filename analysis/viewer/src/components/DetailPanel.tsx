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
  MisplacedFile,
  FileExportInfo,
} from '../types.js';
import type { Selection } from '../types.js';
import { ROLE_COLORS, SEVERITY_COLORS, healthColor, pct, shortPath, shortName } from '../types.js';
import { deriveGroupLabel } from '../hooks/useClusterGraph.js';

export interface DetailPanelProps {
  data: StructuralPipelineResult;
  selection: Selection;
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

// ── Cluster Detail ──────────────────────────────────────────────────────

function ClusterDetail({ data, clusterId }: { data: StructuralPipelineResult; clusterId: string }) {
  // Try clusters first, then fall back to communities
  const cluster = data.clusters.find((c) => c.id === clusterId);
  const community = data.communities?.communities?.find((c) => c.id === clusterId);
  const fileIds = cluster?.fileIds ?? community?.memberFileIds;
  const quality = data.alignment.clusterQuality.find((q) => q.clusterId === clusterId);
  const warnings = data.alignment.warnings.filter((w) => w.target === clusterId);
  const misplacedMap = new Map<string, MisplacedFile>();
  for (const m of data.communities?.misplacedFiles ?? []) {
    misplacedMap.set(m.fileId, m);
  }

  if (!fileIds) {
    return <div style={emptyStyle}>Group "{clusterId}" not found</div>;
  }

  const isCommunity = !cluster && !!community;
  const fileCount = fileIds.length;

  // Build directory breakdown for the group
  const fileClassMap = new Map<string, (typeof data.fileClassifications)[number]>();
  for (const fc of data.fileClassifications) fileClassMap.set(fc.fileId, fc);

  const dirCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  let totalLoc = 0;
  for (const fid of fileIds) {
    const fc = fileClassMap.get(fid);
    if (fc) {
      const dir = fc.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      const role = fc.contentRole ?? 'unknown';
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      if (fc.linesOfCode) totalLoc += fc.linesOfCode;
    }
  }
  const sortedDirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedRoles = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      {/* Header */}
      <div>
        <div style={headingStyle}>{deriveGroupLabel(fileIds)}</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{clusterId}</div>
        <div style={{ fontSize: 12, color: '#a0a0a0', marginTop: 2 }}>
          {fileCount} files · {totalLoc.toLocaleString()} lines of code · {isCommunity ? 'dependency community' : 'coupling cluster'}
        </div>
        {isCommunity && (
          <div style={{ fontSize: 11, color: '#888', marginTop: 4, lineHeight: 1.4 }}>
            Files grouped by their import dependencies (Louvain community detection).
          </div>
        )}
      </div>

      {/* Cohesion (cluster only) */}
      {cluster && <CohesionBar ratio={cluster.cohesionRatio} />}

      {/* Role breakdown - computed from files when no quality data */}
      <div>
        <div style={sectionTitle}>Role Mix</div>
        {(quality ? Object.entries(quality.roleMix) : sortedRoles).map(([role, count]) => (
          <div key={role} style={{ ...fileRowStyle, gap: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: roleColor(role), flexShrink: 0 }} />
              {role.replace('_', ' ')}
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

      {/* Files */}
      <div>
        <div style={sectionTitle}>Files ({fileCount})</div>
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {fileIds.map((fid) => {
            const file = fileClassMap.get(fid);
            const role = file?.contentRole ?? 'unknown';
            const mp = misplacedMap.get(fid);
            return (
              <div key={fid} style={fileRowStyle}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {mp && (
                    <span title={`Misplaced — suggest move to ${mp.suggestedDirectory} (${mp.peerCount} peers there)`}
                      style={{ cursor: 'help' }}>⚠️ </span>
                  )}
                  {file ? shortName(file.filePath) : fid}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {file?.linesOfCode != null && (
                    <span style={{ fontSize: 10, color: '#666', fontVariantNumeric: 'tabular-nums' }}>
                      {file.linesOfCode}
                    </span>
                  )}
                  <RoleBadge role={role} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

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

// ── File Detail ─────────────────────────────────────────────────────────

function FileDetail({ data, fileId }: { data: StructuralPipelineResult; fileId: string }) {
  const file = data.fileClassifications.find((f) => f.fileId === fileId);
  const centrality = data.centrality?.find((c) => c.fileId === fileId);
  const misplaced = data.communities?.misplacedFiles?.find((m) => m.fileId === fileId);
  const exportInfo = data.exportAnalysis?.files.find((f) => f.fileId === fileId);

  const incomingEdges = data.weightedEdges.filter((e) => e.targetFileId === fileId);
  const outgoingEdges = data.weightedEdges.filter((e) => e.sourceFileId === fileId);

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
    </>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

export function DetailPanel({ data, selection }: DetailPanelProps) {
  if (selection.type == null) {
    return <div style={emptyStyle}>Click a cluster or file to see details</div>;
  }

  if (selection.type === 'cluster') {
    return (
      <div style={panelStyle}>
        <ClusterDetail data={data} clusterId={selection.id} />
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <FileDetail data={data} fileId={selection.id} />
    </div>
  );
}
