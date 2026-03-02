import { useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTeam } from '../context/TeamContext';
import { GraphData, GraphNode as GraphDataNode } from '../types';
import { getAvatarUrl, getAgentInitials } from '../utils/avatar';
import { getAgentColor } from '../utils/color';
import './TeamGraph.css';

function transformGraphDataToReactFlow(graphData: GraphData | null) {
  if (!graphData) {
    return { nodes: [], edges: [] };
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Calculate hierarchy levels for positioning if not provided
  const levelMap = new Map<string, number>();
  const agentNodes = graphData.nodes.filter(n => n.type === 'agent');

  // Build level map from edges
  const childToParent = new Map<string, string>();
  graphData.edges
    .filter(e => e.type === 'reports-to')
    .forEach(edge => {
      // Edge represents "source reports to target" relationship
      // So source is the employee (child), target is the manager (parent)
      childToParent.set(edge.source, edge.target);
    });

  function getLevel(nodeId: string, visited = new Set<string>()): number {
    if (levelMap.has(nodeId)) {
      return levelMap.get(nodeId)!;
    }
    if (visited.has(nodeId) || !childToParent.has(nodeId)) {
      levelMap.set(nodeId, 0);
      return 0;
    }
    visited.add(nodeId);
    const parent = childToParent.get(nodeId);
    const level = parent ? getLevel(parent, visited) + 1 : 0;
    levelMap.set(nodeId, level);
    return level;
  }

  agentNodes.forEach(node => getLevel(node.id));

  // Group by level for layout
  const levels: GraphDataNode[][] = [];
  agentNodes.forEach(node => {
    const level = levelMap.get(node.id) || 0;
    if (!levels[level]) levels[level] = [];
    levels[level].push(node);
  });

  // Create nodes with layout
  const nodeWidth = 200;
  const levelGap = 280;  // Increased vertical spacing for 150px avatars with comfortable padding
  const nodeGap = 100;    // Increased horizontal spacing for avatars

  levels.forEach((levelNodes, levelIndex) => {
    const totalWidth = levelNodes.length * (nodeWidth + nodeGap) - nodeGap;
    const startX = -totalWidth / 2;

    levelNodes.forEach((graphNode, index) => {
      const agent = graphNode.data.agent;
      if (!agent) return;

      const avatarUrl = getAvatarUrl(agent);
      const initials = getAgentInitials(agent);
      const agentColor = getAgentColor(agent);
      
      nodes.push({
        id: graphNode.id,
        type: 'default',
        position: graphNode.position || {
          x: startX + index * (nodeWidth + nodeGap),
          y: levelIndex * levelGap,
        },
        data: {
          label: (
            <div className="agent-node" style={{ '--agent-color': agentColor } as React.CSSProperties}>
              <div className="agent-node-avatar">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={agent.name} className="node-avatar-img" />
                ) : (
                  <div className="node-avatar-initials" style={{ backgroundColor: agentColor }}>{initials}</div>
                )}
              </div>
              <div className="agent-name">{agent.name}</div>
              <div className="agent-role">{agent.role}</div>
            </div>
          ),
        },
        style: {
          width: nodeWidth,
          border: `2px solid color-mix(in srgb, ${agentColor} 60%, transparent)`,
          borderRadius: 8,
          background: `color-mix(in srgb, ${agentColor} 35%, var(--color-bg-secondary, #1e1e1e))`,
          padding: 10,
        },
      });
    });
  });

  // Create edges from resolved graph data (filter out unresolved ones)
  // Swap source/target for top-down org chart: manager (target) → employee (source)
  graphData.edges
    .filter(e => e.type === 'reports-to')
    .forEach(graphEdge => {
      edges.push({
        id: graphEdge.id,
        source: graphEdge.target,  // Manager at top
        target: graphEdge.source,  // Employee below
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#888', strokeWidth: 2 },
      });
    });

  // Optionally show unresolved edges with error styling
  graphData.edges
    .filter(e => e.type === 'reports-to-unresolved')
    .forEach(graphEdge => {
      edges.push({
        id: graphEdge.id,
        source: graphEdge.target, // target still exists
        target: graphEdge.target, // self-loop to show error
        type: 'straight',
        animated: true,
        style: { stroke: '#ff0000', strokeWidth: 1, strokeDasharray: '5,5' },
        label: graphEdge.error || 'Unresolved',
      });
    });

  return { nodes, edges };
}

export function TeamGraph() {
  const navigate = useNavigate();
  const { graphData, loading, error } = useTeam();
  
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => transformGraphDataToReactFlow(graphData),
    [graphData]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when data changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      navigate(`/portfolio/${node.id}`);
    },
    [navigate]
  );

  if (loading) {
    return <div className="loading">Loading organization...</div>;
  }

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="empty-state">
        <p>No employees found.</p>
        <p>Run <code>ai-team init</code> to set up your team.</p>
      </div>
    );
  }

  return (
    <div className="team-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        connectionMode={ConnectionMode.Loose}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
