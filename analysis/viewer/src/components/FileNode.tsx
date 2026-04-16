import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type {
  FileClassificationEntry,
  MisplacedFile,
  FileCentrality,
  CodeContentRole,
} from '@aspect/structural';
import { ROLE_COLORS, shortName } from '../types.js';

export interface FileNodeData {
  [key: string]: unknown;
  file: FileClassificationEntry;
  isMisplaced: boolean;
  misplacedInfo?: MisplacedFile;
  centrality?: FileCentrality;
  /** Other community labels this file also belongs to (shared across communities). */
  sharedCommunities?: string[];
}

const handle: React.CSSProperties = { width: 5, height: 5, opacity: 0.3, background: '#888' };

function FileNodeComponent({ data }: NodeProps<Node<FileNodeData>>) {
  const { file, isMisplaced, misplacedInfo, centrality, sharedCommunities } = data;
  const isShared = sharedCommunities && sharedCommunities.length > 0;

  const primaryRole: string =
    file.contentClassification?.role ?? file.contentRole ?? 'unknown';
  const roleColor = ROLE_COLORS[primaryRole] ?? ROLE_COLORS.unknown;
  const fileName = shortName(file.filePath);

  const composition = file.contentClassification?.composition;
  const segments: { role: string; value: number; color: string }[] = [];
  if (composition) {
    for (const [role, value] of Object.entries(composition)) {
      if (value && value > 0) {
        segments.push({
          role,
          value,
          color: ROLE_COLORS[role as CodeContentRole] ?? ROLE_COLORS.unknown,
        });
      }
    }
  }
  const isMixed = segments.length > 1;

  const loc = file.linesOfCode;

  return (
    <div style={{
      width: 220,
      background: '#252526',
      border: `1px solid #3e3e42`,
      borderLeft: `3px solid ${roleColor}`,
      borderRadius: 6,
      padding: '6px 8px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxSizing: 'border-box',
      boxShadow: '0 2px 6px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)',
    }}>
      <Handle type="target" position={Position.Left} style={handle} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {isMisplaced && (
          <span style={{ flexShrink: 0, fontSize: 11, cursor: 'help' }}
            title={`Suggested: ${misplacedInfo?.suggestedDirectory ?? '?'}`}>⚠️</span>
        )}
        <span style={{
          fontSize: 11,
          color: '#ccc',
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }} title={file.filePath}>
          {fileName}
        </span>
        {loc != null && (
          <span style={{ fontSize: 9, color: '#666', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {loc}
          </span>
        )}
        {centrality?.isBridge && (
          <span style={{ flexShrink: 0, fontSize: 9, cursor: 'help' }}
            title="Bridge file">🔗</span>
        )}
        {isShared && (
          <span style={{ flexShrink: 0, fontSize: 9, cursor: 'help', color: '#f59e0b' }}
            title={`Also in: ${sharedCommunities!.join(', ')}`}>⚠</span>
        )}
        <span style={{
          width: 7,
          height: 7,
          borderRadius: 2,
          background: roleColor,
          flexShrink: 0,
        }} title={primaryRole.replace('_', ' ')} />
      </div>

      {isMixed && (
        <div style={{
          display: 'flex',
          width: '100%',
          height: 3,
          borderRadius: 2,
          overflow: 'hidden',
          marginTop: 5,
        }}>
          {segments.map((seg) => (
            <div
              key={seg.role}
              title={`${seg.role} ${Math.round(seg.value * 100)}%`}
              style={{ flex: seg.value, background: seg.color, minWidth: 2 }}
            />
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={handle} />
    </div>
  );
}

export const FileNode = memo(FileNodeComponent);
