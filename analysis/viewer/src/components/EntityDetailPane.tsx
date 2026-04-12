/**
 * EntityDetailPane — shows entity details: kind, concern, metrics,
 * and its relationships (uses / used-by) within the analysis scope.
 */

import React, { useMemo } from 'react';
import type { EntityRefLite, RelationshipRefLite } from '../types.js';
import { ROLE_COLORS } from '../types.js';

export interface EntityDetailPaneProps {
  entityId: string;
  entities?: EntityRefLite[];
  relationships?: RelationshipRefLite[];
}

const KIND_GLYPHS: Record<string, string> = {
  class: '◆', interface: '◇', 'type-alias': '◇', function: 'ƒ',
  method: 'ƒ', enum: 'E', namespace: 'N', module: 'M',
  field: '•', property: '•',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase',
  letterSpacing: '0.04em', margin: '16px 0 6px',
};

const badge: (bg: string) => React.CSSProperties = (bg) => ({
  display: 'inline-block', fontSize: 10, padding: '1px 6px',
  borderRadius: 3, background: bg, color: '#fff', marginRight: 4,
});

const metaRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', fontSize: 11,
  color: '#999', padding: '2px 0',
};

const refItem: React.CSSProperties = {
  fontSize: 11, padding: '4px 8px', borderRadius: 4,
  background: 'rgba(255,255,255,0.03)', marginBottom: 2,
  display: 'flex', alignItems: 'center', gap: 6,
};

export function EntityDetailPane({ entityId, entities = [], relationships = [] }: EntityDetailPaneProps) {
  const entity = useMemo(() => entities.find((e) => e.id === entityId), [entities, entityId]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  const { uses, usedBy, children } = useMemo(() => {
    const uses: { rel: RelationshipRefLite; target: EntityRefLite }[] = [];
    const usedBy: { rel: RelationshipRefLite; source: EntityRefLite }[] = [];
    for (const r of relationships) {
      if (r.sourceEntityId === entityId) {
        const t = entityById.get(r.targetEntityId);
        if (t) uses.push({ rel: r, target: t });
      }
      if (r.targetEntityId === entityId) {
        const s = entityById.get(r.sourceEntityId);
        if (s) usedBy.push({ rel: r, source: s });
      }
    }
    const children = entities.filter((e) => e.parentEntityId === entityId);
    return { uses, usedBy, children };
  }, [entityId, relationships, entityById, entities]);

  if (!entity) {
    return <div style={{ padding: 16, color: '#888' }}>Entity not found</div>;
  }

  const concern = entity.classification?.codeConcern ?? 'unknown';
  const concernCol = ROLE_COLORS[concern] ?? ROLE_COLORS.unknown;
  const isExported = entity.classification?.isExported !== false;
  const vis = entity.classification?.visibility;
  const isPrivate = !isExported || vis === 'private' || vis === 'protected';
  const glyph = KIND_GLYPHS[entity.kind] ?? '·';
  const loc = entity.rawCounts?.linesOfCode;
  const params = entity.rawCounts?.parameterCount;
  const branches = entity.rawCounts?.branchPoints;
  const jsx = entity.rawCounts?.jsxElementCount;

  return (
    <div style={{ padding: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18, color: '#888' }}>{glyph}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#ddd' }}>{entity.name}</span>
      </div>

      {/* Badges */}
      <div style={{ marginBottom: 12 }}>
        <span style={badge(concernCol)}>{concern}</span>
        <span style={badge('#555')}>{entity.kind}</span>
        {isPrivate && <span style={badge('#92400e')}>private</span>}
        {entity.classification?.isTypeOnly && <span style={badge('#6d28d9')}>type-only</span>}
      </div>

      {/* File */}
      <div style={{ fontSize: 11, color: '#777', marginBottom: 8, wordBreak: 'break-all' }}>
        {entity.filePath}
      </div>

      {/* Metrics */}
      {(loc != null || params != null || branches != null || jsx != null) && (
        <div style={{ marginBottom: 8 }}>
          {loc != null && <div style={metaRow}><span>Lines of code</span><span>{loc}</span></div>}
          {params != null && <div style={metaRow}><span>Parameters</span><span>{params}</span></div>}
          {branches != null && <div style={metaRow}><span>Branch points</span><span>{branches}</span></div>}
          {jsx != null && jsx > 0 && <div style={metaRow}><span>JSX elements</span><span>{jsx}</span></div>}
        </div>
      )}

      {/* Children */}
      {children.length > 0 && (
        <>
          <div style={sectionTitle}>Members ({children.length})</div>
          {children.map((c) => {
            const cGlyph = KIND_GLYPHS[c.kind] ?? '·';
            const cConcern = c.classification?.codeConcern ?? 'unknown';
            return (
              <div key={c.id} style={refItem}>
                <span style={{ color: '#888', width: 14, textAlign: 'center' }}>{cGlyph}</span>
                <span style={{ color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span style={{ fontSize: 9, color: ROLE_COLORS[cConcern] ?? '#666' }}>{cConcern}</span>
              </div>
            );
          })}
        </>
      )}

      {/* Uses */}
      {uses.length > 0 && (
        <>
          <div style={sectionTitle}>Uses ({uses.length})</div>
          {uses.map(({ rel, target }) => (
            <div key={`${rel.sourceEntityId}->${rel.targetEntityId}:${rel.kind}`} style={refItem}>
              <span style={{ color: '#888', width: 14, textAlign: 'center' }}>{KIND_GLYPHS[target.kind] ?? '·'}</span>
              <span style={{ color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={`${target.name} (${target.filePath})`}>{target.name}</span>
              <span style={{ fontSize: 9, color: '#666' }}>{rel.kind}</span>
            </div>
          ))}
        </>
      )}

      {/* Used by */}
      {usedBy.length > 0 && (
        <>
          <div style={sectionTitle}>Used by ({usedBy.length})</div>
          {usedBy.map(({ rel, source }) => (
            <div key={`${rel.sourceEntityId}->${rel.targetEntityId}:${rel.kind}`} style={refItem}>
              <span style={{ color: '#888', width: 14, textAlign: 'center' }}>{KIND_GLYPHS[source.kind] ?? '·'}</span>
              <span style={{ color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={`${source.name} (${source.filePath})`}>{source.name}</span>
              <span style={{ fontSize: 9, color: '#666' }}>{rel.kind}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
