import { memo } from 'react';
import { EdgeLabelRenderer } from '@xyflow/react';
import { COLORS } from '../types.js';

type EdgeType = 'normal' | 'typeOnly' | 'cycle' | 'merge';

interface EdgeLabelProps {
  /** CSS transform to position the label (provided by React Flow via `labelX`/`labelY`) */
  transform: string;
  weight: number;
  edgeType: EdgeType;
}

const typeColors: Record<EdgeType, string> = {
  normal: COLORS.edgeNormal,
  typeOnly: COLORS.edgeTypeOnly,
  cycle: COLORS.edgeCycle,
  merge: COLORS.edgeMerge,
};

function EdgeLabelInner(props: EdgeLabelProps) {
  const { transform, weight, edgeType } = props;

  const color = typeColors[edgeType];

  const badgeStyle: React.CSSProperties = {
    position: 'absolute',
    transform,
    fontSize: 10,
    fontWeight: 700,
    fontFamily: 'system-ui, sans-serif',
    color: '#fff',
    background: color,
    borderRadius: 8,
    padding: '1px 6px',
    pointerEvents: 'all',
    lineHeight: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  };

  return (
    <EdgeLabelRenderer>
      <div style={badgeStyle}>{weight}</div>
    </EdgeLabelRenderer>
  );
}

export const EdgeLabel = memo(EdgeLabelInner);
