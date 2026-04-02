import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { COLORS, pct } from '../types.js';

interface GroupNodeData {
  label: string;
  memberCount: number;
  internalCohesion: number;
  separabilityIndex: number;
  outboundEdges: number;
  inboundEdges: number;
  isWellStructured: boolean;
  isMergeCandidate: boolean;
  healthIndicator: 'good' | 'warning' | 'critical';
  isExpanded: boolean;
}

const healthColor: Record<GroupNodeData['healthIndicator'], string> = {
  good: COLORS.good,
  warning: COLORS.warning,
  critical: COLORS.critical,
};

function GroupNodeInner(props: { data: GroupNodeData }) {
  const { data } = props;

  const borderColor = healthColor[data.healthIndicator];
  const isExpanded = data.isExpanded;
  const minWidth = isExpanded ? 300 : 200;

  const containerStyle: React.CSSProperties = {
    minWidth,
    borderRadius: 10,
    border: `2px ${data.isMergeCandidate ? 'dashed' : 'solid'} ${data.isMergeCandidate ? COLORS.warning : borderColor}`,
    background: data.isWellStructured ? `${COLORS.good}0d` : COLORS.groupBg,
    boxShadow: data.isWellStructured ? `0 0 8px ${COLORS.good}33` : '0 1px 3px rgba(0,0,0,0.08)',
    fontFamily: 'system-ui, sans-serif',
    overflow: 'hidden',
  };

  const titleBarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    background: `${borderColor}18`,
    borderBottom: `1px solid ${COLORS.groupBorder}`,
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: 13,
    color: '#1e293b',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: minWidth - 60,
  };

  const badgeStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    background: `${borderColor}22`,
    color: borderColor,
    borderRadius: 8,
    padding: '1px 6px',
    marginLeft: 6,
    flexShrink: 0,
  };

  const metricsBarStyle: React.CSSProperties = {
    display: 'flex',
    gap: 12,
    padding: '5px 10px',
    fontSize: 11,
    color: '#475569',
  };

  return (
    <div style={containerStyle}>
      <Handle type="target" position={Position.Top} style={{ background: borderColor }} />

      <div style={titleBarStyle}>
        <span style={labelStyle}>{data.label}</span>
        <span style={badgeStyle}>{data.memberCount}</span>
      </div>

      <div style={metricsBarStyle}>
        <span>Cohesion: {pct(data.internalCohesion)}</span>
        <span>Separability: {pct(data.separabilityIndex)}</span>
      </div>

      {isExpanded && (
        <div style={{ minHeight: 60, padding: '4px 10px 8px', fontSize: 10, color: '#94a3b8' }}>
          {/* children file nodes are rendered by React Flow inside this expanded area */}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: borderColor }} />
    </div>
  );
}

export const GroupNode = memo(GroupNodeInner);
