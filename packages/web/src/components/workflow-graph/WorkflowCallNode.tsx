import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { WorkflowCallFlowBranch, WorkflowCallNodeData } from './workflowCallGraphFlow';

type WorkflowCallFlowNode = Node<WorkflowCallNodeData, 'workflowCallNode'>;

function renderBranchList(branches: WorkflowCallFlowBranch[]) {
  if (branches.length === 0) {
    return (
      <div className="workflow-node-card-branch-row">
        <span className="workflow-node-card-branch-arrow">→</span>
        <span className="workflow-node-card-branch-event">none</span>
        <span className="workflow-node-card-branch-count">0</span>
        <span className="workflow-node-card-branch-tail">↦</span>
      </div>
    );
  }

  return branches.map((branch) => (
    <div className="workflow-node-card-branch-row" key={`branch-${branch.event}`}>
      <span className="workflow-node-card-branch-arrow">→</span>
      <span className="workflow-node-card-branch-event">{branch.event}</span>
      <span className="workflow-node-card-branch-count">{branch.count}</span>
      <span className="workflow-node-card-branch-tail">↦</span>
    </div>
  ));
}

export function WorkflowCallNode({ data }: Readonly<NodeProps<WorkflowCallFlowNode>>) {
  const nodeData = data;

  return (
    <div className="workflow-node-card">
      <Handle
        type="target"
        id="in-left"
        position={Position.Left}
        className="workflow-node-handle workflow-node-handle-in workflow-node-handle-in-left"
      />
      <Handle
        type="target"
        id="in-right"
        position={Position.Right}
        className="workflow-node-handle workflow-node-handle-in workflow-node-handle-in-right"
      />

      <div className="workflow-node-card-title-row">
        <div className="workflow-node-card-title-wrap">
          <span className="workflow-node-card-order">{nodeData.order}</span>
          <div>
            <div className="workflow-node-card-title">{nodeData.stateId}</div>
            <div className="workflow-node-card-subtitle">runs {nodeData.invokeSrc}</div>
          </div>
        </div>
        <div className="workflow-node-card-badges">
          <span className="workflow-node-badge workflow-node-badge-call">call</span>
          {nodeData.hasErrorHandler ? (
            <span className="workflow-node-badge workflow-node-badge-error-handler">error handler</span>
          ) : null}
        </div>
      </div>

      <div className="workflow-node-card-section">
        <div className="workflow-node-card-section-title">starts when</div>
        {renderBranchList(nodeData.beforeEvents)}
      </div>

      <div className="workflow-node-card-section">
        <div className="workflow-node-card-section-title">action</div>
        <div className="workflow-node-card-call-line">{nodeData.invokeSrc}</div>
      </div>

      <div className="workflow-node-card-section">
        <div className="workflow-node-card-section-title">next (success)</div>
        {renderBranchList(nodeData.afterEvents)}
      </div>

      {nodeData.showErrorDetails ? (
        <div className="workflow-node-card-section workflow-node-card-section-error">
          <div className="workflow-node-card-section-title">next (error)</div>
          {renderBranchList(nodeData.failureEvents)}
        </div>
      ) : null}

      <Handle
        type="source"
        id="out-success-right"
        position={Position.Right}
        className="workflow-node-handle workflow-node-handle-success workflow-node-handle-success-right"
      />
      {nodeData.showErrorDetails ? (
        <Handle
          type="source"
          id="out-error-right"
          position={Position.Right}
          className="workflow-node-handle workflow-node-handle-error workflow-node-handle-error-right"
        />
      ) : null}
      <Handle
        type="source"
        id="out-success-left"
        position={Position.Left}
        className="workflow-node-handle workflow-node-handle-success workflow-node-handle-success-left"
      />
      {nodeData.showErrorDetails ? (
        <Handle
          type="source"
          id="out-error-left"
          position={Position.Left}
          className="workflow-node-handle workflow-node-handle-error workflow-node-handle-error-left"
        />
      ) : null}
    </div>
  );
}
