import React from 'react';

export interface SuperClusterNodeData {
  [key: string]: unknown;
  label: string;
  communityCount: number;
  fileCount: number;
  contractCount: number;
}

/**
 * A transparent background node that visually groups communities belonging
 * to the same supercluster. Rendered behind cluster nodes via zIndex.
 */
export function SuperClusterNode({ data }: { data: SuperClusterNodeData }) {
  const hasContracts = data.contractCount > 0;

  const borderColor = hasContracts ? 'rgba(6, 182, 212, 0.35)' : 'rgba(148, 163, 184, 0.2)';
  const bgColor = hasContracts ? 'rgba(6, 182, 212, 0.04)' : 'rgba(148, 163, 184, 0.03)';

  const container: React.CSSProperties = {
    width: '100%',
    height: '100%',
    border: `1.5px dashed ${borderColor}`,
    borderRadius: 14,
    background: bgColor,
    position: 'relative',
    pointerEvents: 'none',
  };

  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    top: -10,
    left: 14,
    background: '#1e1e1e',
    padding: '1px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    color: hasContracts ? '#06b6d4' : '#94a3b8',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
  };

  const metaStyle: React.CSSProperties = {
    position: 'absolute',
    top: -10,
    right: 14,
    background: '#1e1e1e',
    padding: '1px 8px',
    borderRadius: 4,
    fontSize: 10,
    color: '#6b7280',
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
  };

  return (
    <div style={container}>
      <div style={labelStyle}>{data.label}</div>
      <div style={metaStyle}>
        {data.communityCount} clusters · {data.fileCount} files
        {hasContracts ? ` · ${data.contractCount} contracts` : ''}
      </div>
    </div>
  );
}
