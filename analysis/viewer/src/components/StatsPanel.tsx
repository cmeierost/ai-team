/**
 * @aspect/viewer — StatsPanel
 *
 * Overall statistics with donut charts for code classification
 * and non-code file distribution.
 */

import React, { useMemo, useState } from 'react';
import type { StructuralPipelineResult } from '../types.js';
import { ROLE_COLORS, CATEGORY_COLORS, CATEGORY_ICONS, healthColor } from '../types.js';

export interface StatsPanelProps {
  data: StructuralPipelineResult;
  /** When set, scope all stats to this set of file IDs (cluster drilldown). */
  clusterFileIds?: Set<string>;
}

// ── SVG donut ───────────────────────────────────────────────────────────

interface Slice {
  label: string;
  value: number;
  color: string;
}

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = ((startDeg - 90) * Math.PI) / 180;
  const e = ((endDeg - 90) * Math.PI) / 180;
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)}`,
    `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`,
  ].join(' ');
}

function Donut({
  slices,
  size = 120,
  thickness = 22,
  centerLabel,
  centerSub,
  hovered,
  onHover,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
  hovered?: string | null;
  onHover?: (label: string | null) => void;
}) {
  const total = slices.reduce((s, sl) => s + sl.value, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2 - 1;

  let deg = 0;
  const arcs = slices
    .filter((sl) => sl.value > 0)
    .map((sl) => {
      const sweep = (sl.value / total) * 360;
      if (sweep < 0.5) { deg += sweep; return null; }
      // Leave a tiny gap between slices
      const gap = slices.length > 1 ? 1.2 : 0;
      const startDeg = deg + gap / 2;
      const endDeg = deg + sweep - gap / 2;
      deg += sweep;
      const isHovered = hovered === sl.label;
      const opacity = hovered == null ? 1 : isHovered ? 1 : 0.35;
      return (
        <path
          key={sl.label}
          d={arc(cx, cy, r, startDeg, endDeg)}
          fill="none"
          stroke={sl.color}
          strokeWidth={isHovered ? thickness + 4 : thickness}
          strokeLinecap="butt"
          opacity={opacity}
          style={{ transition: 'opacity 0.15s, stroke-width 0.15s', cursor: 'default' }}
          onMouseEnter={() => onHover?.(sl.label)}
          onMouseLeave={() => onHover?.(null)}
        >
          <title>{`${sl.label}: ${sl.value.toLocaleString()}`}</title>
        </path>
      );
    });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="sp-donut">
      {arcs}
      {centerLabel && (
        <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="central" className="sp-donut-label">
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="central" className="sp-donut-sub">
          {centerSub}
        </text>
      )}
    </svg>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────

function LegendRow({
  color,
  label,
  value,
  pct,
  extra,
  dim,
  onEnter,
  onLeave,
}: {
  color: string;
  label: string;
  value: string;
  pct: string;
  extra?: string;
  dim?: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  return (
    <div
      className={`sp-legend-row ${dim ? 'sp-legend-row--dim' : ''}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span className="sp-legend-dot" style={{ background: color }} />
      <span className="sp-legend-name">{label}</span>
      <span className="sp-legend-value">{value}</span>
      <span className="sp-legend-pct">{pct}</span>
      {extra && <span className="sp-legend-extra">{extra}</span>}
    </div>
  );
}

// ── fmt helpers ─────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function pct(v: number, t: number): string {
  return t ? `${Math.round((v / t) * 100)}%` : '—';
}

// ── Donut card ──────────────────────────────────────────────────────────

function DonutCard({
  title,
  slices,
  total,
  centerLabel,
  centerSub,
  valueFormatter = (v) => String(v),
  extraFn,
}: {
  title: string;
  slices: Slice[];
  total: number;
  centerLabel: string;
  centerSub: string;
  valueFormatter?: (v: number) => string;
  extraFn?: (label: string) => string | undefined;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">{title}</h3>
      <div className="sp-card-body">
        <Donut
          slices={slices}
          centerLabel={centerLabel}
          centerSub={centerSub}
          hovered={hovered}
          onHover={setHovered}
        />
        <div className="sp-legend">
          {slices
            .filter((s) => s.value > 0)
            .map((s) => (
              <LegendRow
                key={s.label}
                color={s.color}
                label={s.label.replace(/_/g, ' ')}
                value={valueFormatter(s.value)}
                pct={pct(s.value, total)}
                extra={extraFn?.(s.label)}
                dim={hovered != null && hovered !== s.label}
                onEnter={() => setHovered(s.label)}
                onLeave={() => setHovered(null)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function StatsPanel({ data, clusterFileIds }: StatsPanelProps) {
  const isScoped = clusterFileIds != null && clusterFileIds.size > 0;

  const stats = useMemo(() => {
    const allFiles = isScoped
      ? data.fileClassifications.filter((f) => clusterFileIds!.has(f.fileId))
      : data.fileClassifications;

    const code = allFiles.filter((f) => f.category === 'code');
    const nonCode = allFiles.filter((f) => f.category !== 'code');

    const roleMap = new Map<string, { loc: number; n: number }>();
    for (const f of code) {
      const role = f.contentRole ?? 'unknown';
      const e = roleMap.get(role) ?? { loc: 0, n: 0 };
      e.loc += f.linesOfCode ?? 0;
      e.n++;
      roleMap.set(role, e);
    }

    const catMap = new Map<string, { loc: number; n: number }>();
    for (const f of nonCode) {
      const e = catMap.get(f.category) ?? { loc: 0, n: 0 };
      e.loc += f.linesOfCode ?? 0;
      e.n++;
      catMap.set(f.category, e);
    }

    const communities = (data.communities?.communities ?? []).filter(
      (c) => c.memberFileIds.length >= 2,
    );
    const gids = new Set(communities.flatMap((c) => c.memberFileIds));

    // Ungrouped file analysis
    const ungroupedFiles = code.filter((f) => !gids.has(f.fileId));
    const edgeFiles = new Set<string>();
    for (const e of data.weightedEdges) {
      edgeFiles.add(e.sourceFileId);
      edgeFiles.add(e.targetFileId);
    }
    const isolatedCount = ungroupedFiles.filter((f) => !edgeFiles.has(f.fileId)).length;

    // Ungrouped by package
    const ungroupedByPkg = new Map<string, { n: number; loc: number; roles: Map<string, number> }>();
    for (const f of ungroupedFiles) {
      const pkg = f.filePath.replace(/\\/g, '/').split('/')[1] ?? 'root';
      const e = ungroupedByPkg.get(pkg) ?? { n: 0, loc: 0, roles: new Map() };
      e.n++;
      e.loc += f.linesOfCode ?? 0;
      const role = f.contentRole ?? 'unknown';
      e.roles.set(role, (e.roles.get(role) ?? 0) + 1);
      ungroupedByPkg.set(pkg, e);
    }

    return {
      total: allFiles.length,
      codeLoc: code.reduce((s, f) => s + (f.linesOfCode ?? 0), 0),
      totalLoc: allFiles.reduce((s, f) => s + (f.linesOfCode ?? 0), 0),
      codeN: code.length,
      nonCodeN: nonCode.length,
      roles: [...roleMap.entries()]
        .map(([k, v]) => ({ label: k, loc: v.loc, n: v.n, color: ROLE_COLORS[k] ?? ROLE_COLORS.unknown }))
        .sort((a, b) => b.loc - a.loc),
      cats: [...catMap.entries()]
        .map(([k, v]) => ({
          label: `${CATEGORY_ICONS[k] ?? '❓'} ${k.replace(/_/g, ' ')}`,
          rawCat: k,
          loc: v.loc,
          n: v.n,
          color: CATEGORY_COLORS[k] ?? CATEGORY_COLORS.unknown,
        }))
        .sort((a, b) => b.n - a.n),
      grouped: code.filter((f) => gids.has(f.fileId)).length,
      ungrouped: ungroupedFiles.length,
      ungroupedIsolated: isolatedCount,
      ungroupedTiny: ungroupedFiles.length - isolatedCount,
      ungroupedByPkg: [...ungroupedByPkg.entries()]
        .map(([pkg, v]) => ({ pkg, ...v, topRole: [...v.roles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown' }))
        .sort((a, b) => b.n - a.n),
      groups: communities.length,
    };
  }, [data, clusterFileIds, isScoped]);

  // File type overview
  const typeSlices: Slice[] = [
    { label: 'code', value: stats.codeN, color: '#3b82f6' },
    ...stats.cats.map((c) => ({ label: c.label, value: c.n, color: c.color })),
  ];

  // Code roles by files
  const roleByFile: Slice[] = stats.roles.map((r) => ({ label: r.label, value: r.n, color: r.color }));

  // Code roles by LOC
  const roleByLoc: Slice[] = stats.roles.map((r) => ({ label: r.label, value: r.loc, color: r.color }));

  // Non-code
  const ncSlices: Slice[] = stats.cats.map((c) => ({ label: c.label, value: c.n, color: c.color }));

  // Scoped export analysis
  const scopedExports = useMemo(() => {
    if (!data.exportAnalysis) return null;
    const files = isScoped
      ? data.exportAnalysis.files.filter((f) => clusterFileIds!.has(f.fileId))
      : data.exportAnalysis.files;
    const totalExports = files.reduce((s, f) => s + f.totalExports, 0);
    const totalLogicExports = files.reduce((s, f) => s + f.logicExports, 0);
    const totalContractExports = files.reduce((s, f) => s + f.contractExports, 0);
    const deadFileCount = files.filter((f) => f.isDeadFile).length;
    const deadExportLoc = files.filter((f) => f.isDeadFile).reduce((s, f) => s + f.exports.reduce((ss, e) => ss + (e.linesOfCode ?? 0), 0), 0);
    const barrelViolations = isScoped
      ? (data.exportAnalysis.barrelViolations ?? []).filter((v) => {
          const bId = data.fileClassifications.find((f) => f.filePath === v.barrelPath)?.fileId;
          return bId && clusterFileIds!.has(bId);
        })
      : (data.exportAnalysis.barrelViolations ?? []);
    return { files, totalExports, totalLogicExports, totalContractExports, deadFileCount, deadExportLoc, barrelViolations };
  }, [data, clusterFileIds, isScoped]);

  return (
    <div className="sp-root">
      {/* header */}
      <div className="sp-header">
        {!isScoped && (
          <span className="sp-health" style={{ color: healthColor(data.healthScore ?? 0) }}>
            {data.healthScore != null ? Math.round(data.healthScore) : '—'}
          </span>
        )}
        <div className="sp-header-text">
          <span>{stats.total.toLocaleString()} files</span>
          <span className="sp-muted">{fmt(stats.totalLoc)} LOC</span>
        </div>
      </div>

      {/* file types — global only */}
      {!isScoped && (
        <DonutCard
          title="File Types"
          slices={typeSlices}
          total={stats.total}
          centerLabel={String(stats.total)}
          centerSub="total"
        />
      )}

      {/* code by files */}
      <DonutCard
        title="Code Roles — Files"
        slices={roleByFile}
        total={stats.codeN}
        centerLabel={String(stats.codeN)}
        centerSub="code files"
        extraFn={(label) => {
          const r = stats.roles.find((x) => x.label === label);
          return r ? `${fmt(r.loc)} LOC` : undefined;
        }}
      />

      {/* code by LOC */}
      <DonutCard
        title="Code Roles — LOC"
        slices={roleByLoc}
        total={stats.codeLoc}
        centerLabel={fmt(stats.codeLoc)}
        centerSub="code LOC"
        valueFormatter={fmt}
        extraFn={(label) => {
          const r = stats.roles.find((x) => x.label === label);
          return r ? `${r.n} files` : undefined;
        }}
      />

      {/* non-code — global only */}
      {!isScoped && (
        <DonutCard
          title="Non-Code Files"
          slices={ncSlices}
        total={stats.nonCodeN}
        centerLabel={String(stats.nonCodeN)}
        centerSub="non-code"
        extraFn={(label) => {
          const c = stats.cats.find((x) => x.label === label);
          return c && c.loc > 0 ? `${fmt(c.loc)} LOC` : undefined;
        }}
      />
      )}

      {/* grouping — global only */}
      {!isScoped && (
        <div className="sp-card">
          <h3 className="sp-card-title">Dependency Groups</h3>
        <div className="sp-group-row">
          <div className="sp-group-box sp-group-box--ok">
            <strong>{stats.grouped}</strong>
            <span>grouped</span>
          </div>
          <div className="sp-group-box sp-group-box--warn">
            <strong>{stats.ungrouped}</strong>
            <span>ungrouped</span>
          </div>
          <div className="sp-group-box">
            <strong>{stats.groups}</strong>
            <span>groups</span>
          </div>
        </div>

        {stats.ungrouped > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#888', marginBottom: 6 }}>
              Why ungrouped?
            </div>
            <div style={{ fontSize: 12, color: '#a0a0a0', lineHeight: 1.6, marginBottom: 10 }}>
              <strong style={{ color: '#e0e0e0' }}>{stats.ungroupedIsolated}</strong> isolated (no import edges)
              {stats.ungroupedTiny > 0 && (
                <> · <strong style={{ color: '#e0e0e0' }}>{stats.ungroupedTiny}</strong> in tiny groups (&lt;2 files)</>
              )}
            </div>

            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#888', marginBottom: 4 }}>
              By package
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {stats.ungroupedByPkg.map((p) => (
                <div key={p.pkg} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 12, padding: '3px 0', borderBottom: '1px solid #2d2d30',
                }}>
                  <span style={{ color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {p.pkg}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: '#666' }}>{p.topRole.replace('_', ' ')}</span>
                    {p.loc > 0 && <span style={{ fontSize: 10, color: '#555', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.loc)}</span>}
                    <span style={{ fontWeight: 600, color: '#e0e0e0', fontVariantNumeric: 'tabular-nums', minWidth: 18, textAlign: 'right' }}>{p.n}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Export analysis */}
      {scopedExports && scopedExports.totalExports > 0 && (
        <div className="sp-card">
          <h3 className="sp-card-title">Exports</h3>
          <div className="sp-group-row">
            <div className="sp-group-box sp-group-box--ok">
              <strong>{scopedExports.totalExports}</strong>
              <span>total</span>
            </div>
            <div className="sp-group-box" style={{ borderColor: 'rgba(0,122,204,0.3)' }}>
              <strong>{scopedExports.totalLogicExports}</strong>
              <span>logic</span>
            </div>
            <div className="sp-group-box" style={{ borderColor: 'rgba(156,39,176,0.3)' }}>
              <strong>{scopedExports.totalContractExports}</strong>
              <span>contract</span>
            </div>
          </div>

          {scopedExports.deadFileCount > 0 && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.2)' }}>
              <div style={{ fontSize: 12, color: '#f44336', fontWeight: 600 }}>
                {scopedExports.deadFileCount} dead files
              </div>
              <div style={{ fontSize: 11, color: '#a0a0a0', marginTop: 2 }}>
                Exported symbols but no tracked consumer · {fmt(scopedExports.deadExportLoc)} LOC
              </div>
            </div>
          )}

          {/* Barrel violations */}
          {scopedExports.barrelViolations.length > 0 && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,152,0,0.08)', border: '1px solid rgba(255,152,0,0.2)' }}>
              <div style={{ fontSize: 12, color: '#ff9800', fontWeight: 600 }}>
                {scopedExports.barrelViolations.length} out-of-subtree re-export{scopedExports.barrelViolations.length > 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: 11, color: '#a0a0a0', marginTop: 2 }}>
                Barrel files should only re-export from their own folder subtree
              </div>
              <div style={{ maxHeight: 100, overflowY: 'auto', marginTop: 6 }}>
                {scopedExports.barrelViolations.map((v, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#ccc', padding: '2px 0' }}>
                    {v.barrelPath.split('/').slice(-2).join('/')} → <span style={{ color: '#ff9800' }}>{v.targetPath.split('/').slice(-2).join('/')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Re-export barrels */}
          {(() => {
            const barrels = scopedExports.files.filter((f) => f.reexportSources && f.reexportSources.length > 0);
            if (barrels.length === 0) return null;
            return (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#888', marginBottom: 4 }}>
                  Barrel / Re-export files ({barrels.length})
                </div>
                <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                  {barrels.map((f) => (
                    <div key={f.fileId} style={{
                      fontSize: 12, padding: '3px 0', borderBottom: '1px solid #2d2d30',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                        {f.filePath.split('/').slice(-2).join('/')}
                      </span>
                      <span style={{ fontSize: 10, color: '#666', flexShrink: 0, marginLeft: 6 }}>
                        ↳ {f.reexportSources!.length} sources
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
