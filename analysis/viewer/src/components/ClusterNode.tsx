import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ClusterQuality } from '@aspect/structural';
import type { ViewerGroup } from '../types.js';
import { ROLE_COLORS, pct } from '../types.js';

export interface ClusterNodeData {
  [key: string]: unknown;
  group: ViewerGroup;
  quality?: ClusterQuality;
  warningCount: number;
  fileCount: number;
  expanded: boolean;
  dominantRole: string;
  totalLoc: number;
  contractHub?: boolean;
  contractSharePct?: number;
}

const handle: React.CSSProperties = { width: 6, height: 6, opacity: 0.3, background: '#888' };

function formatLoc(loc: number): string {
  if (loc >= 1000) return `${(loc / 1000).toFixed(1)}k`;
  return String(loc);
}

function ClusterNodeComponent({ data }: NodeProps<Node<ClusterNodeData>>) {
  const { group, quality, warningCount, fileCount, expanded, dominantRole, totalLoc, contractHub, contractSharePct } = data;
  const ratio = group.cohesionRatio;
  const hasCohesion = ratio != null;
  const roleColor = ROLE_COLORS[dominantRole] ?? ROLE_COLORS.unknown;
  const label = contractHub ? 'Shared contracts' : (group.label || group.id);

  // Glass card — mirrors agent-card aesthetic
  const container: React.CSSProperties = {
    width: '100%',
    minHeight: expanded ? 120 : undefined,
    position: 'relative',
    background: `color-mix(in srgb, ${roleColor} 18%, #252526)`,
    border: contractHub
      ? '2px dashed rgba(6,182,212,0.8)'
      : `1.5px solid color-mix(in srgb, ${roleColor} 30%, #3e3e42)`,
    borderRadius: 8,
    padding: expanded ? '0 0 0' : 0,
    boxSizing: 'border-box',
    WebkitBackdropFilter: 'blur(10px)',
    backdropFilter: 'blur(10px)',
    boxShadow: [
      '0 4px 10px rgba(0,0,0,0.18)',
      `0 0 0 0 color-mix(in srgb, ${roleColor} 20%, transparent)`,
      'inset 0 1px 0 rgba(255,255,255,0.04)',
    ].join(', '),
    overflow: 'hidden',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  // Header strip with role color tint
  const header: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '7px 10px',
    background: contractHub ? 'rgba(6,182,212,0.12)' : 'rgba(255,255,255,0.04)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  };

  const body: React.CSSProperties = {
    padding: expanded ? '6px 10px 4px' : '6px 10px 8px',
  };

  return (
    <div style={container} className={expanded ? 'cluster-node--expanded' : undefined}>
      <Handle type="target" position={Position.Left} style={contractHub ? { ...handle, opacity: 0.15 } : handle} />

      {/* Header — label + file count */}
      <div style={header}>
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#e0e0e0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }} title={label}>
          {label}
        </span>
        <span style={{
          fontSize: 10,
          color: '#888',
          flexShrink: 0,
          marginLeft: 8,
          fontVariantNumeric: 'tabular-nums',
        }}>
            {fileCount} · {formatLoc(totalLoc)} loc
          </span>
      </div>

      {/* Body — cohesion bar + meta */}
      <div style={body}>
        {/* Cohesion bar */}
        {!contractHub && hasCohesion && (
          <div style={{
            width: '100%',
            height: 3,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
            marginBottom: 6,
          }}>
            <div style={{
              width: pct(ratio),
              height: '100%',
              borderRadius: 2,
              background: ratio > 0.7 ? '#4caf50' : ratio > 0.4 ? '#ff9800' : '#f44336',
              transition: 'width 0.2s ease',
            }} />
          </div>
        )}

        {/* Meta row */}
        {!expanded && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            color: '#a0a0a0',
          }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: 2,
              background: roleColor,
              flexShrink: 0,
            }} />
            <span>{contractHub ? 'CommunityGroup glue' : dominantRole.replace('_', ' ')}</span>
            {contractHub && contractSharePct != null && (
              <>
                <span style={{ color: '#555' }}>·</span>
                <span style={{ color: '#67e8f9', fontWeight: 700 }}>{contractSharePct}% contract</span>
              </>
            )}
            {hasCohesion && (
              <>
                <span style={{ color: '#555' }}>·</span>
                <span>{pct(ratio)}</span>
              </>
            )}
            {warningCount > 0 && (
              <>
                <span style={{ color: '#555' }}>·</span>
                <span style={{ color: '#ff9800', fontWeight: 600 }}>⚠ {warningCount}</span>
              </>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={contractHub ? { ...handle, opacity: 0.15 } : handle} />
    </div>
  );
}

export const ClusterNode = memo(ClusterNodeComponent);
