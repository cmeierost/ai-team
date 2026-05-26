import { useCallback, useEffect, useMemo } from 'react';
import type { Node } from '@xyflow/react';
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { GraphData } from '../../types';
import { transformGraphDataToReactFlow } from './teamGraphFlow';

interface TeamGraphViewProps {
  graphData: GraphData;
  onNodeSelect?: (nodeId: string) => void;
}

export function TeamGraphView({ graphData, onNodeSelect }: Readonly<TeamGraphViewProps>) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => transformGraphDataToReactFlow(graphData), [graphData]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialEdges, initialNodes, setEdges, setNodes]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeSelect?.(node.id);
    },
    [onNodeSelect],
  );

  return (
    <div className="team-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
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