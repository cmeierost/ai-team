import React, { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Edge, type Node } from '@xyflow/react';
import type { EntityRefLite, RelationshipRefLite, FileClassificationEntry } from '../types.js';
import { ROLE_COLORS } from '../types.js';

export interface FileEntitiesPaneProps {
  file?: FileClassificationEntry;
  content?: string;
  entities?: EntityRefLite[];
  relationships?: RelationshipRefLite[];
  scopeFileIds?: Set<string>;
  hideTypeOnly?: boolean;
  onSelectEntity?: (entityId: string) => void;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function clusterKeyFromPath(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean);
  if (parts[0] === 'packages' && parts[1]) return `packages/${parts[1]}`;
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? 'other';
}

function dominantGroupLabel(paths: string[]): string {
  if (paths.length === 0) return 'other';
  const dirs = paths.map((p) => normalizePath(p).split('/').filter(Boolean).slice(0, -1));
  const depthMax = Math.max(...dirs.map((d) => d.length));
  const prefix: string[] = [];
  for (let depth = 0; depth < depthMax; depth++) {
    const counts = new Map<string, number>();
    for (const d of dirs) {
      const seg = d[depth];
      if (!seg) continue;
      counts.set(seg, (counts.get(seg) ?? 0) + 1);
    }
    if (counts.size === 0) break;
    const [seg, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count <= Math.floor(paths.length / 2)) break;
    prefix.push(seg);
  }
  if (prefix[0] === 'packages' && prefix[1]) {
    const pkg = prefix[1];
    const afterSrc = prefix[2] === 'src' ? prefix[3] : prefix[2];
    return afterSrc ? `${pkg}/${afterSrc}` : pkg;
  }
  return prefix.length >= 2 ? `${prefix[0]}/${prefix[1]}` : (prefix[0] ?? clusterKeyFromPath(paths[0]));
}

function countToken(text: string, token: string): number {
  if (!token) return 0;
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return (text.match(re) ?? []).length;
}

function isContractEntity(entity: EntityRefLite): boolean {
  return entity.kind === 'interface'
    || entity.kind === 'type-alias'
    || entity.kind === 'enum'
    || !!entity.classification?.isTypeOnly;
}

function resolveRepoImportPath(fromFilePath: string, modulePath: string): string {
  if (!modulePath.startsWith('.')) return modulePath;
  const fromParts = normalizePath(fromFilePath).split('/').filter(Boolean);
  fromParts.pop();
  const moduleParts = modulePath.split('/').filter(Boolean);
  for (const part of moduleParts) {
    if (part === '.') continue;
    if (part === '..') fromParts.pop();
    else fromParts.push(part);
  }
  return fromParts.join('/');
}

function entityBadgeColor(entity: EntityRefLite): string {
  if (entity.kind === 'interface') return '#8b5cf6';
  if (entity.kind === 'type-alias') return '#a855f7';
  if (entity.kind === 'enum') return '#f43f5e';
  if (entity.kind === 'class') return '#f59e0b';
  if (entity.kind === 'function') return '#3b82f6';
  if (entity.kind === 'method') return '#06b6d4';
  if (entity.kind === 'field' || entity.kind === 'property') return '#22c55e';
  if (entity.classification?.isTypeOnly) return '#8b5cf6';
  return '#9ca3af';
}

function entityKindGlyph(entity: EntityRefLite): string {
  if (entity.kind === 'function') return 'ƒ';
  if (entity.kind === 'method') return 'm';
  if (entity.kind === 'class') return '□';
  if (entity.kind === 'interface') return '◇';
  if (entity.kind === 'type-alias') return '≡';
  if (entity.kind === 'enum') return '∷';
  if (entity.kind === 'field' || entity.kind === 'property') return '•';
  return '·';
}

function deriveEntityConcern(entity: EntityRefLite): 'contract' | 'presentation' | 'logic' | 'unknown' {
  const explicit = entity.classification?.codeConcern;
  if (explicit === 'contract' || explicit === 'presentation' || explicit === 'logic' || explicit === 'unknown') {
    return explicit;
  }
  if (entity.kind === 'interface' || entity.kind === 'type-alias' || entity.kind === 'enum' || entity.classification?.isTypeOnly) {
    return 'contract';
  }
  if ((entity.rawCounts?.jsxElementCount ?? 0) > 0) {
    return 'presentation';
  }
  if (entity.kind === 'function' || entity.kind === 'method' || entity.kind === 'class' || entity.kind === 'field' || entity.kind === 'property') {
    return 'logic';
  }
  return 'unknown';
}

function concernColor(concern: 'contract' | 'presentation' | 'logic' | 'unknown'): string {
  return ROLE_COLORS[concern] ?? ROLE_COLORS.unknown;
}

const INTERNAL_EDGE_KINDS = new Set(['call', 'use', 'reference', 'extend', 'implement', 'override', 'import', 're-export']);
const PROXY_EDGE_KINDS = new Set(['import', 're-export', 'call', 'use', 'reference']);
const REF_COLORS = {
  internal: '#4b5563',
  scoped: '#7c3aed',
  external: '#9ca3af',
} as const;

export function FileEntitiesPane({
  file,
  content,
  entities = [],
  relationships = [],
  scopeFileIds,
  hideTypeOnly = false,
  onSelectEntity,
}: FileEntitiesPaneProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const graph = useMemo(() => {
    if (!file) return {
      nodes: [] as Node[],
      edges: [] as Edge[],
      diagnostics: '',
    };
    const filePath = normalizePath(file.filePath);
    const entityById = new Map(entities.map((e) => [e.id, e]));
    const fileIdByPath = new Map(
      entities
        .filter((e) => e.kind === 'file')
        .map((e) => [normalizePath(e.filePath), e.id]),
    );
    const localEntities = entities.filter((e) => {
      if (normalizePath(e.filePath) !== filePath || e.kind === 'file') return false;
      if (hideTypeOnly && isContractEntity(e)) return false;
      return true;
    });
    const localIds = new Set(localEntities.map((e) => e.id));
    const localByName = new Map(localEntities.map((e) => [e.name, e]));
    const explicitImportRefs: {
      id: string;
      label: string;
      module: string;
      resolvedPath: string;
      group: string;
      isExternal: boolean;
      typeOnly: boolean;
      symbols: string[];
    }[] = [];
    if (content) {
      const importRegex = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const typeOnly = !!match[1];
        if (hideTypeOnly && typeOnly) continue;
        const spec = (match[2] ?? '').replace(/\s+/g, ' ').trim();
        const mod = match[3];
        const symbols = spec
          .replace(/[{}]/g, ' ')
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => p.split(/\s+as\s+/i)[0]?.trim() ?? '')
          .filter(Boolean);
        const resolvedPath = resolveRepoImportPath(filePath, mod);
        const isExternal = !mod.startsWith('.');
        const group = isExternal ? `external/${mod.split('/')[0]}` : clusterKeyFromPath(resolvedPath);
        const label = `${resolvedPath}${symbols.length > 0 ? ` · ${symbols.join(', ')}` : ''}${typeOnly ? ' (type)' : ''}`;
        explicitImportRefs.push({
          id: `outref:${mod}:${spec}:${typeOnly ? 1 : 0}`,
          label,
          module: mod,
          resolvedPath,
          group,
          isExternal,
          typeOnly,
          symbols,
        });
      }
    }
    const isTsxFile = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
    const hasExplicitReactRef = explicitImportRefs.some((r) => r.module === 'react');
    const totalJsxTags = localEntities.reduce((sum, e) => sum + (e.rawCounts?.jsxElementCount ?? 0), 0);
    if (isTsxFile && totalJsxTags > 0 && !hasExplicitReactRef) {
      explicitImportRefs.push({
        id: 'outref:hidden-react-jsx',
        label: 'react (hidden JSX runtime)',
        module: 'react',
        resolvedPath: 'react',
        group: 'external/react',
        isExternal: true,
        typeOnly: false,
        symbols: [],
      });
    }

    const syntheticInternal: RelationshipRefLite[] = [];
    const hasEdge = new Set(
      relationships.map((r) => `${r.sourceEntityId}->${r.targetEntityId}:${r.kind}`),
    );
    const filteredRelationships = hideTypeOnly
      ? relationships.filter((r) => !r.typeOnly)
      : relationships;
    for (const source of localEntities) {
      const isContractSource = isContractEntity(source);
      if (isContractSource) continue;
      const target = localByName.get(`${source.name}Props`);
      if (!target) continue;
      const targetIsContract = isContractEntity(target);
      if (!targetIsContract) continue;
      const key = `${source.id}->${target.id}:reference`;
      if (hasEdge.has(key)) continue;
      hasEdge.add(key);
      if (!hideTypeOnly) syntheticInternal.push({
        sourceEntityId: source.id,
        targetEntityId: target.id,
        kind: 'reference',
        typeOnly: true,
      });
    }
    const effectiveRelationships = syntheticInternal.length > 0
      ? [...filteredRelationships, ...syntheticInternal]
      : filteredRelationships;

    const internalEdges = effectiveRelationships.filter(
      (r) => localIds.has(r.sourceEntityId) && localIds.has(r.targetEntityId),
    ).filter((r) => INTERNAL_EDGE_KINDS.has(r.kind));
    const outgoingExternal = effectiveRelationships.filter(
      (r) => localIds.has(r.sourceEntityId) && !localIds.has(r.targetEntityId),
    );
    const incomingExternal = effectiveRelationships.filter(
      (r) => !localIds.has(r.sourceEntityId) && localIds.has(r.targetEntityId),
    );

    const importedTargets = new Map<string, EntityRefLite>();
    const importedTargetsByCluster = new Map<string, EntityRefLite[]>();
    for (const rel of outgoingExternal) {
      if (!PROXY_EDGE_KINDS.has(rel.kind)) continue;
      const target = entityById.get(rel.targetEntityId);
      if (target && hideTypeOnly && isContractEntity(target)) continue;
      if (!target || importedTargets.has(target.id)) continue;
      importedTargets.set(target.id, target);
      const group = clusterKeyFromPath(target.filePath);
      if (!importedTargetsByCluster.has(group)) importedTargetsByCluster.set(group, []);
      importedTargetsByCluster.get(group)!.push(target);
    }

    const incomingSourceByPath = new Map<string, { path: string; group: string }>();
    for (const rel of incomingExternal) {
      const source = entityById.get(rel.sourceEntityId);
      if (!source || normalizePath(source.filePath) === filePath) continue;
      const sourcePath = normalizePath(source.filePath);
      if (incomingSourceByPath.has(sourcePath)) continue;
      incomingSourceByPath.set(sourcePath, { path: sourcePath, group: clusterKeyFromPath(sourcePath) });
    }

    const contracts: EntityRefLite[] = [];
    const exported: EntityRefLite[] = [];
    const internal: EntityRefLite[] = [];
    for (const entity of localEntities) {
      const isExported = !!entity.classification?.isExported;
      const isContract = entity.kind === 'interface'
        || entity.kind === 'type-alias'
        || !!entity.classification?.isTypeOnly;
      if (isExported && isContract) contracts.push(entity);
      else if (isExported) exported.push(entity);
      else internal.push(entity);
    }

    const laneX = { usedBy: -760, imports: -430, contracts: 20, exported: 420, internal: 820 };
    const laneYStart = 80;
    const rowGap = 100;
    const localClusterKey = clusterKeyFromPath(filePath);
    const groupHeaderHeight = 30;
    const groupItemStep = 50;
    const groupPadding = 10;
    const groupGap = 16;

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const edgeKeys = new Set<string>();
    let droppedUnresolved = 0;
    let containmentAdded = 0;
    const isCollapsed = (groupNodeId: string) => !expandedGroups.has(groupNodeId);

    const addEdge = (edge: Edge) => {
      const key = `${edge.source}->${edge.target}:${edge.label ?? ''}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push(edge);
    };

    const pushLane = (items: EntityRefLite[], lane: 'contracts' | 'exported' | 'internal') => {
      items.forEach((entity, index) => {
        const incoming = effectiveRelationships.filter((r) => r.targetEntityId === entity.id);
        const outgoing = effectiveRelationships.filter((r) => r.sourceEntityId === entity.id);
        const internalIn = incoming.filter((r) => localIds.has(r.sourceEntityId)).length;
        const externalIn = incoming.length - internalIn;
        const internalOut = outgoing.filter((r) => localIds.has(r.targetEntityId)).length;
        const externalOut = outgoing.length - internalOut;
        const scopedIn = incoming.filter((r) => {
          const src = entityById.get(r.sourceEntityId);
          const srcFileId = src ? fileIdByPath.get(normalizePath(src.filePath)) : undefined;
          return !!(scopeFileIds && srcFileId && scopeFileIds.has(srcFileId));
        }).length || (scopeFileIds ? 0 : incoming.length);
        const scopedOut = outgoing.filter((r) => {
          const target = entityById.get(r.targetEntityId);
          const targetFileId = target ? fileIdByPath.get(normalizePath(target.filePath)) : undefined;
          return !!(scopeFileIds && targetFileId && scopeFileIds.has(targetFileId));
        }).length || (scopeFileIds ? 0 : outgoing.length);
        const baseColor = entityBadgeColor(entity);
        const exportedNode = !!entity.classification?.isExported;
        const kindBadge = entityKindGlyph(entity);
        const loc = entity.rawCounts?.linesOfCode ?? 0;
        const concern = deriveEntityConcern(entity);
        const concernBadgeColor = concernColor(concern);
        const concernTint = exportedNode ? `${concernBadgeColor}2b` : `${concernBadgeColor}1f`;
        const p = entity.rawCounts?.parameterCount ?? 0;
        const props = entity.rawCounts?.publicPropertyCount ?? 0;
        const methods = entity.rawCounts?.publicMethodCount ?? 0;
        nodes.push({
          id: entity.id,
          position: { x: laneX[lane], y: laneYStart + index * rowGap },
          data: {
            label: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>{`${exportedNode ? '🟢' : '⚪'} ${kindBadge} ${entity.name}`}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{`LOC:${loc}`}</span>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                      borderRadius: 999,
                      padding: '1px 6px',
                      background: `${concernBadgeColor}22`,
                      color: concernBadgeColor,
                      border: `1px solid ${concernBadgeColor}66`,
                    }}
                  >
                    {concern}
                  </span>
                  <span>{entity.kind}</span>
                </div>
                <div>{`p:${p} · props:${props} · methods:${methods}`}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontWeight: 600 }}>
                  <span style={{ color: REF_COLORS.internal }}>● internal {internalIn}/{internalOut}</span>
                  <span style={{ color: REF_COLORS.scoped }}>● scoped {scopedIn}/{scopedOut}</span>
                  <span style={{ color: REF_COLORS.external }}>● external {externalIn}/{externalOut}</span>
                </div>
              </div>
            ),
          },
          style: {
            width: 360,
            background: `linear-gradient(0deg, ${concernTint}, ${concernTint}), ${exportedNode ? '#1f2937' : '#2d2d30'}`,
            color: exportedNode ? '#e5e7eb' : '#d1d5db',
            border: `1px solid ${exportedNode ? baseColor : `${baseColor}88`}`,
            boxShadow: `inset 3px 0 0 ${baseColor}`,
            borderRadius: 10,
            fontSize: 11,
            padding: 8,
            opacity: exportedNode ? 1 : 0.88,
            outline: `1px solid ${concernBadgeColor}44`,
          },
        });
      });
    };

    pushLane(contracts, 'contracts');
    pushLane(exported, 'exported');
    pushLane(internal, 'internal');

    if (explicitImportRefs.length > 0) {
      const refs = explicitImportRefs.slice(0, 16);
      const refsByGroup = refs.reduce((acc, ref) => {
        if (!acc.has(ref.group)) acc.set(ref.group, []);
        acc.get(ref.group)!.push(ref);
        return acc;
      }, new Map<string, typeof refs>());

      let outRefY = -320;
      const outRefX = 180;
      for (const [group, groupRefs] of [...refsByGroup.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const groupNodeId = `outref-group:${group}`;
        const collapsed = isCollapsed(groupNodeId);
        const externalGroup = group.startsWith('external/');
        const groupLabel = externalGroup
          ? group
          : dominantGroupLabel(groupRefs.map((r) => r.resolvedPath));
        const sameCluster = !externalGroup && group === localClusterKey;
        nodes.push({
          id: groupNodeId,
          position: { x: outRefX - 10, y: outRefY },
          data: { label: `${collapsed ? '▸' : '▾'} OUT REFS · ${groupLabel} (${groupRefs.length})` },
          style: {
            width: 340,
            background: '#111827',
            color: externalGroup ? '#fda4af' : '#67e8f9',
            border: externalGroup ? '1px solid #9f1239' : '1px solid #0e7490',
            borderRadius: collapsed ? 8 : '10px 10px 0 0',
            fontSize: 10,
            padding: 6,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          },
        });
        if (collapsed) {
          outRefY += groupHeaderHeight + groupGap;
          continue;
        }
        const childrenStartY = outRefY + groupHeaderHeight + groupPadding;
        nodes.push({
          id: `outref-frame:${group}`,
          position: { x: outRefX - 10, y: outRefY + groupHeaderHeight - 1 },
          data: { label: '' },
          draggable: false,
          selectable: false,
          zIndex: -1,
          style: {
            width: 340,
            height: Math.max(44, groupRefs.length * groupItemStep + (groupPadding * 2)),
            background: 'transparent',
            border: externalGroup ? '2px solid rgba(244,63,94,0.6)' : '2px solid rgba(14,165,233,0.6)',
            borderRadius: '0 0 10px 10px',
            pointerEvents: 'none',
          },
        });
        let outRefIndex = 0;
        for (const imp of groupRefs) {
          nodes.push({
            id: imp.id,
            position: { x: outRefX, y: childrenStartY + outRefIndex * groupItemStep },
            data: { label: `↗ ${imp.label}` },
            style: {
              width: 320,
              background: '#0f172a',
              color: '#94a3b8',
              border: externalGroup ? '2px solid #f43f5e' : '2px solid #0ea5e9',
              borderRadius: 8,
              fontSize: 11,
              padding: 8,
            },
          });
          outRefIndex++;
        }
        outRefY = outRefY + groupHeaderHeight + Math.max(44, groupRefs.length * groupItemStep + (groupPadding * 2)) + groupGap;
      }

      let weightedEdgeCount = 0;
      for (const entity of localEntities) {
        const entityIsContract = isContractEntity(entity);
        const start = content ? content.indexOf(entity.name) : -1;
        const segment = start >= 0 && content ? content.slice(start, start + 1800) : '';
        for (const imp of refs) {
          if (entityIsContract && !imp.typeOnly) continue;
          if (imp.id !== 'outref:hidden-react-jsx' && start < 0) continue;
          const weight = imp.id === 'outref:hidden-react-jsx'
            ? (entity.rawCounts?.jsxElementCount ?? 0)
            : imp.symbols.reduce((sum, symbol) => sum + countToken(segment, symbol), 0);
          if (weight <= 0) continue;
          addEdge({
            id: `outref:${entity.id}->${imp.id}`,
            source: entity.id,
            target: imp.id,
            label: `ref x${weight}`,
            style: {
              stroke: imp.isExternal ? '#f43f5e' : '#0ea5e9',
              strokeWidth: 1 + Math.min(4, weight * 0.5),
              strokeDasharray: imp.typeOnly ? '4 3' : undefined,
            },
          });
          weightedEdgeCount++;
        }
      }
      if (weightedEdgeCount === 0) {
        const source = exported[0] ?? contracts[0] ?? internal[0];
        if (source) {
          const sourceIsContract = isContractEntity(source);
          refs.forEach((imp) => {
            if (sourceIsContract && !imp.typeOnly) return;
            addEdge({
              id: `outref:fallback:${source.id}->${imp.id}`,
              source: source.id,
              target: imp.id,
              label: imp.typeOnly ? 'ref(type)' : 'ref',
              style: { stroke: '#0ea5e9', strokeDasharray: '5 4', strokeWidth: 1.2 },
            });
          });
        }
      }
    }

    const mainRows = Math.max(contracts.length, exported.length, internal.length, 1);
    const usedByStartY = 20;
    const usesStartY = laneYStart + (mainRows * rowGap) + 120;

    let usedByY = usedByStartY;
    let usedByInternalMinY = Number.POSITIVE_INFINITY;
    let usedByInternalMaxY = Number.NEGATIVE_INFINITY;
    for (const [group, sources] of [...new Map(
      [...incomingSourceByPath.values()].reduce((acc, item) => {
        const list = acc.get(item.group) ?? [];
        list.push(item.path);
        acc.set(item.group, list);
        return acc;
      }, new Map<string, string[]>()),
    ).entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const groupNodeId = `used-by-group:${group}`;
      const collapsed = isCollapsed(groupNodeId);
      const titleX = laneX.usedBy - 10;
      const groupLabel = dominantGroupLabel(sources);
      const sameCluster = group === localClusterKey;
      const groupBodyHeight = Math.max(44, sources.length * groupItemStep + (groupPadding * 2));
      const groupHeight = collapsed ? groupHeaderHeight : groupHeaderHeight + groupBodyHeight;
      nodes.push({
        id: groupNodeId,
        position: { x: titleX, y: usedByY },
        data: { label: `${collapsed ? '▸' : '▾'} ${groupLabel} (${sources.length})${sameCluster ? '' : ' · outside'}` },
        style: {
          width: 270,
          background: '#111827',
          color: sameCluster ? '#93c5fd' : '#fca5a5',
          border: sameCluster
            ? (collapsed ? '1px solid #1e3a8a' : '2px solid #60a5fa')
            : (collapsed ? '1px solid #991b1b' : '2px solid #ef4444'),
          borderRadius: collapsed ? 8 : '10px 10px 0 0',
          fontSize: 10,
          padding: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          boxShadow: collapsed
            ? undefined
            : (sameCluster ? '0 0 0 1px rgba(96,165,250,0.35)' : '0 0 0 1px rgba(239,68,68,0.35)'),
        },
      });
      if (sameCluster) {
        usedByInternalMinY = Math.min(usedByInternalMinY, usedByY);
        usedByInternalMaxY = Math.max(usedByInternalMaxY, usedByY + groupHeight);
      }
      if (collapsed) {
        usedByY += groupHeaderHeight + groupGap;
        continue;
      }
      const childrenStartY = usedByY + groupHeaderHeight + groupPadding;
      nodes.push({
        id: `used-by-frame:${group}`,
        position: { x: titleX, y: usedByY + groupHeaderHeight - 1 },
        data: { label: '' },
        draggable: false,
        selectable: false,
        zIndex: -1,
        style: {
          width: 270,
          height: groupBodyHeight,
          background: sameCluster ? 'transparent' : 'rgba(239,68,68,0.06)',
          border: sameCluster ? '2px solid rgba(96,165,250,0.6)' : '2px solid rgba(239,68,68,0.75)',
          borderRadius: '0 0 10px 10px',
          pointerEvents: 'none',
        },
      });
      let sourceIndex = 0;
      for (const sourcePath of sources.sort()) {
        nodes.push({
          id: `import-src:${sourcePath}`,
          position: { x: laneX.usedBy, y: childrenStartY + sourceIndex * groupItemStep },
          data: { label: `◀ ${sourcePath.split('/').slice(-2).join('/')}` },
          style: {
            width: 250,
            background: '#1f2937',
            color: '#9ca3af',
            border: sameCluster ? '2px solid #2563eb' : '2px solid #ef4444',
            borderRadius: 8,
            fontSize: 11,
            padding: 8,
          },
        });
        sourceIndex++;
      }
      usedByY = usedByY + groupHeaderHeight + Math.max(44, sources.length * groupItemStep + (groupPadding * 2)) + groupGap;
    }
    if (usedByInternalMinY !== Number.POSITIVE_INFINITY) {
      nodes.push({
        id: 'used-by-internal-area',
        position: { x: laneX.usedBy - 22, y: usedByInternalMinY - 10 },
        data: { label: 'inside cluster' },
        draggable: false,
        selectable: false,
        zIndex: -2,
        style: {
          width: 294,
          height: (usedByInternalMaxY - usedByInternalMinY) + 20,
          background: 'rgba(96,165,250,0.06)',
          border: '3px solid rgba(96,165,250,0.9)',
          borderRadius: 14,
          pointerEvents: 'none',
          fontSize: 10,
          color: '#93c5fd',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          padding: 6,
        },
      });
    }

    let usesY = usesStartY;
    let usesInternalMinY = Number.POSITIVE_INFINITY;
    let usesInternalMaxY = Number.NEGATIVE_INFINITY;
    for (const [group, targets] of [...importedTargetsByCluster.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const groupNodeId = `uses-group:${group}`;
      const collapsed = isCollapsed(groupNodeId);
      const titleX = laneX.imports - 10;
      const groupLabel = dominantGroupLabel(targets.map((t) => t.filePath));
      const sameCluster = group === localClusterKey;
      const groupBodyHeight = Math.max(44, targets.length * groupItemStep + (groupPadding * 2));
      const groupHeight = collapsed ? groupHeaderHeight : groupHeaderHeight + groupBodyHeight;
      nodes.push({
        id: groupNodeId,
        position: { x: titleX, y: usesY },
        data: { label: `${collapsed ? '▸' : '▾'} ${groupLabel} (${targets.length})${sameCluster ? '' : ' · outside'}` },
        style: {
          width: 270,
          background: '#111827',
          color: sameCluster ? '#c4b5fd' : '#fca5a5',
          border: sameCluster
            ? (collapsed ? '1px solid #5b21b6' : '2px solid #a78bfa')
            : (collapsed ? '1px solid #991b1b' : '2px solid #ef4444'),
          borderRadius: collapsed ? 8 : '10px 10px 0 0',
          fontSize: 10,
          padding: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          boxShadow: collapsed
            ? undefined
            : (sameCluster ? '0 0 0 1px rgba(167,139,250,0.35)' : '0 0 0 1px rgba(239,68,68,0.35)'),
        },
      });
      if (sameCluster) {
        usesInternalMinY = Math.min(usesInternalMinY, usesY);
        usesInternalMaxY = Math.max(usesInternalMaxY, usesY + groupHeight);
      }
      if (collapsed) {
        usesY += groupHeaderHeight + groupGap;
        continue;
      }
      const childrenStartY = usesY + groupHeaderHeight + groupPadding;
      nodes.push({
        id: `uses-frame:${group}`,
        position: { x: titleX, y: usesY + groupHeaderHeight - 1 },
        data: { label: '' },
        draggable: false,
        selectable: false,
        zIndex: -1,
        style: {
          width: 270,
          height: groupBodyHeight,
          background: sameCluster ? 'transparent' : 'rgba(239,68,68,0.06)',
          border: sameCluster ? '2px solid rgba(167,139,250,0.6)' : '2px solid rgba(239,68,68,0.75)',
          borderRadius: '0 0 10px 10px',
          pointerEvents: 'none',
        },
      });
      let targetIndex = 0;
      for (const imported of targets.sort((a, b) => a.filePath.localeCompare(b.filePath))) {
        const importedPath = normalizePath(imported.filePath);
        const importedName = imported.kind === 'file'
          ? importedPath.split('/').slice(-2).join('/')
          : `${importedPath.split('/').slice(-2).join('/')}#${imported.name}`;
        nodes.push({
          id: `import:${imported.id}`,
          position: { x: laneX.imports, y: childrenStartY + targetIndex * groupItemStep },
          data: { label: `➜ ${importedName}` },
          style: {
            width: 250,
            background: '#252526',
            color: '#b0b0b0',
            border: sameCluster ? '2px solid #7c3aed' : '2px solid #ef4444',
            borderRadius: 8,
            fontSize: 11,
            padding: 8,
          },
        });
        targetIndex++;
      }
      usesY = usesY + groupHeaderHeight + Math.max(44, targets.length * groupItemStep + (groupPadding * 2)) + groupGap;
    }
    if (usesInternalMinY !== Number.POSITIVE_INFINITY) {
      nodes.push({
        id: 'uses-internal-area',
        position: { x: laneX.imports - 22, y: usesInternalMinY - 10 },
        data: { label: 'inside cluster' },
        draggable: false,
        selectable: false,
        zIndex: -2,
        style: {
          width: 294,
          height: (usesInternalMaxY - usesInternalMinY) + 20,
          background: 'rgba(167,139,250,0.06)',
          border: '3px solid rgba(167,139,250,0.9)',
          borderRadius: 14,
          pointerEvents: 'none',
          fontSize: 10,
          color: '#c4b5fd',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          padding: 6,
        },
      });
    }

    // Add contain edges from lexical parent links so internal structure is still visible
    // even when relationship datasets are sparse on symbol-level call/reference edges.
    for (const entity of localEntities) {
      if (!entity.parentEntityId || !localIds.has(entity.parentEntityId)) continue;
      addEdge({
        id: `contain:${entity.parentEntityId}->${entity.id}`,
        source: entity.parentEntityId,
        target: entity.id,
        label: 'contain',
        style: { stroke: '#4b5563', strokeDasharray: '3 3', strokeWidth: 1 },
      });
      containmentAdded++;
    }

    for (const rel of internalEdges) {
      addEdge({
        id: `e:${rel.sourceEntityId}->${rel.targetEntityId}:${rel.kind}`,
        source: rel.sourceEntityId,
        target: rel.targetEntityId,
        label: rel.kind,
        style: { stroke: rel.kind === 're-export' ? '#f59e0b' : '#4b5563', strokeWidth: 1.5 },
        animated: rel.kind === 're-export',
      });
    }

    for (const rel of outgoingExternal) {
      const target = entityById.get(rel.targetEntityId);
      if (!target || !PROXY_EDGE_KINDS.has(rel.kind)) {
        droppedUnresolved++;
        continue;
      }
      const targetGroup = clusterKeyFromPath(target.filePath);
      const targetGroupNodeId = `uses-group:${targetGroup}`;
      const targetNodeId = isCollapsed(targetGroupNodeId) ? targetGroupNodeId : `import:${target.id}`;
      const sameCluster = targetGroup === localClusterKey;
      addEdge({
        id: `x:${rel.sourceEntityId}->${targetNodeId}:${rel.kind}`,
        source: rel.sourceEntityId,
        target: targetNodeId,
        label: rel.kind === 're-export' ? 're-export' : (rel.typeOnly ? 'import(type)' : 'import'),
        style: {
          stroke: rel.kind === 're-export' ? '#f59e0b' : (sameCluster ? '#64748b' : '#ef4444'),
          strokeDasharray: rel.kind === 're-export' ? '6 4' : undefined,
          strokeWidth: sameCluster ? 1.8 : 1.4,
        },
      });
    }

    for (const rel of incomingExternal) {
      const source = entityById.get(rel.sourceEntityId);
      const target = entityById.get(rel.targetEntityId);
      if (!target || !localIds.has(target.id)) {
        droppedUnresolved++;
        continue;
      }
      if (!source || normalizePath(source.filePath) === filePath) continue;
      const sourcePath = normalizePath(source.filePath);
      const sourceGroup = clusterKeyFromPath(sourcePath);
      const sourceGroupNodeId = `used-by-group:${sourceGroup}`;
      const importNodeId = isCollapsed(sourceGroupNodeId) ? sourceGroupNodeId : `import-src:${sourcePath}`;
      const sameCluster = sourceGroup === localClusterKey;
      addEdge({
        id: `in:${importNodeId}->${target.id}:${rel.kind}`,
        source: importNodeId,
        target: target.id,
        label: `ref:${rel.kind}`,
        style: { stroke: sameCluster ? '#64748b' : '#ef4444', strokeDasharray: '4 4', strokeWidth: sameCluster ? 1.6 : 1.4 },
      });
    }

    const diagnostics = `edges:${edges.length} · internal:${internalEdges.length} · synth:${syntheticInternal.length} · importStmt:${explicitImportRefs.length} · contain:${containmentAdded} · dropped:${droppedUnresolved} · entities:${localEntities.length}`;
    return { nodes, edges, diagnostics };
  }, [file, content, entities, relationships, scopeFileIds, hideTypeOnly, expandedGroups]);

  if (!file) {
    return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#888' }}>File not found.</div>;
  }

  if (graph.nodes.length === 0) {
    return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#888' }}>No entity data available for this file.</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%', background: '#1e1e1e', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 10px 0', color: '#9ca3af', fontSize: 11, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: REF_COLORS.internal, fontWeight: 600 }}>● internal refs</span>
        <span style={{ color: REF_COLORS.scoped, fontWeight: 600 }}>● scoped refs</span>
        <span style={{ color: REF_COLORS.external, fontWeight: 600 }}>● external refs</span>
        <span style={{ color: '#ef4444', fontWeight: 700 }}>■ outside cluster</span>
        <span style={{ color: ROLE_COLORS.contract, fontWeight: 600 }}>● contract</span>
        <span style={{ color: ROLE_COLORS.logic, fontWeight: 600 }}>● logic</span>
        <span style={{ color: ROLE_COLORS.presentation, fontWeight: 600 }}>● presentation</span>
      </div>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #2f2f33', color: '#9ca3af', fontSize: 11 }}>
        {graph.diagnostics}
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          onNodeClick={(_evt, node) => {
            if (node.id.startsWith('uses-group:') || node.id.startsWith('used-by-group:') || node.id.startsWith('outref-group:')) {
              setExpandedGroups((prev) => {
                const next = new Set(prev);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              });
              return;
            }
            if (
              node.id.startsWith('import:')
              || node.id.startsWith('import-src:')
              || node.id.startsWith('outref:')
              || node.id.endsWith('-internal-area')
            ) return;
            onSelectEntity?.(node.id);
          }}
          fitView
          minZoom={0.15}
          maxZoom={2.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} color="#2f2f33" />
          <Controls position="bottom-left" />
          <MiniMap pannable zoomable style={{ background: '#252526', border: '1px solid #3e3e42' }} />
        </ReactFlow>
      </div>
    </div>
  );
}
