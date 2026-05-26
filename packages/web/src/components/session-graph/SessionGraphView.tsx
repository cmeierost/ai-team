import { useEffect, useMemo } from 'react';
import { Background, Controls, MiniMap, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Agent, SessionThread } from '../../types';
import { sessionGraphNodeTypes } from './SessionGraphNodes';
import { buildSessionGraphLayout } from './sessionGraphLayout';

interface SessionGraphViewProps {
  thread: SessionThread;
  agents: Agent[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string, agentId: string, handoffId?: string) => void;
}

export function SessionGraphView({ thread, agents, activeSessionId, onSelectSession }: Readonly<SessionGraphViewProps>) {
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    agents.forEach((agent) => map.set(agent.id, agent));
    return map;
  }, [agents]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildSessionGraphLayout(thread, activeSessionId, agentMap, onSelectSession),
    [thread, activeSessionId, agentMap, onSelectSession],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="session-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={sessionGraphNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        attributionPosition="bottom-left"
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.15}
        maxZoom={3}
      >
        <Background color="#2a2a2a" gap={24} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={2}
          style={{ background: '#1e1e1e', border: '1px solid #3e3e42' }}
          maskColor="rgba(0,0,0,0.4)"
        />
      </ReactFlow>
    </div>
  );
}