import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { COLORS } from '../types.js';

interface FileNodeData {
  label: string;
  filePath: string;
  codeRole: 'utility' | 'contract' | 'business_logic' | 'presentation' | 'unknown';
  isMisplaced: boolean;
  suggestedGroup?: string;
  complexity?: number;
}

const roleColors: Record<FileNodeData['codeRole'], string> = {
  utility: COLORS.utility,
  contract: COLORS.contract,
  business_logic: COLORS.business_logic,
  presentation: COLORS.presentation,
  unknown: COLORS.unknown,
};

const roleLabels: Record<FileNodeData['codeRole'], string> = {
  utility: 'util',
  contract: 'contract',
  business_logic: 'logic',
  presentation: 'ui',
  unknown: '?',
};

function FileNodeInner(props: { data: FileNodeData }) {
  const { data } = props;

  const roleColor = roleColors[data.codeRole];

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    minWidth: 150,
    borderRadius: 6,
    border: `1px solid ${data.isMisplaced ? COLORS.critical + '66' : '#e2e8f0'}`,
    background: data.isMisplaced ? `${COLORS.critical}0a` : COLORS.fileBg,
    fontFamily: 'system-ui, sans-serif',
    overflow: 'hidden',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  };

  const colorBarStyle: React.CSSProperties = {
    width: 4,
    flexShrink: 0,
    background: roleColor,
    borderRadius: '6px 0 0 6px',
  };

  const contentStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 8px',
    flex: 1,
    minWidth: 0,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#1e293b',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1,
    minWidth: 0,
  };

  const roleBadgeStyle: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 600,
    color: roleColor,
    background: `${roleColor}18`,
    borderRadius: 4,
    padding: '1px 4px',
    flexShrink: 0,
  };

  return (
    <div style={containerStyle}>
      <Handle type="target" position={Position.Top} style={{ background: roleColor }} />

      <div style={colorBarStyle} />

      <div style={contentStyle}>
        {data.isMisplaced && <span style={{ flexShrink: 0, fontSize: 12 }} title={`Suggested: ${data.suggestedGroup ?? 'unknown'}`}>⚠️</span>}
        <span style={labelStyle} title={data.filePath}>{data.label}</span>
        <span style={roleBadgeStyle}>{roleLabels[data.codeRole]}</span>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: roleColor }} />
    </div>
  );
}

export const FileNode = memo(FileNodeInner);
