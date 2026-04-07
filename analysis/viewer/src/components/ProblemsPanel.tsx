/**
 * @aspect/viewer — ProblemsPanel
 *
 * Categorized list of structural issues with tabbed navigation.
 */

import React, { useState, useMemo } from 'react';
import type {
  StructuralPipelineResult,
  MisplacedFile,
  FileSplitCandidate,
  SplitFileCandidate,
  ClusterQuality,
  TangledDirectory,
  StructuralWarning,
  PipelineRecommendation,
} from '../types.js';
import { SEVERITY_COLORS, ROLE_COLORS, shortPath, pct } from '../types.js';

export interface ProblemsPanelProps {
  data: StructuralPipelineResult;
  onSelectFile: (fileId: string) => void;
  onSelectCluster: (clusterId: string) => void;
  /** When set, scope issues to this set of file IDs. */
  clusterFileIds?: Set<string>;
  /** When set, scope group-level findings to these community/cluster ids. */
  scopedGroupIds?: Set<string>;
}

type Tab = 'misplaced' | 'split' | 'mixed' | 'tangled' | 'warnings' | 'recommendations';

interface TabDef {
  key: Tab;
  label: string;
  count: number;
}

// ── Styles ──────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  boxSizing: 'border-box',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  padding: '12px 14px 8px',
  borderBottom: '1px solid #3e3e42',
  flexShrink: 0,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  padding: '4px 10px',
  borderRadius: 12,
  border: 'none',
  cursor: 'pointer',
  background: active ? '#0078d4' : '#2d2d30',
  color: active ? '#fff' : '#a0a0a0',
  transition: 'background 0.15s, color 0.15s',
});

const countBadge = (active: boolean): React.CSSProperties => ({
  fontSize: 10,
  fontWeight: 700,
  marginLeft: 4,
  padding: '0 5px',
  borderRadius: 8,
  background: active ? 'rgba(255,255,255,0.2)' : '#3e3e42',
  color: active ? '#fff' : '#888',
});

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const itemStyle = (severity: string): React.CSSProperties => ({
  fontSize: 12,
  padding: '8px 10px',
  borderRadius: 6,
  background: '#2d2d30',
  borderLeft: `3px solid ${SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS] ?? SEVERITY_COLORS.info}`,
  cursor: 'pointer',
  transition: 'background 0.1s',
});

const itemTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#e0e0e0',
  marginBottom: 2,
};

const itemDetailStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  lineHeight: 1.4,
};

const kindBadge = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-block',
  fontSize: 9,
  fontWeight: 600,
  padding: '1px 6px',
  borderRadius: 4,
  background: bg,
  color: fg,
  marginRight: 6,
});

const impactBarOuter: React.CSSProperties = {
  height: 6,
  borderRadius: 3,
  background: 'rgba(255,255,255,0.08)',
  flex: 1,
  maxWidth: 80,
};

// ── Component ───────────────────────────────────────────────────────────

export function ProblemsPanel({
  data,
  onSelectFile,
  onSelectCluster,
  clusterFileIds,
  scopedGroupIds,
}: ProblemsPanelProps) {
  const isScoped = clusterFileIds != null && clusterFileIds.size > 0;
  const communityById = useMemo(
    () => new Map((data.communities?.communities ?? []).map((c) => [c.id, c])),
    [data.communities?.communities],
  );

  const misplaced = useMemo(() => {
    const all = data.communities?.misplacedFiles ?? [];
    return isScoped ? all.filter((m) => clusterFileIds!.has(m.fileId)) : all;
  }, [data, clusterFileIds, isScoped]);

  const splits = useMemo(() => {
    const entitySplits = data.communities?.splitFileCandidates ?? [];
    if (entitySplits.length > 0) {
      return isScoped ? entitySplits.filter((s) => clusterFileIds!.has(s.fileId)) : entitySplits;
    }
    // Fallback to old alignment-based splits
    const all = data.alignment.splitCandidates ?? [];
    return isScoped ? all.filter((s) => clusterFileIds!.has(s.fileId)) : all;
  }, [data, clusterFileIds, isScoped]);

  const tangled = useMemo(() => {
    const all = data.communities?.tangledDirectories ?? [];
    if (!isScoped) return all;
    if (!scopedGroupIds || scopedGroupIds.size === 0) return [];
    return all.filter((t) => t.communityIds.some((cid) => scopedGroupIds.has(cid)));
  }, [data, isScoped, scopedGroupIds]);

  const warnings = useMemo(() => {
    const all = data.alignment.warnings ?? [];
    if (!isScoped) return all;
    return all.filter((w) => {
      if (clusterFileIds!.has(w.target)) return true;
      const community = communityById.get(w.target);
      if (community && community.memberFileIds.some((fid) => clusterFileIds!.has(fid))) return true;
      return false;
    });
  }, [data, clusterFileIds, isScoped, communityById]);

  const recommendations = useMemo(() => {
    const all = data.recommendations ?? [];
    if (!isScoped) return all;
    return all.filter((r) => r.fileIds.some((f) => clusterFileIds!.has(f)));
  }, [data, clusterFileIds, isScoped]);

  const mixedClusters = useMemo(() => {
    const all = data.alignment.clusterQuality.filter((q) => q.hasMixedConcerns);
    if (!isScoped) return all;
    return all.filter((q) => {
      const community = communityById.get(q.clusterId);
      if (community && community.memberFileIds.some((fid) => clusterFileIds!.has(fid))) return true;
      return false;
    });
  }, [data.alignment.clusterQuality, isScoped, clusterFileIds, communityById]);

  const communityLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data.communities?.communities ?? []) {
      map.set(c.id, c.label || c.id);
    }
    return map;
  }, [data.communities?.communities]);

  const tabs: TabDef[] = [
    { key: 'misplaced', label: 'Misplaced', count: misplaced.length },
    { key: 'split', label: 'Split Candidates', count: splits.length },
    { key: 'mixed', label: 'Mixed Concerns', count: mixedClusters.length },
    { key: 'tangled', label: 'Tangled Dirs', count: tangled.length },
    { key: 'warnings', label: 'Warnings', count: warnings.length },
    { key: 'recommendations', label: 'Recommendations', count: recommendations.length },
  ];

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    // Default to first non-empty tab
    const first = tabs.find((t) => t.count > 0);
    return first?.key ?? 'misplaced';
  });

  return (
    <div style={panelStyle}>
      {/* Tab bar */}
      <div style={tabBarStyle}>
        {tabs.map((t) => (
          <button
            key={t.key}
            style={tabStyle(activeTab === t.key)}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
            <span style={countBadge(activeTab === t.key)}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={listStyle}>
        {activeTab === 'misplaced' && (
          <MisplacedList items={misplaced} onSelect={onSelectFile} data={data} />
        )}
        {activeTab === 'split' && (
          <SplitList items={splits} onSelect={onSelectFile} communityLabelMap={communityLabelMap} />
        )}
        {activeTab === 'mixed' && (
          <MixedList items={mixedClusters} data={data} onSelect={onSelectCluster} />
        )}
        {activeTab === 'tangled' && (
          <TangledList items={tangled} />
        )}
        {activeTab === 'warnings' && (
          <WarningList items={warnings} onSelectFile={onSelectFile} onSelectCluster={onSelectCluster} />
        )}
        {activeTab === 'recommendations' && (
          <RecommendationList items={recommendations} onSelect={onSelectFile} />
        )}
      </div>
    </div>
  );
}

// ── Sub-lists ───────────────────────────────────────────────────────────

function EmptyMessage({ text }: { text: string }) {
  return <div style={{ fontSize: 13, color: '#666', textAlign: 'center', padding: 24 }}>{text}</div>;
}

function MisplacedList({ items, onSelect, data }: { items: MisplacedFile[]; onSelect: (id: string) => void; data: StructuralPipelineResult }) {
  if (items.length === 0) return <EmptyMessage text="No misplaced files detected" />;

  // Build a map of file roles for context
  const fileClassMap = new Map<string, (typeof data.fileClassifications)[number]>();
  for (const fc of data.fileClassifications) {
    fileClassMap.set(fc.fileId, fc);
  }

  return (
    <>
      <div style={{ fontSize: 11, color: '#888', padding: '4px 0 8px', lineHeight: 1.4 }}>
        Files whose import community doesn't match their directory.
        Entry points and shared utilities are often intentionally outside the main folder.
      </div>
      {items.map((m) => {
        const fc = fileClassMap.get(m.fileId);
        const role = fc?.contentRole ?? 'unknown';
        const isEntryPoint = role === 'entry_point';
        const isInfra = role === 'infrastructure';
        return (
          <div key={m.fileId} style={itemStyle(isEntryPoint || isInfra ? 'info' : 'warning')} onClick={() => onSelect(m.fileId)}>
            <div style={itemTitleStyle}>
              {shortPath(m.filePath)}
              <span style={{
                ...kindBadge(
                  `${ROLE_COLORS[role] ?? '#94a3b8'}20`,
                  ROLE_COLORS[role] ?? '#94a3b8',
                ),
                marginLeft: 6,
              }}>
                {role}
              </span>
            </div>
            <div style={itemDetailStyle}>
              {shortPath(m.currentDirectory)} → {shortPath(m.suggestedDirectory)}
              &nbsp;·&nbsp;{m.peerCount} peers
            </div>
            {isEntryPoint && (
              <div style={{ fontSize: 10, color: '#666', marginTop: 2, fontStyle: 'italic' }}>
                ↳ Entry points are typically at the root level intentionally
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function SplitList({ items, onSelect, communityLabelMap }: {
  items: (FileSplitCandidate | SplitFileCandidate)[];
  onSelect: (id: string) => void;
  communityLabelMap: Map<string, string>;
}) {
  if (items.length === 0) return <EmptyMessage text="No split candidates detected" />;

  // Detect shape: entity-level SplitFileCandidate has communityBreakdown
  const isEntityLevel = items.length > 0 && 'communityBreakdown' in items[0];

  return (
    <>
      <div style={{ fontSize: 11, color: '#888', padding: '4px 0 8px', lineHeight: 1.4 }}>
        {isEntityLevel
          ? 'Files whose entities belong to different communities — candidates for splitting.'
          : 'Files referenced by multiple clusters — possible split points.'}
      </div>
      {items.map((s) => {
        if ('communityBreakdown' in s) {
          const severity = s.communityCount >= 3 ? 'warning' : 'info';
          return (
            <div key={s.fileId} style={itemStyle(severity)} onClick={() => onSelect(s.fileId)}>
              <div style={itemTitleStyle}>
                {shortPath(s.filePath)}
                <span style={kindBadge('#ff980020', '#ff9800')}>{s.communityCount} communities</span>
              </div>
              <div style={itemDetailStyle}>
                {s.totalEntityLoc} LOC across {s.communityBreakdown.length} communities
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {s.communityBreakdown.map((b) => (
                  <span key={b.communityId} style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: '#2d2d30',
                    color: '#a0a0a0',
                    border: '1px solid #3e3e42',
                  }}>
                    {communityLabelMap.get(b.communityId) ?? b.communityId}: {b.entityCount} entities, {b.entityLoc} LOC
                  </span>
                ))}
              </div>
            </div>
          );
        }
        // Old FileSplitCandidate shape
        const severity = s.splitConfidence > 0.5 ? 'warning' : 'info';
        return (
          <div key={s.fileId} style={itemStyle(severity)} onClick={() => onSelect(s.fileId)}>
            <div style={itemTitleStyle}>{shortPath(s.filePath)}</div>
            <div style={itemDetailStyle}>
              Confidence: {Math.round(s.splitConfidence * 100)}%
              &nbsp;·&nbsp;{s.clusterIds.length} clusters
            </div>
          </div>
        );
      })}
    </>
  );
}

function MixedList({
  items,
  data,
  onSelect,
}: {
  items: ClusterQuality[];
  data: StructuralPipelineResult;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyMessage text="No mixed-concern clusters" />;
  return (
    <>
      {items.map((q) => (
        <div key={q.clusterId} style={itemStyle('warning')} onClick={() => onSelect(q.clusterId)}>
          <div style={itemTitleStyle}>{q.clusterId}</div>
          <div style={itemDetailStyle}>
            {q.concernConflict ?? 'Multiple roles'}
            &nbsp;·&nbsp;{q.fileCount} files
          </div>
        </div>
      ))}
    </>
  );
}

function TangledList({ items }: { items: TangledDirectory[] }) {
  if (items.length === 0) return <EmptyMessage text="No tangled directories" />;
  return (
    <>
      {items.map((t) => {
        const severity = t.communityCount > 5 ? 'critical' : 'warning';
        return (
          <div key={t.directory} style={itemStyle(severity)}>
            <div style={itemTitleStyle}>{shortPath(t.directory)}</div>
            <div style={itemDetailStyle}>
              {t.communityCount} communities · {t.fileCount} files
            </div>
          </div>
        );
      })}
    </>
  );
}

function WarningList({
  items,
  onSelectFile,
  onSelectCluster,
}: {
  items: StructuralWarning[];
  onSelectFile: (id: string) => void;
  onSelectCluster: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyMessage text="No warnings" />;
  return (
    <>
      {items.map((w, i) => {
        const sevColor = SEVERITY_COLORS[w.severity] ?? SEVERITY_COLORS.info;
        return (
          <div
            key={i}
            style={itemStyle(w.severity)}
            onClick={() => {
              // Heuristic: cluster warnings have 'cluster' in kind, otherwise file
              if (w.kind.includes('cluster')) {
                onSelectCluster(w.target);
              } else {
                onSelectFile(w.target);
              }
            }}
          >
            <div style={itemTitleStyle}>
              <span style={kindBadge(`${sevColor}20`, sevColor)}>{w.kind}</span>
              {w.target}
            </div>
            <div style={itemDetailStyle}>
              {w.message}
              {w.value != null && w.threshold != null && (
                <span> · value {w.value} / threshold {w.threshold}</span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#f44336',
  high: '#ff9800',
  medium: '#3794ff',
  low: '#888',
};

function RecommendationList({
  items,
  onSelect,
}: {
  items: PipelineRecommendation[];
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyMessage text="No recommendations" />;
  return (
    <>
      {items.map((r) => {
        const pColor = PRIORITY_COLORS[r.priority] ?? PRIORITY_COLORS.medium;
        return (
          <div
            key={r.id}
            style={itemStyle(r.priority === 'critical' ? 'critical' : r.priority === 'high' ? 'warning' : 'info')}
            onClick={() => {
              if (r.fileIds.length > 0) onSelect(r.fileIds[0]);
            }}
          >
            <div style={itemTitleStyle}>
              <span style={kindBadge(`${pColor}20`, pColor)}>{r.priority}</span>
              {r.title}
            </div>
            <div style={{ ...itemDetailStyle, display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={kindBadge('#2d2d30', '#a0a0a0')}>{r.category}</span>
              <div style={impactBarOuter}>
                <div style={{ height: '100%', width: `${Math.round(r.impact * 100)}%`, background: pColor, borderRadius: 3 }} />
              </div>
              <span>{r.fileIds.length} files</span>
            </div>
            <div style={{ ...itemDetailStyle, marginTop: 2 }}>{r.description}</div>
          </div>
        );
      })}
    </>
  );
}
