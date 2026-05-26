import type { CSSProperties } from 'react';
import { Position, type Edge, type Node } from '@xyflow/react';
import type { GraphData, GraphNode as GraphDataNode } from '../../types';
import { getAgentColor } from '../../utils/color';
import { TeamGraphNodeCard } from './TeamGraphNodeCard';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 116;
const SIBLING_GAP = 72;
const ROOT_GAP = 128;
const LEVEL_GAP = 176;

function sortGraphNodes(nodes: GraphDataNode[]) {
  return [...nodes].sort((left, right) => {
    const leftName = left.data.agent?.name ?? left.data.label ?? left.id;
    const rightName = right.data.agent?.name ?? right.data.label ?? right.id;
    return leftName.localeCompare(rightName);
  });
}

function sumWidths(widths: number[], gap: number) {
  if (widths.length === 0) {
    return NODE_WIDTH;
  }

  return widths.reduce((total, width) => total + width, 0) + gap * Math.max(widths.length - 1, 0);
}

export function transformGraphDataToReactFlow(graphData: GraphData | null) {
  if (!graphData) {
    return { nodes: [], edges: [] } satisfies { nodes: Node[]; edges: Edge[] };
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const agentNodes = graphData.nodes.filter((node) => node.type === 'agent');
  const agentNodesById = new Map(agentNodes.map((node) => [node.id, node]));
  const childToParent = new Map<string, string>();
  const childrenByParent = new Map<string, GraphDataNode[]>();
  const subtreeWidths = new Map<string, number>();
  const positionedNodeIds = new Set<string>();

  graphData.edges
    .filter((edge) => edge.type === 'reports-to')
    .forEach((edge) => {
      if (!agentNodesById.has(edge.source) || !agentNodesById.has(edge.target)) {
        return;
      }

      childToParent.set(edge.source, edge.target);
      const childNode = agentNodesById.get(edge.source);
      if (!childNode) {
        return;
      }

      const siblings = childrenByParent.get(edge.target) ?? [];
      siblings.push(childNode);
      childrenByParent.set(edge.target, siblings);
    });

  for (const [parentId, children] of childrenByParent.entries()) {
    childrenByParent.set(parentId, sortGraphNodes(children));
  }

  function measureSubtree(nodeId: string, visited = new Set<string>()): number {
    if (subtreeWidths.has(nodeId)) {
      return subtreeWidths.get(nodeId) ?? NODE_WIDTH;
    }

    if (visited.has(nodeId)) {
      return NODE_WIDTH;
    }

    visited.add(nodeId);
    const children = childrenByParent.get(nodeId) ?? [];
    const childWidths = children.map((child) => measureSubtree(child.id, new Set(visited)));
    const width = Math.max(NODE_WIDTH, sumWidths(childWidths, SIBLING_GAP));
    subtreeWidths.set(nodeId, width);
    return width;
  }

  const roots = sortGraphNodes(agentNodes.filter((node) => !childToParent.has(node.id)));
  const fallbackRoots = sortGraphNodes(agentNodes.filter((node) => !roots.some((root) => root.id === node.id)));
  const orderedRoots = [...roots, ...fallbackRoots.filter((node) => !roots.some((root) => root.id === node.id))];

  orderedRoots.forEach((root) => {
    measureSubtree(root.id);
  });

  function placeSubtree(nodeId: string, leftX: number, depth: number, visited = new Set<string>()) {
    if (visited.has(nodeId) || positionedNodeIds.has(nodeId)) {
      return;
    }

    const graphNode = agentNodesById.get(nodeId);
    const agent = graphNode?.data.agent;
    if (!graphNode || !agent) {
      return;
    }

    visited.add(nodeId);
    positionedNodeIds.add(nodeId);

    const subtreeWidth = subtreeWidths.get(nodeId) ?? NODE_WIDTH;
    const children = childrenByParent.get(nodeId) ?? [];
    const childWidths = children.map((child) => subtreeWidths.get(child.id) ?? NODE_WIDTH);
    const totalChildrenWidth = sumWidths(childWidths, SIBLING_GAP);
    const centeredNodeX = leftX + (subtreeWidth - NODE_WIDTH) / 2;

    nodes.push({
      id: graphNode.id,
      type: 'default',
      className: 'team-graph-node-shell',
      position: graphNode.position ?? {
        x: centeredNodeX,
        y: depth * LEVEL_GAP,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        label: <TeamGraphNodeCard agent={agent} />,
      },
      style: {
        '--agent-color': getAgentColor(agent),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      } as CSSProperties,
    });

    let childLeftX = leftX + (subtreeWidth - totalChildrenWidth) / 2;
    children.forEach((child, index) => {
      placeSubtree(child.id, childLeftX, depth + 1, new Set(visited));
      childLeftX += childWidths[index] + SIBLING_GAP;
    });
  }

  const rootWidths = orderedRoots.map((root) => subtreeWidths.get(root.id) ?? NODE_WIDTH);
  const totalRootWidth = sumWidths(rootWidths, ROOT_GAP);
  let rootLeftX = -totalRootWidth / 2;

  orderedRoots.forEach((root, index) => {
    placeSubtree(root.id, rootLeftX, 0);
    rootLeftX += rootWidths[index] + ROOT_GAP;
  });

  graphData.edges
    .filter((edge) => edge.type === 'reports-to')
    .forEach((graphEdge) => {
      edges.push({
        id: graphEdge.id,
        source: graphEdge.target,
        target: graphEdge.source,
        type: 'smoothstep',
        animated: false,
        className: 'team-graph-edge',
        zIndex: 0,
      });
    });

  graphData.edges
    .filter((edge) => edge.type === 'reports-to-unresolved')
    .forEach((graphEdge) => {
      edges.push({
        id: graphEdge.id,
        source: graphEdge.target,
        target: graphEdge.target,
        type: 'straight',
        animated: true,
        className: 'team-graph-edge-unresolved',
        label: graphEdge.error || 'Unresolved',
      });
    });

  return { nodes, edges };
}