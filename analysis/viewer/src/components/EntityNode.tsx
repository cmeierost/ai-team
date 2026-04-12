import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { EntityRefLite } from '../types.js';
import { ROLE_COLORS, shortPath } from '../types.js';

export interface EntityNodeData {
  [key: string]: unknown;
  entity: EntityRefLite;
  focal?: boolean;
}

const handle: React.CSSProperties = { width: 5, height: 5, opacity: 0.3, background: '#888' };

const KIND_GLYPHS: Record<string, string> = {
  class: '◆',
  interface: '◇',
  'type-alias': '◇',
  function: 'ƒ',
  method: 'ƒ',
  enum: 'E',
  namespace: 'N',
  module: 'M',
  field: '•',
  property: '•',
};

function EntityNodeComponent({ data }: NodeProps<Node<EntityNodeData>>) {
  const { entity, focal } = data;

  const concern = entity.classification?.codeConcern ?? 'unknown';
  const roleColor = ROLE_COLORS[concern] ?? ROLE_COLORS.unknown;
  const isExported = entity.classification?.isExported !== false;
  const isTypeOnly = entity.classification?.isTypeOnly === true;
  const loc = entity.rawCounts?.linesOfCode;
  const glyph = KIND_GLYPHS[entity.kind] ?? '·';
  const visibility = entity.classification?.visibility;
  const isPrivate = !isExported || visibility === 'private' || visibility === 'protected';

  return (
    <div style={{
      width: 240,
      background: focal ? '#2a2d35' : '#252526',
      border: focal
        ? `2px solid ${roleColor}`
        : `1px solid ${isPrivate ? '#3e3e42' : '#4e5a65'}`,
      borderLeft: `3px solid ${roleColor}`,
      borderRadius: 6,
      padding: '6px 8px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxSizing: 'border-box',
      opacity: isPrivate ? 0.7 : 1,
      boxShadow: focal
        ? `0 0 16px color-mix(in srgb, ${roleColor} 35%, transparent), 0 2px 6px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)`
        : '0 2px 6px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)',
    }}>
      <Handle type="target" position={Position.Left} style={handle} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 11, color: '#888', flexShrink: 0, width: 12, textAlign: 'center' }}
          title={entity.kind}>{glyph}</span>
        <span style={{
          fontSize: 11,
          color: isPrivate ? '#999' : '#ccc',
          fontStyle: isTypeOnly ? 'italic' : undefined,
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }} title={`${entity.name} (${entity.kind})`}>
          {entity.name}
        </span>
        {loc != null && (
          <span style={{ fontSize: 9, color: '#666', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {loc}
          </span>
        )}
        {isPrivate && (
          <span style={{ fontSize: 8, color: '#f59e0b', flexShrink: 0 }} title="not exported">⊘</span>
        )}
        <span style={{
          width: 7,
          height: 7,
          borderRadius: 2,
          background: roleColor,
          flexShrink: 0,
        }} title={concern} />
      </div>

      <div style={{ fontSize: 9, color: '#555', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={entity.filePath}>
        {shortPath(entity.filePath, 3)}
      </div>

      <Handle type="source" position={Position.Right} style={handle} />
    </div>
  );
}

export const EntityNode = memo(EntityNodeComponent);
