import { useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowDefinitionDocument } from '@ai-team/api-client';
import { transformWorkflowDefinitionToReactFlow } from './workflowCallGraphFlow';
import { WorkflowCallNode } from './WorkflowCallNode';
import { WorkflowOrthogonalEdge } from './WorkflowOrthogonalEdge';
import './WorkflowGraphView.css';

interface WorkflowGraphViewProps {
  definition: WorkflowDefinitionDocument;
  className?: string;
  includeErrorPaths?: boolean;
}

export function WorkflowGraphView({
  definition,
  className,
  includeErrorPaths = false,
}: Readonly<WorkflowGraphViewProps>) {
  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      workflowCallNode: WorkflowCallNode,
    }),
    []
  );

  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      workflowOrthogonal: WorkflowOrthogonalEdge,
    }),
    []
  );

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => transformWorkflowDefinitionToReactFlow(definition, { includeErrorPaths }),
    [definition, includeErrorPaths]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const rootClassName = className ? `workflow-graph ${className}` : 'workflow-graph';

  if (initialNodes.length === 0) {
    return (
      <div className={rootClassName}>
        <div className="workflow-graph-empty">This workflow has no visualizable states.</div>
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2.5}
        nodesDraggable={false}
        nodesConnectable={false}
        attributionPosition="bottom-left"
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="var(--color-border-primary, #3e3e42)"
          gap={72}
          size={1.2}
        />
        <Controls />
        <MiniMap
          style={{
            background: 'var(--color-bg-secondary, #252526)',
            border: '1px solid var(--color-border-primary, #3e3e42)',
          }}
          maskColor="rgba(0,0,0,0.35)"
        />
      </ReactFlow>
    </div>
  );
}
