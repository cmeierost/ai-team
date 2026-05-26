import React from 'react';
import { ROLE_COLORS, shortPath } from '../types.js';

export interface FileGroupNodeData {
  [key: string]: unknown;
  filePath: string;
  entityCount: number;
  totalLoc: number;
  dominantRole: string;
  privateCount: number;
  collapsed?: boolean;
}

/**
 * Background node that visually groups entities belonging to the same file.
 * Rendered behind entity nodes via zIndex — mirrors CommunityGroupNode style.
 * Click to toggle collapsed/expanded.
 */
export function FileGroupNode({ data }: { data: FileGroupNodeData }) {
  const roleColor = ROLE_COLORS[data.dominantRole] ?? ROLE_COLORS.unknown;
  const isCollapsed = data.collapsed === true;

  const container: React.CSSProperties = {
    width: '100%',
    height: '100%',
    border: `1.5px dashed color-mix(in srgb, ${roleColor} 50%, #3e3e42)`,
    borderRadius: isCollapsed ? 6 : 10,
    background: isCollapsed
      ? `color-mix(in srgb, ${roleColor} 14%, #252526)`
      : `color-mix(in srgb, ${roleColor} 6%, transparent)`,
    position: 'relative',
    pointerEvents: 'auto',
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    top: isCollapsed ? 6 : -9,
    left: isCollapsed ? 8 : 10,
    background: isCollapsed ? 'transparent' : '#1e1e1e',
    padding: isCollapsed ? 0 : '1px 7px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    color: roleColor,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: isCollapsed ? 'calc(100% - 100px)' : 'calc(100% - 120px)',
    pointerEvents: 'none',
  };

  const metaStyle: React.CSSProperties = {
    position: 'absolute',
    top: isCollapsed ? 6 : -9,
    right: isCollapsed ? 8 : 10,
    background: isCollapsed ? 'transparent' : '#1e1e1e',
    padding: isCollapsed ? 0 : '1px 7px',
    borderRadius: 4,
    fontSize: 9,
    color: '#6b7280',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };

  const chevron = isCollapsed ? '▸' : '▾';

  return (
    <div style={container} title={`${data.filePath} — click to ${isCollapsed ? 'expand' : 'collapse'}`}>
      <div style={labelStyle}>
        <span style={{ color: '#888', fontSize: 8, marginRight: 4 }}>{chevron}</span>
        {shortPath(data.filePath, 3)}
      </div>
      <div style={metaStyle}>
        {data.entityCount} entities · {data.totalLoc} LOC
        {data.privateCount > 0 ? ` · ${data.privateCount}⊘` : ''}
      </div>
    </div>
  );
}
