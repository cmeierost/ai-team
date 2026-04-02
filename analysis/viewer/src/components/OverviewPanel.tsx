import React from 'react';
import type {
  AnalysisSummary,
  ArchitecturalSummary,
  GroupCouplingResult,
  CodeRole,
} from '../types.js';
import { COLORS } from '../types.js';

export interface OverviewPanelProps {
  summary: AnalysisSummary;
  architecturalSummary?: ArchitecturalSummary;
  groupCoupling?: GroupCouplingResult;
}

const roleColors: Record<CodeRole, string> = {
  utility: COLORS.utility,
  contract: COLORS.contract,
  business_logic: COLORS.business_logic,
  presentation: COLORS.presentation,
  unknown: COLORS.unknown,
};

const roleLabels: Record<CodeRole, string> = {
  utility: 'Utility',
  contract: 'Contract',
  business_logic: 'Business Logic',
  presentation: 'Presentation',
  unknown: 'Unknown',
};

function scoreColor(score: number): string {
  if (score >= 80) return COLORS.good;
  if (score >= 60) return COLORS.warning;
  return COLORS.critical;
}

function scoreAssessment(score: number, overview?: string): string {
  if (overview) {
    const firstSentence = overview.split(/[.!?]/)[0];
    if (firstSentence.trim()) return firstSentence.trim();
  }
  if (score >= 80) return 'Healthy architecture';
  if (score >= 60) return 'Moderate issues detected';
  return 'Significant architectural concerns';
}

/* ---------- Styles ---------- */

const panelStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  overflowY: 'auto',
  height: '100%',
  boxSizing: 'border-box',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#64748b',
  marginBottom: 8,
};

const metricsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
};

const metricCardStyle: React.CSSProperties = {
  background: '#f8fafc',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const metricValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: '#1e293b',
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#64748b',
};

const issueCardStyle: React.CSSProperties = {
  background: '#f8fafc',
  borderRadius: 8,
  padding: 10,
  borderLeft: `3px solid ${COLORS.warning}`,
  fontSize: 12,
  color: '#334155',
  lineHeight: 1.5,
};

/* ---------- Component ---------- */

export function OverviewPanel({ summary, architecturalSummary, groupCoupling: _gc }: OverviewPanelProps) {
  const score = architecturalSummary?.healthScore ?? summary.healthScore;
  const color = scoreColor(score);

  const totalRoles = Object.values(summary.codeRoleCounts).reduce((a, b) => a + b, 0) || 1;

  const recs = architecturalSummary?.recommendations ?? [];
  const topIssues = recs.slice(0, 3);

  return (
    <div style={panelStyle}>
      {/* --- Health Score --- */}
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 96,
            height: 96,
            borderRadius: '50%',
            border: `4px solid ${color}`,
            background: `${color}12`,
          }}
        >
          <span style={{ fontSize: 36, fontWeight: 800, color }}>{Math.round(score)}</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 13, color: '#475569', lineHeight: 1.4 }}>
          {scoreAssessment(score, architecturalSummary?.overview)}
        </div>
      </div>

      {/* --- Key Metrics --- */}
      <div>
        <div style={sectionTitleStyle}>Key Metrics</div>
        <div style={metricsGridStyle}>
          <MetricCard label="Entities" value={summary.entityCount} />
          <MetricCard label="Modules" value={summary.moduleCount} />
          <MetricCard
            label="Cycles"
            value={summary.cycleCount}
            valueColor={summary.cycleCount > 0 ? COLORS.critical : undefined}
          />
          <MetricCard
            label="Duplication"
            value={`${Math.round(summary.overallDuplicationPercentage)}%`}
            valueColor={summary.overallDuplicationPercentage > 5 ? COLORS.warning : undefined}
          />
          <MetricCard label="Misplaced Files" value={summary.misplacedFileCount} />
          <MetricCard label="Merge Candidates" value={summary.mergeCandidateCount} />
        </div>
      </div>

      {/* --- Code Role Breakdown --- */}
      <div>
        <div style={sectionTitleStyle}>Code Roles</div>
        {/* Stacked bar */}
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 8 }}>
          {(Object.keys(roleColors) as CodeRole[]).map((role) => {
            const count = summary.codeRoleCounts[role] ?? 0;
            const pctVal = (count / totalRoles) * 100;
            if (pctVal === 0) return null;
            return (
              <div
                key={role}
                title={`${roleLabels[role]}: ${count}`}
                style={{ width: `${pctVal}%`, background: roleColors[role], minWidth: pctVal > 0 ? 2 : 0 }}
              />
            );
          })}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: '#475569' }}>
          {(Object.keys(roleColors) as CodeRole[]).map((role) => {
            const count = summary.codeRoleCounts[role] ?? 0;
            return (
              <span key={role} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: roleColors[role], flexShrink: 0 }} />
                {roleLabels[role]}: {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* --- Top Issues --- */}
      {topIssues.length > 0 && (
        <div>
          <div style={sectionTitleStyle}>Top Issues</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topIssues.map((rec) => (
              <div key={rec.id} style={issueCardStyle}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{rec.title}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{rec.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* --- Internal helper --- */

function MetricCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string | number;
  valueColor?: string;
}) {
  return (
    <div style={metricCardStyle}>
      <span style={{ ...metricValueStyle, ...(valueColor ? { color: valueColor } : {}) }}>{value}</span>
      <span style={metricLabelStyle}>{label}</span>
    </div>
  );
}
