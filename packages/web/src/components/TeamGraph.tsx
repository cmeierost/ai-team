import { useCallback, useMemo } from 'react';
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
import { Agent } from '../types';

interface TeamGraphProps {
  onSelectAgent: (agentId: string) => void;
}

function createHierarchyLayout(agents: Agent[]) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const levelMap = new Map<string, number>();

  // Calculate hierarchy levels
  function getLevel(agent: Agent, visited = new Set<string>()): number {
    if (levelMap.has(agent.id)) {
      return levelMap.get(agent.id)!;
    }

    if (!agent.reportsTo || visited.has(agent.id)) {
      levelMap.set(agent.id, 0);
      return 0;
    }

    visited.add(agent.id);
    const manager = agents.find((a) => a.id === agent.reportsTo);
    const level = manager ? getLevel(manager, visited) + 1 : 0;
    levelMap.set(agent.id, level);
    return level;
  }

  agents.forEach((agent) => getLevel(agent));

  // Group agents by level
  const levels: Agent[][] = [];
  agents.forEach((agent) => {
    const level = levelMap.get(agent.id) || 0;
    if (!levels[level]) levels[level] = [];
    levels[level].push(agent);
  });

  // Create nodes with layout
  const nodeWidth = 200;
  const nodeHeight = 80;
  const levelGap = 150;
  const nodeGap = 50;

  levels.forEach((levelAgents, levelIndex) => {
    const totalWidth = levelAgents.length * (nodeWidth + nodeGap) - nodeGap;
    const startX = -totalWidth / 2;

    levelAgents.forEach((agent, index) => {
      nodes.push({
        id: agent.id,
        type: 'default',
        position: {
          x: startX + index * (nodeWidth + nodeGap),
          y: levelIndex * levelGap,
        },
        data: {
          label: (
            <div className="agent-node">
              <div className="agent-name">{agent.name}</div>
              <div className="agent-role">{agent.role}</div>
            </div>
          ),
        },
        style: {
          width: nodeWidth,
          border: '2px solid #4CAF50',
          borderRadius: 8,
          background: '#fff',
          padding: 10,
        },
      });

      if (agent.reportsTo) {
        edges.push({
          id: `${agent.id}-${agent.reportsTo}`,
          source: agent.reportsTo,
          target: agent.id,
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#888', strokeWidth: 2 },
        });
      }
    });
  });

  return { nodes, edges };
}

export function TeamGraph({ onSelectAgent }: TeamGraphProps) {
  const { agents, loading, error } = useTeam();
  
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => createHierarchyLayout(agents),
    [agents]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onSelectAgent(node.id);
    },
    [onSelectAgent]
  );

  if (loading) {
    return <div className="loading">Loading organization...</div>;
  }

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (agents.length === 0) {
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
