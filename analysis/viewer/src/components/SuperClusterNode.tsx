import React from 'react';

export interface SuperClusterNodeData {
  [key: string]: unknown;
  label: string;
  communityCount: number;
  fileCount: number;
  contractCount: number;
  sharedContractLoc?: number;
  glueContractLoc?: number;
  glueInfrastructureLoc?: number;
  glueOtherLoc?: number;
  glueContractRatio?: number;
  exposureRatio?: number;
  coordinatorScope?: string;
}

/**
 * A transparent background node that visually groups communities belonging
 * to the same supercluster. Rendered behind cluster nodes via zIndex.
 */
export function SuperClusterNode({ data }: { data: SuperClusterNodeData }) {
  const hasContracts = data.contractCount > 0;
  const glueRatio = typeof data.glueContractRatio === 'number' ? Math.round(data.glueContractRatio * 100) : null;
  const glueLooksContractHeavy = glueRatio == null ? hasContracts : glueRatio >= 60;

  const borderColor = glueLooksContractHeavy ? 'rgba(6, 182, 212, 0.45)' : 'rgba(245, 158, 11, 0.35)';
  const bgColor = glueLooksContractHeavy ? 'rgba(6, 182, 212, 0.05)' : 'rgba(245, 158, 11, 0.05)';

  const container: React.CSSProperties = {
    width: '100%',
    height: '100%',
    border: `1.5px dashed ${borderColor}`,
    borderRadius: 14,
    background: bgColor,
    position: 'relative',
    pointerEvents: 'auto',
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
    color: glueLooksContractHeavy ? '#06b6d4' : '#f59e0b',
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
    <div style={container} title={data.coordinatorScope ?? ''}>
      <div style={labelStyle}>{data.label}</div>
      <div style={metaStyle}>
        {data.communityCount} clusters · {data.fileCount} files
        {hasContracts ? ` · ${data.contractCount} contracts` : ''}
        {typeof data.sharedContractLoc === 'number' ? ` · ${Math.round(data.sharedContractLoc)} shared LOC` : ''}
        {glueRatio != null ? ` · glue ${glueRatio}% contract` : ''}
        {typeof data.glueContractLoc === 'number' || typeof data.glueInfrastructureLoc === 'number'
          ? ` (${Math.round(data.glueContractLoc ?? 0)}c/${Math.round(data.glueInfrastructureLoc ?? 0)}i)`
          : ''}
        {typeof data.exposureRatio === 'number' ? ` · ${Math.round(data.exposureRatio * 100)}% exposed` : ''}
      </div>
    </div>
  );
}
