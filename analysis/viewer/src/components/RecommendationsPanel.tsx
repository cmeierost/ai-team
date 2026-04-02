import React, { useState } from 'react';
import type { Recommendation } from '../types.js';
import { COLORS } from '../types.js';

export interface RecommendationsPanelProps {
  recommendations: Recommendation[];
  onHighlight?: (entityIds: string[], filePaths: string[]) => void;
}

type PriorityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

const priorityColors: Record<string, string> = {
  critical: COLORS.critical,
  high: '#f97316',
  medium: COLORS.warning,
  low: '#3b82f6',
};

const categoryIcons: Record<string, string> = {
  'cycle-break': '🔄',
  'file-move': '📁',
  'group-merge': '🔗',
  'group-separation': '✂️',
  'contract-extraction': '📋',
  'complexity-hotspot': '🔥',
  'dependency-inversion': '⬆️',
};

/* ---------- Styles ---------- */

const panelStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  boxSizing: 'border-box',
};

const headerStyle: React.CSSProperties = {
  padding: '12px 16px 0',
  flexShrink: 0,
};

const countBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 600,
  background: '#f1f5f9',
  color: '#475569',
  borderRadius: 10,
  padding: '2px 10px',
  marginBottom: 10,
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '0 16px 8px',
  flexShrink: 0,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '0 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const cardStyle: React.CSSProperties = {
  background: '#f8fafc',
  borderRadius: 8,
  padding: 10,
  border: '1px solid #e2e8f0',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  color: '#1e293b',
  flex: 1,
};

const descriptionStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  lineHeight: 1.5,
  marginTop: 4,
  marginBottom: 6,
};

const impactBarBg: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: '#e2e8f0',
  marginTop: 6,
};

const highlightBtnStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#3b82f6',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 0',
};

/* ---------- Component ---------- */

export function RecommendationsPanel({ recommendations, onHighlight }: RecommendationsPanelProps) {
  const [filter, setFilter] = useState<PriorityFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered =
    filter === 'all'
      ? recommendations
      : recommendations.filter((r) => r.priority === filter);

  const tabs: PriorityFilter[] = ['all', 'critical', 'high', 'medium', 'low'];

  return (
    <div style={panelStyle}>
      {/* Count badge */}
      <div style={headerStyle}>
        <span style={countBadgeStyle}>{recommendations.length} recommendation{recommendations.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Filter tabs */}
      <div style={tabBarStyle}>
        {tabs.map((t) => {
          const isActive = filter === t;
          const tabStyle: React.CSSProperties = {
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            background: isActive ? '#1e293b' : '#f1f5f9',
            color: isActive ? '#ffffff' : '#64748b',
            textTransform: 'capitalize',
          };
          return (
            <button key={t} style={tabStyle} onClick={() => setFilter(t)}>
              {t}
            </button>
          );
        })}
      </div>

      {/* Cards */}
      <div style={listStyle}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>
            No {filter === 'all' ? '' : filter} recommendations.
          </div>
        )}

        {filtered.map((rec) => {
          const isExpanded = expandedId === rec.id;
          const pColor = priorityColors[rec.priority] ?? '#94a3b8';
          const icon = categoryIcons[rec.category] ?? '📌';

          return (
            <div key={rec.id} style={cardStyle}>
              <div style={cardHeaderStyle}>
                {/* Priority badge */}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 6,
                    color: '#fff',
                    background: pColor,
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {rec.priority}
                </span>
                {/* Category icon */}
                <span title={rec.category} style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
                {/* Title */}
                <span
                  style={{ ...titleStyle, cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                >
                  {rec.title}
                </span>
              </div>

              {/* Description (expandable) */}
              {isExpanded && <div style={descriptionStyle}>{rec.description}</div>}

              {/* Impact bar */}
              <div style={impactBarBg}>
                <div
                  style={{
                    width: `${Math.round(rec.impact * 100)}%`,
                    height: '100%',
                    borderRadius: 2,
                    background: pColor,
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>
                  Impact: {Math.round(rec.impact * 100)}%
                </span>
                {onHighlight && (
                  <button
                    style={highlightBtnStyle}
                    onClick={() => onHighlight(rec.entityIds, rec.filePaths)}
                  >
                    Highlight
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
