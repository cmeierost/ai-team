import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { WorkflowDefinitionDocument, WorkflowDefinitionState } from '@ai-team/api-client';

const COLUMN_GAP = 420;
const ROW_GAP = 420;
const ERROR_LANE_X = 1080;
const ERROR_LANE_NODE_GAP = 240;
const NODE_WIDTH = 320;
const NODE_HALF_WIDTH = NODE_WIDTH / 2;
const EDGE_DETOUR_CLEARANCE = 120;
const RETURN_EDGE_OUTER_PUSH = 220;

interface WorkflowEdgeRoutingData {
  laneX: number;
}

type HorizontalDirection = 'left' | 'right';

export interface WorkflowStateOrderEntry {
  stateId: string;
  depth: number;
  order: number;
  invokeSrc?: string;
  transitionCount: number;
}

export interface WorkflowCallFlowBranch {
  event: string;
  count: number;
}

export interface WorkflowCallFlowEntry {
  stateId: string;
  depth: number;
  order: number;
  invokeSrc: string;
  beforeEvents: WorkflowCallFlowBranch[];
  afterEvents: WorkflowCallFlowBranch[];
  failureEvents: WorkflowCallFlowBranch[];
}

export interface WorkflowCallNodeData extends Record<string, unknown> {
  stateId: string;
  order: number;
  invokeSrc: string;
  beforeEvents: WorkflowCallFlowBranch[];
  afterEvents: WorkflowCallFlowBranch[];
  failureEvents: WorkflowCallFlowBranch[];
  hasErrorHandler: boolean;
  showErrorDetails: boolean;
}

export interface WorkflowVisualizationOptions {
  includeErrorPaths?: boolean;
}

interface WorkflowCallEdgeTarget {
  targetStateId: string;
  kind: 'success' | 'failure';
  triggerEvents: string[];
}

interface WorkflowNearestCallTarget {
  targetStateId: string;
  branchLabels: string[];
}

function escapeMermaidLabel(value: string): string {
  return value.replaceAll('"', String.raw`\"`);
}

function mapCallStateToMermaidNodeIds(
  callFlowEntries: WorkflowCallFlowEntry[]
): Map<string, string> {
  return new Map(callFlowEntries.map((entry, index) => [entry.stateId, `n${index + 1}`]));
}

const MERMAID_LINE_BREAK = String.raw`\n`;

function getStateDepths(definition: WorkflowDefinitionDocument): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: string[] = [];

  if (definition.states[definition.initial]) {
    depths.set(definition.initial, 0);
    queue.push(definition.initial);
  }

  while (queue.length > 0) {
    const currentStateId = queue.shift();
    if (!currentStateId) {
      continue;
    }

    const currentDepth = depths.get(currentStateId) ?? 0;
    const currentState = definition.states[currentStateId];

    for (const transition of currentState.transitions) {
      const target = transition.target;
      if (!target || !definition.states[target]) {
        continue;
      }

      const proposedDepth = currentDepth + 1;
      const existingDepth = depths.get(target);
      if (existingDepth === undefined || proposedDepth < existingDepth) {
        depths.set(target, proposedDepth);
        queue.push(target);
      }
    }
  }

  return depths;
}

function reorderLayersToReduceCrossings(
  definition: WorkflowDefinitionDocument,
  layers: Map<number, string[]>,
  depths: Map<string, number>
): void {
  const sortedDepths = [...layers.keys()].sort((left, right) => left - right);

  for (const depth of sortedDepths) {
    if (depth <= 0) {
      continue;
    }

    const previousLayer = layers.get(depth - 1) ?? [];
    const currentLayer = layers.get(depth) ?? [];
    if (currentLayer.length <= 1 || previousLayer.length === 0) {
      continue;
    }

    const previousIndexByState = new Map(previousLayer.map((stateId, index) => [stateId, index]));

    const scored = currentLayer.map((stateId) => {
      const incomingIndices: number[] = [];

      for (const [sourceStateId, sourceState] of Object.entries(definition.states)) {
        if ((depths.get(sourceStateId) ?? -1) !== depth - 1) {
          continue;
        }

        const targetsCurrentState = sourceState.transitions.some(
          (transition) => transition.target === stateId
        );
        if (!targetsCurrentState) {
          continue;
        }

        const sourceIndex = previousIndexByState.get(sourceStateId);
        if (sourceIndex !== undefined) {
          incomingIndices.push(sourceIndex);
        }
      }

      const score =
        incomingIndices.length > 0
          ? incomingIndices.reduce((sum, value) => sum + value, 0) / incomingIndices.length
          : Number.POSITIVE_INFINITY;

      return {
        stateId,
        score,
      };
    });

    scored.sort((left, right) => {
      if (left.score === right.score) {
        return left.stateId.localeCompare(right.stateId);
      }

      return left.score - right.score;
    });

    layers.set(
      depth,
      scored.map((entry) => entry.stateId)
    );
  }
}

function mapStatesToLayers(definition: WorkflowDefinitionDocument): {
  layers: Map<number, string[]>;
  depths: Map<string, number>;
} {
  const depths = getStateDepths(definition);
  const stateIds = Object.keys(definition.states);
  const maxKnownDepth = Math.max(...depths.values(), 0);

  const unreachableStateIds = stateIds.filter((stateId) => !depths.has(stateId));
  unreachableStateIds.forEach((stateId) => depths.set(stateId, maxKnownDepth + 1));

  const layers = new Map<number, string[]>();
  for (const stateId of stateIds) {
    const depth = depths.get(stateId) ?? 0;
    const layer = layers.get(depth) ?? [];
    layer.push(stateId);
    layers.set(depth, layer);
  }

  for (const [depth, stateIdsAtDepth] of layers.entries()) {
    const sorted = [...stateIdsAtDepth].sort((left, right) => {
      if (left === definition.initial) {
        return -1;
      }
      if (right === definition.initial) {
        return 1;
      }
      return left.localeCompare(right);
    });
    layers.set(depth, sorted);
  }

  reorderLayersToReduceCrossings(definition, layers, depths);

  return {
    layers,
    depths,
  };
}

export function computeWorkflowStateOrder(
  definition: WorkflowDefinitionDocument
): WorkflowStateOrderEntry[] {
  const { layers, depths } = mapStatesToLayers(definition);
  const sortedDepths = [...layers.keys()].sort((left, right) => left - right);

  const orderedEntries: WorkflowStateOrderEntry[] = [];
  let order = 1;

  for (const depth of sortedDepths) {
    const stateIdsAtDepth = layers.get(depth) ?? [];
    stateIdsAtDepth.forEach((stateId) => {
      const state = definition.states[stateId];
      orderedEntries.push({
        stateId,
        depth: depths.get(stateId) ?? depth,
        order,
        invokeSrc: state.invoke?.src,
        transitionCount: state.transitions.length,
      });
      order += 1;
    });
  }

  return orderedEntries;
}

function isFailureEvent(eventName: string): boolean {
  return /(fail|error|deny|denied|abort|cancel|timeout|invalid)/i.test(eventName);
}

function formatTransitionBranchLabel(
  transition: WorkflowDefinitionState['transitions'][number]
): string {
  const eventName = transition.event;
  const guardName = transition.guard;

  if (guardName && /^(done|always)$/i.test(eventName)) {
    return guardName;
  }

  if (guardName) {
    return `${eventName} [${guardName}]`;
  }

  return eventName;
}

function mergeBranchCounts(container: Map<string, number>, eventName: string, increment = 1): void {
  container.set(eventName, (container.get(eventName) ?? 0) + increment);
}

function mapBranchCountsToSortedList(branchCounts: Map<string, number>): WorkflowCallFlowBranch[] {
  return [...branchCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([event, count]) => ({ event, count }));
}

function splitOutgoingBranchesByOutcome(state: WorkflowDefinitionState): {
  afterEvents: WorkflowCallFlowBranch[];
  failureEvents: WorkflowCallFlowBranch[];
} {
  const afterCounts = new Map<string, number>();
  const failureCounts = new Map<string, number>();

  state.transitions.forEach((transition) => {
    if (isFailureEvent(transition.event)) {
      mergeBranchCounts(failureCounts, transition.event);
      return;
    }

    mergeBranchCounts(afterCounts, transition.event);
  });

  return {
    afterEvents: mapBranchCountsToSortedList(afterCounts),
    failureEvents: mapBranchCountsToSortedList(failureCounts),
  };
}

export function computeWorkflowCallFlow(
  definition: WorkflowDefinitionDocument
): WorkflowCallFlowEntry[] {
  const orderedStates = computeWorkflowStateOrder(definition);
  const callStates = orderedStates.filter(
    (entry) => typeof entry.invokeSrc === 'string' && entry.invokeSrc.length > 0
  );

  if (callStates.length === 0) {
    return [];
  }

  const callStateIds = new Set(callStates.map((entry) => entry.stateId));
  const beforeEventCountsByState = new Map<string, Map<string, number>>();

  for (const [, sourceState] of Object.entries(definition.states)) {
    sourceState.transitions.forEach((transition) => {
      const targetStateId = transition.target;
      if (!targetStateId || !callStateIds.has(targetStateId)) {
        return;
      }

      const incomingEventCounts =
        beforeEventCountsByState.get(targetStateId) ?? new Map<string, number>();
      mergeBranchCounts(incomingEventCounts, transition.event);
      beforeEventCountsByState.set(targetStateId, incomingEventCounts);
    });
  }

  return callStates.map((entry) => {
    const state = definition.states[entry.stateId];
    const { afterEvents, failureEvents } = splitOutgoingBranchesByOutcome(state);

    return {
      stateId: entry.stateId,
      depth: entry.depth,
      order: entry.order,
      invokeSrc: entry.invokeSrc ?? 'unknown-call',
      beforeEvents: mapBranchCountsToSortedList(
        beforeEventCountsByState.get(entry.stateId) ?? new Map<string, number>()
      ),
      afterEvents,
      failureEvents,
    };
  });
}

export function buildWorkflowCallFlowMermaid(
  definition: WorkflowDefinitionDocument,
  options: WorkflowVisualizationOptions = {}
): string {
  const includeErrorPaths = options.includeErrorPaths ?? true;
  const callFlowEntries = computeWorkflowCallFlow(definition);

  if (callFlowEntries.length === 0) {
    return ['flowchart TB', '  empty["No invoked workflow steps found"]'].join('\n');
  }

  const callStateIds = new Set(callFlowEntries.map((entry) => entry.stateId));
  const nodeIdByStateId = mapCallStateToMermaidNodeIds(callFlowEntries);

  const lines: string[] = [
    'flowchart TB',
    '  classDef wfError fill:#3d1f28,stroke:#f38ba8,color:#fce7ef,stroke-width:2px',
    '  classDef wfCall fill:#1f2b3a,stroke:#7f8ea3,color:#e6edf3,stroke-width:1.5px',
    '  classDef wfHasError fill:#352b17,stroke:#f0b429,color:#fff2d6,stroke-width:1.5px',
  ];
  const errorLinkStyles: string[] = [];
  let edgeIndex = 0;

  callFlowEntries.forEach((entry) => {
    const nodeId = nodeIdByStateId.get(entry.stateId);
    if (!nodeId) {
      return;
    }

    const hasErrorHandler = entry.failureEvents.length > 0;
    const handlerSuffix =
      hasErrorHandler && !includeErrorPaths ? `${MERMAID_LINE_BREAK}⚠ error handler` : '';
    const nodeLabel = `${entry.order}. ${entry.stateId}${MERMAID_LINE_BREAK}${entry.invokeSrc}${handlerSuffix}`;
    let nodeClass = 'wfCall';
    if (isErrorCallFlowEntry(entry)) {
      nodeClass = 'wfError';
    } else if (hasErrorHandler && !includeErrorPaths) {
      nodeClass = 'wfHasError';
    }

    lines.push(`  ${nodeId}["${escapeMermaidLabel(nodeLabel)}"]`, `  class ${nodeId} ${nodeClass}`);
  });

  callFlowEntries.forEach((entry) => {
    const sourceNodeId = nodeIdByStateId.get(entry.stateId);
    if (!sourceNodeId) {
      return;
    }

    const nextTargets = getSimplifiedNextCallTargets(definition, entry.stateId, callStateIds);
    nextTargets.forEach((target) => {
      if (!includeErrorPaths && target.kind === 'failure') {
        return;
      }

      const targetNodeId = nodeIdByStateId.get(target.targetStateId);
      if (!targetNodeId) {
        return;
      }

      const isFailure = target.kind === 'failure';
      const edgeLabel = `${isFailure ? '❌ error' : '✅ then'}: ${target.triggerEvents.join(', ')}`;
      const arrow = isFailure ? '-.->' : '-->';
      lines.push(`  ${sourceNodeId} ${arrow}|"${escapeMermaidLabel(edgeLabel)}"| ${targetNodeId}`);

      if (isFailure) {
        errorLinkStyles.push(
          `  linkStyle ${edgeIndex} stroke:#f38ba8,stroke-width:3px,color:#fce7ef,stroke-dasharray: 6 4`
        );
      }

      edgeIndex += 1;
    });
  });

  if (errorLinkStyles.length > 0) {
    lines.push(...errorLinkStyles);
  }

  return lines.join('\n');
}

function getNodeClassNames(
  stateId: string,
  state: WorkflowDefinitionState,
  initialStateId: string
) {
  return [
    'workflow-graph-node',
    stateId === initialStateId ? 'workflow-graph-node-initial' : '',
    state.type === 'final' ? 'workflow-graph-node-final' : '',
    state.invoke?.src ? 'workflow-graph-node-invoked' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function isErrorCallFlowEntry(entry: WorkflowCallFlowEntry): boolean {
  return /(fail|error)/i.test(entry.stateId) || /(fail|error)/i.test(entry.invokeSrc);
}

function findNearestCallTargetsWithLabels(
  definition: WorkflowDefinitionDocument,
  startStateId: string,
  callStateIds: Set<string>,
  fallbackLabel: string
): WorkflowNearestCallTarget[] {
  if (!definition.states[startStateId]) {
    return [];
  }

  const discovered = new Map<string, Set<string>>();
  const queue: Array<{ stateId: string; firstLabel?: string }> = [
    {
      stateId: startStateId,
      firstLabel: undefined,
    },
  ];
  const visitedByStateAndLabel = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const { stateId, firstLabel } = current;
    if (!definition.states[stateId]) {
      continue;
    }

    const visitKey = `${stateId}|${firstLabel ?? ''}`;
    if (visitedByStateAndLabel.has(visitKey)) {
      continue;
    }

    visitedByStateAndLabel.add(visitKey);

    if (callStateIds.has(stateId)) {
      const labelsForTarget = discovered.get(stateId) ?? new Set<string>();
      labelsForTarget.add(firstLabel ?? fallbackLabel);
      discovered.set(stateId, labelsForTarget);
      continue;
    }

    definition.states[stateId].transitions.forEach((transition) => {
      if (transition.target) {
        queue.push({
          stateId: transition.target,
          firstLabel: firstLabel ?? formatTransitionBranchLabel(transition),
        });
      }
    });
  }

  return [...discovered.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([targetStateId, labels]) => ({
      targetStateId,
      branchLabels: [...labels.values()].sort((left, right) => left.localeCompare(right)),
    }));
}

function getSimplifiedNextCallTargets(
  definition: WorkflowDefinitionDocument,
  sourceCallStateId: string,
  callStateIds: Set<string>
): WorkflowCallEdgeTarget[] {
  const sourceState = definition.states[sourceCallStateId];
  if (!sourceState) {
    return [];
  }

  const byTargetAndKind = new Map<string, WorkflowCallEdgeTarget>();

  sourceState.transitions.forEach((transition) => {
    if (!transition.target) {
      return;
    }

    const fallbackLabel = formatTransitionBranchLabel(transition);
    const targets = findNearestCallTargetsWithLabels(
      definition,
      transition.target,
      callStateIds,
      fallbackLabel
    );

    if (targets.length === 0) {
      return;
    }

    const kind: WorkflowCallEdgeTarget['kind'] = isFailureEvent(transition.event)
      ? 'failure'
      : 'success';

    targets.forEach((target) => {
      const targetStateId = target.targetStateId;
      const key = `${targetStateId}:${kind}`;
      const existing = byTargetAndKind.get(key);

      if (!existing) {
        byTargetAndKind.set(key, {
          targetStateId,
          kind,
          triggerEvents: target.branchLabels,
        });
        return;
      }

      target.branchLabels.forEach((branchLabel) => {
        if (!existing.triggerEvents.includes(branchLabel)) {
          existing.triggerEvents.push(branchLabel);
        }
      });
    });
  });

  return [...byTargetAndKind.values()].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'success' ? -1 : 1;
    }
    return left.targetStateId.localeCompare(right.targetStateId);
  });
}

function getHorizontalDirection(
  sourceX: number,
  targetX: number,
  isFailure: boolean
): HorizontalDirection {
  if (Math.abs(sourceX - targetX) < 8) {
    return isFailure ? 'right' : 'left';
  }

  return targetX >= sourceX ? 'right' : 'left';
}

function computeEdgeLaneX(
  sourceX: number,
  targetX: number,
  direction: HorizontalDirection,
  isFailure: boolean,
  isBackward: boolean,
  edgeIndex: number
): number {
  const sourceRight = sourceX + NODE_HALF_WIDTH;
  const sourceLeft = sourceX - NODE_HALF_WIDTH;
  const targetRight = targetX + NODE_HALF_WIDTH;
  const targetLeft = targetX - NODE_HALF_WIDTH;

  const failureOffset = isFailure ? 140 : 0;
  const perEdgeOffset = edgeIndex * 24;

  if (direction === 'right') {
    if (isBackward) {
      return (
        Math.max(sourceRight, targetRight, ERROR_LANE_X) +
        EDGE_DETOUR_CLEARANCE +
        RETURN_EDGE_OUTER_PUSH +
        failureOffset +
        perEdgeOffset
      );
    }

    const rightCorridorStart = sourceRight;
    const rightCorridorEnd = targetLeft;

    if (rightCorridorEnd > rightCorridorStart + 28) {
      return rightCorridorStart + (rightCorridorEnd - rightCorridorStart) / 2 + edgeIndex * 12;
    }

    return (
      Math.max(sourceRight, targetRight, ERROR_LANE_X) +
      EDGE_DETOUR_CLEARANCE +
      failureOffset +
      perEdgeOffset
    );
  }

  if (isBackward) {
    return (
      Math.min(sourceLeft, targetLeft) -
      EDGE_DETOUR_CLEARANCE -
      RETURN_EDGE_OUTER_PUSH -
      failureOffset -
      perEdgeOffset
    );
  }

  const leftCorridorStart = sourceLeft;
  const leftCorridorEnd = targetRight;

  if (leftCorridorStart > leftCorridorEnd + 28) {
    return leftCorridorStart - (leftCorridorStart - leftCorridorEnd) / 2 - edgeIndex * 12;
  }

  return Math.min(sourceLeft, targetLeft) - EDGE_DETOUR_CLEARANCE - failureOffset - perEdgeOffset;
}

function getSourceHandleId(laneX: number, sourceX: number, isFailure: boolean): string {
  const exitsFromLeft = laneX <= sourceX;

  if (isFailure) {
    return exitsFromLeft ? 'out-error-left' : 'out-error-right';
  }

  return exitsFromLeft ? 'out-success-left' : 'out-success-right';
}

function getTargetHandleId(laneX: number, targetX: number): string {
  const entersFromLeft = laneX <= targetX;
  return entersFromLeft ? 'in-left' : 'in-right';
}

function avoidNodeColumns(
  laneX: number,
  direction: HorizontalDirection,
  occupiedNodeCenters: readonly number[]
): number {
  const minimumColumnClearance = NODE_HALF_WIDTH + 30;
  const nudgeStep = 26;

  let adjustedLaneX = laneX;
  let attempts = 0;

  while (
    attempts < 40 &&
    occupiedNodeCenters.some(
      (centerX) => Math.abs(adjustedLaneX - centerX) < minimumColumnClearance
    )
  ) {
    adjustedLaneX += direction === 'right' ? nudgeStep : -nudgeStep;
    attempts += 1;
  }

  return adjustedLaneX;
}

export function transformWorkflowDefinitionToReactFlow(
  definition: WorkflowDefinitionDocument,
  options: WorkflowVisualizationOptions = {}
) {
  const includeErrorPaths = options.includeErrorPaths ?? true;
  const callFlowEntries = computeWorkflowCallFlow(definition);
  const visibleCallFlowEntries = includeErrorPaths
    ? callFlowEntries
    : callFlowEntries.filter((entry) => !isErrorCallFlowEntry(entry));
  const callStateIds = new Set(visibleCallFlowEntries.map((entry) => entry.stateId));
  const nodeXByStateId = new Map<string, number>();

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const mainCallFlowEntries = visibleCallFlowEntries.filter(
    (entry) => !isErrorCallFlowEntry(entry)
  );
  const errorCallFlowEntries = includeErrorPaths
    ? visibleCallFlowEntries
        .filter((entry) => isErrorCallFlowEntry(entry))
        .sort((left, right) => left.order - right.order)
    : [];

  const entriesByDepth = new Map<number, WorkflowCallFlowEntry[]>();
  mainCallFlowEntries.forEach((entry) => {
    const layerEntries = entriesByDepth.get(entry.depth) ?? [];
    layerEntries.push(entry);
    entriesByDepth.set(entry.depth, layerEntries);
  });

  const sortedDepths = [...entriesByDepth.keys()].sort((left, right) => left - right);
  const maxMainDepth = sortedDepths.reduce((lastDepth, depth) => depth, 0);
  const errorSinkDepth = maxMainDepth + 1;

  sortedDepths.forEach((depth) => {
    const layer = (entriesByDepth.get(depth) ?? []).sort((left, right) => left.order - right.order);
    const mainCenterOffset = (layer.length - 1) / 2;

    layer.forEach((entry, index) => {
      const state = definition.states[entry.stateId];
      const x = (index - mainCenterOffset) * COLUMN_GAP;

      nodes.push({
        id: entry.stateId,
        type: 'workflowCallNode',
        className: getNodeClassNames(entry.stateId, state, definition.initial),
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        position: {
          x,
          y: depth * ROW_GAP,
        },
        data: {
          stateId: entry.stateId,
          order: entry.order,
          invokeSrc: entry.invokeSrc,
          beforeEvents: entry.beforeEvents,
          afterEvents: entry.afterEvents,
          failureEvents: includeErrorPaths ? entry.failureEvents : [],
          hasErrorHandler: entry.failureEvents.length > 0,
          showErrorDetails: includeErrorPaths,
        } satisfies WorkflowCallNodeData,
      });

      nodeXByStateId.set(entry.stateId, x);
    });
  });

  errorCallFlowEntries.forEach((entry, index) => {
    const state = definition.states[entry.stateId];
    const x = ERROR_LANE_X + index * ERROR_LANE_NODE_GAP;

    nodes.push({
      id: entry.stateId,
      type: 'workflowCallNode',
      className: `${getNodeClassNames(entry.stateId, state, definition.initial)} workflow-graph-node-error-lane`,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      position: {
        x,
        y: errorSinkDepth * ROW_GAP,
      },
      data: {
        stateId: entry.stateId,
        order: entry.order,
        invokeSrc: entry.invokeSrc,
        beforeEvents: entry.beforeEvents,
        afterEvents: entry.afterEvents,
        failureEvents: includeErrorPaths ? entry.failureEvents : [],
        hasErrorHandler: entry.failureEvents.length > 0,
        showErrorDetails: includeErrorPaths,
      } satisfies WorkflowCallNodeData,
    });

    nodeXByStateId.set(entry.stateId, x);
  });

  const orderByStateId = new Map(
    visibleCallFlowEntries.map((entry) => [entry.stateId, entry.order])
  );
  const occupiedNodeCenters = [...new Set(nodeXByStateId.values())];

  visibleCallFlowEntries.forEach((entry) => {
    const nextTargets = getSimplifiedNextCallTargets(definition, entry.stateId, callStateIds);

    nextTargets.forEach((target, index) => {
      if (!includeErrorPaths && target.kind === 'failure') {
        return;
      }

      const sourceOrder = orderByStateId.get(entry.stateId) ?? entry.order;
      const targetOrder = orderByStateId.get(target.targetStateId) ?? sourceOrder;
      const isBackward = targetOrder <= sourceOrder;
      const isFailure = target.kind === 'failure';
      const sourceX = nodeXByStateId.get(entry.stateId) ?? 0;
      const targetX = nodeXByStateId.get(target.targetStateId) ?? 0;
      const direction = getHorizontalDirection(sourceX, targetX, isFailure);
      const laneX = avoidNodeColumns(
        computeEdgeLaneX(sourceX, targetX, direction, isFailure, isBackward, index),
        direction,
        occupiedNodeCenters
      );
      const edgeLabel = isFailure
        ? `error: ${target.triggerEvents.join(', ')}`
        : `then: ${target.triggerEvents.join(', ')}`;

      const sourceHandle = getSourceHandleId(laneX, sourceX, isFailure);
      const targetHandle = getTargetHandleId(laneX, targetX);

      edges.push({
        id: `workflow-call-edge-${entry.stateId}-${index}-${target.targetStateId}-${target.kind}`,
        source: entry.stateId,
        target: target.targetStateId,
        sourceHandle,
        targetHandle,
        type: 'workflowOrthogonal',
        className: [
          'workflow-graph-edge',
          isBackward ? 'workflow-graph-edge-return' : '',
          isFailure ? 'workflow-graph-edge-error' : '',
        ]
          .filter(Boolean)
          .join(' '),
        style: {
          strokeWidth: 2,
          opacity: 1,
        },
        label: edgeLabel,
        labelShowBg: true,
        data: {
          laneX,
        } satisfies WorkflowEdgeRoutingData,
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
      });
    });
  });

  return { nodes, edges };
}
