/**
 * useGraphLayout — transforms AnalysisResult into React Flow nodes/edges
 * for a group-level architecture diagram with dagre auto-layout.
 */

import { useMemo, useState, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import type {
  AnalysisResult,
  GroupCouplingProfile,
  Grouping,
  Group,
  CodeRole,
} from '../types.js';
import { healthIndicator, COLORS, shortPath } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Exported data interfaces                                          */
/* ------------------------------------------------------------------ */

export interface GroupNodeData {
  [key: string]: unknown;
  label: string;
  memberCount: number;
  internalCohesion: number;
  separabilityIndex: number;
  outboundEdges: number;
  inboundEdges: number;
  isWellStructured: boolean;
  isMergeCandidate: boolean;
  healthIndicator: 'good' | 'warning' | 'critical';
  isExpanded: boolean;
}

export interface FileNodeData {
  [key: string]: unknown;
  label: string;
  filePath: string;
  codeRole: string;
  isMisplaced: boolean;
  suggestedGroup?: string;
  complexity?: number;
}

export type GroupingMode = 'boundary' | 'reference' | 'directory';

export interface UseGraphLayoutResult {
  nodes: Node[];
  edges: Edge[];
  expandedGroups: Set<string>;
  toggleGroup: (id: string) => void;
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Layout constants                                                  */
/* ------------------------------------------------------------------ */

const GROUP_WIDTH_COLLAPSED = 220;
const GROUP_HEIGHT_COLLAPSED = 90;
const GROUP_WIDTH_EXPANDED = 360;
const GROUP_HEIGHT_EXPANDED_BASE = 140;
const FILE_NODE_WIDTH = 170;
const FILE_NODE_HEIGHT = 36;
const FILE_GRID_COLS = 2;
const FILE_GRID_PAD_X = 12;
const FILE_GRID_PAD_Y = 80; // space below title bar
const FILE_GRID_GAP_X = 10;
const FILE_GRID_GAP_Y = 8;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveGrouping(
  data: AnalysisResult,
  mode: GroupingMode,
): Grouping | undefined {
  switch (mode) {
    case 'boundary':
      return data.boundaryGrouping ?? data.referenceGrouping;
    case 'reference':
      return data.referenceGrouping;
    case 'directory':
      return data.directoryGrouping;
  }
}

/** Build a set of group IDs that participate in any merge candidate. */
function buildMergeCandidateSet(data: AnalysisResult): Set<string> {
  const s = new Set<string>();
  for (const mc of data.groupCoupling?.mergeCandidates ?? []) {
    s.add(mc.groupIdA);
    s.add(mc.groupIdB);
  }
  return s;
}

/** Build a set of well-structured group IDs. */
function buildWellStructuredSet(data: AnalysisResult): Set<string> {
  const s = new Set<string>();
  for (const ws of data.architecturalSummary?.wellStructuredGroups ?? []) {
    s.add(ws.groupId);
  }
  return s;
}

/**
 * Detect group-level cycle edges.
 * Returns a set of "sourceGroupId->targetGroupId" strings where two entities
 * in the same file-level cycle live in different groups.
 */
function buildGroupCycleEdges(
  data: AnalysisResult,
  grouping: Grouping,
): Set<string> {
  const result = new Set<string>();
  const cycles = data.graph?.cycles.cycles;
  if (!cycles || cycles.length === 0) return result;

  // Map entity → group id
  const entityToGroup = new Map<string, string>();
  for (const group of grouping.groups) {
    for (const eid of group.memberEntityIds) {
      entityToGroup.set(eid, group.id);
    }
  }

  for (const cycle of cycles) {
    const ids = cycle.entityIds;
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % ids.length];
      const ga = entityToGroup.get(a);
      const gb = entityToGroup.get(b);
      if (ga && gb && ga !== gb) {
        result.add(`${ga}->${gb}`);
      }
    }
  }
  return result;
}

/** Check if a pair is a merge candidate. */
function isMergePair(
  data: AnalysisResult,
  srcGroupId: string,
  tgtGroupId: string,
): boolean {
  for (const mc of data.groupCoupling?.mergeCandidates ?? []) {
    if (
      (mc.groupIdA === srcGroupId && mc.groupIdB === tgtGroupId) ||
      (mc.groupIdA === tgtGroupId && mc.groupIdB === srcGroupId)
    ) {
      return true;
    }
  }
  return false;
}

/** Pick edge color based on relationship type. */
function edgeColor(
  isMerge: boolean,
  isCycle: boolean,
  typeOnlyRatio: number,
): string {
  if (isMerge) return COLORS.edgeMerge;
  if (isCycle) return COLORS.edgeCycle;
  if (typeOnlyRatio > 0.7) return COLORS.edgeTypeOnly;
  return COLORS.edgeNormal;
}

/** Run dagre layout and return a position map. */
function runDagreLayout(
  groups: Group[],
  expandedGroups: Set<string>,
  edges: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const group of groups) {
    const isExpanded = expandedGroups.has(group.id);
    const rows = Math.ceil(group.memberEntityIds.length / FILE_GRID_COLS);
    const expandedHeight =
      GROUP_HEIGHT_EXPANDED_BASE +
      rows * (FILE_NODE_HEIGHT + FILE_GRID_GAP_Y);
    g.setNode(group.id, {
      width: isExpanded ? GROUP_WIDTH_EXPANDED : GROUP_WIDTH_COLLAPSED,
      height: isExpanded ? expandedHeight : GROUP_HEIGHT_COLLAPSED,
    });
  }

  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const group of groups) {
    const node = g.node(group.id);
    if (node) {
      positions.set(group.id, { x: node.x - node.width / 2, y: node.y - node.height / 2 });
    }
  }
  return positions;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useGraphLayout(
  data: AnalysisResult,
  groupingMode: GroupingMode,
): UseGraphLayoutResult {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const toggleGroup = useCallback((id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  // Resolve the active grouping
  const grouping = useMemo(
    () => resolveGrouping(data, groupingMode),
    [data, groupingMode],
  );

  // Build lookup structures
  const lookups = useMemo(() => {
    const profileMap = new Map<string, GroupCouplingProfile>();
    for (const p of data.groupCoupling?.profiles ?? []) {
      profileMap.set(p.groupId, p);
    }

    const roleMap = new Map<string, CodeRole>();
    for (const c of data.codeRoles?.classifications ?? []) {
      roleMap.set(c.entityId, c.role);
    }

    const misplacedMap = new Map<
      string,
      { suggestedDirectory: string }
    >();
    for (const mf of data.coherence?.misplacedFiles ?? []) {
      misplacedMap.set(mf.entityId, {
        suggestedDirectory: mf.suggestedDirectory,
      });
    }

    const mergeCandidateIds = buildMergeCandidateSet(data);
    const wellStructuredIds = buildWellStructuredSet(data);

    return {
      profileMap,
      roleMap,
      misplacedMap,
      mergeCandidateIds,
      wellStructuredIds,
    };
  }, [data]);

  // Build edges (before layout, since we need them for dagre)
  const groupEdges = useMemo(() => {
    if (!grouping) return [];
    const cycleEdges = buildGroupCycleEdges(data, grouping);
    const pairCouplings = data.groupCoupling?.pairCouplings ?? [];
    const groupIdSet = new Set(grouping.groups.map((g) => g.id));

    return pairCouplings
      .filter(
        (pc) => groupIdSet.has(pc.sourceGroupId) && groupIdSet.has(pc.targetGroupId),
      )
      .map((pc): Edge => {
        const isCycle = cycleEdges.has(
          `${pc.sourceGroupId}->${pc.targetGroupId}`,
        );
        const isMerge = isMergePair(data, pc.sourceGroupId, pc.targetGroupId);
        const typeOnlyRatio =
          pc.totalEdges > 0 ? pc.typeOnlyEdges / pc.totalEdges : 0;
        const color = edgeColor(isMerge, isCycle, typeOnlyRatio);
        const strokeWidth = clamp(pc.totalEdges / 3, 1, 6);

        return {
          id: `edge-${pc.sourceGroupId}-${pc.targetGroupId}`,
          source: pc.sourceGroupId,
          target: pc.targetGroupId,
          style: { strokeWidth, stroke: color },
          animated: isCycle,
          ...(pc.totalEdges > 2 ? { label: `${pc.totalEdges}` } : {}),
        };
      });
  }, [data, grouping]);

  // Build nodes with dagre layout
  const nodes = useMemo(() => {
    if (!grouping) return [];

    const {
      profileMap,
      roleMap,
      misplacedMap,
      mergeCandidateIds,
      wellStructuredIds,
    } = lookups;

    const edgeSources = groupEdges.map((e) => ({
      source: e.source,
      target: e.target,
    }));
    const positions = runDagreLayout(
      grouping.groups,
      expandedGroups,
      edgeSources,
    );

    const result: Node[] = [];

    for (const group of grouping.groups) {
      const pos = positions.get(group.id) ?? { x: 0, y: 0 };
      const profile = profileMap.get(group.id);
      const isExpanded = expandedGroups.has(group.id);

      const nodeData: GroupNodeData = {
        label: group.label,
        memberCount: group.memberEntityIds.length,
        internalCohesion: profile?.internalCohesion ?? 0,
        separabilityIndex: profile?.separabilityIndex ?? 0,
        outboundEdges: profile?.outboundEdges ?? 0,
        inboundEdges: profile?.inboundEdges ?? 0,
        isWellStructured: wellStructuredIds.has(group.id),
        isMergeCandidate: mergeCandidateIds.has(group.id),
        healthIndicator: healthIndicator(
          profile?.separabilityIndex ?? 0,
          profile?.internalCohesion ?? 0,
        ),
        isExpanded,
      };

      result.push({
        id: group.id,
        type: 'groupNode',
        position: pos,
        data: nodeData,
        style: isExpanded
          ? {
              width: GROUP_WIDTH_EXPANDED,
              height:
                GROUP_HEIGHT_EXPANDED_BASE +
                Math.ceil(group.memberEntityIds.length / FILE_GRID_COLS) *
                  (FILE_NODE_HEIGHT + FILE_GRID_GAP_Y),
            }
          : undefined,
      });

      // Expanded: add file child nodes
      if (isExpanded) {
        group.memberEntityIds.forEach((entityId, idx) => {
          const col = idx % FILE_GRID_COLS;
          const row = Math.floor(idx / FILE_GRID_COLS);

          const fileData: FileNodeData = {
            label: shortPath(entityId),
            filePath: entityId,
            codeRole: roleMap.get(entityId) ?? 'unknown',
            isMisplaced: misplacedMap.has(entityId),
            suggestedGroup: misplacedMap.get(entityId)?.suggestedDirectory,
          };

          result.push({
            id: `file-${entityId}`,
            type: 'fileNode',
            position: {
              x: FILE_GRID_PAD_X + col * (FILE_NODE_WIDTH + FILE_GRID_GAP_X),
              y: FILE_GRID_PAD_Y + row * (FILE_NODE_HEIGHT + FILE_GRID_GAP_Y),
            },
            parentId: group.id,
            extent: 'parent' as const,
            data: fileData,
          });
        });
      }
    }

    return result;
  }, [grouping, lookups, expandedGroups, groupEdges]);

  return {
    nodes,
    edges: groupEdges,
    expandedGroups,
    toggleGroup,
    selectedNodeId,
    selectNode,
  };
}
