import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Avatar } from '../Avatar';
import {
  type AgentLabelData,
  type MessageDotData,
  type SessionBarData,
  type TimeTickData,
} from './sessionGraphLayout';

function AgentLabelNode({ data }: NodeProps) {
  const nodeData = data as unknown as AgentLabelData;
  return (
    <div className="sg-agent-label">
      <Avatar agent={nodeData.agent} size="small" />
      <span className="sg-agent-label-name">{nodeData.agent.name}</span>
    </div>
  );
}

function LaneBgNode() {
  return <div className="sg-lane-bg" />;
}

function SessionBarNode({ data }: NodeProps) {
  const nodeData = data as unknown as SessionBarData;

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, top: '50%' }} />
      <button
        type="button"
        className={`sg-session-bar${nodeData.isCurrent ? ' sg-session-bar-current' : ''}${nodeData.isGhost ? ' sg-session-bar-ghost' : ''}`}
        onClick={
          nodeData.isGhost
            ? undefined
            : () =>
                nodeData.onSelect(
                  nodeData.session.sessionId,
                  nodeData.targetAgentId,
                  nodeData.inboundHandoffId
                )
        }
      >
        {nodeData.isGhost ? (
          <span className="sg-session-bar-ghost-label">deleted</span>
        ) : (
          <>
            <span className="sg-session-bar-msgs">{nodeData.messageCount}msg</span>
            <span className="sg-session-bar-dur">{nodeData.durationLabel}</span>
            {nodeData.isCurrent ? <span className="sg-session-bar-badge">active</span> : null}
          </>
        )}
      </button>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, top: '50%' }} />
    </>
  );
}

function MessageDotNode({ data }: NodeProps) {
  const nodeData = data as unknown as MessageDotData;

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, top: '50%' }} />
      <div
        className={`sg-message-dot${nodeData.isHandoff ? ' sg-message-dot-handoff' : ''}`}
        title={nodeData.label}
      />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, top: '50%' }} />
    </>
  );
}

function TimeTickNode({ data }: NodeProps) {
  const nodeData = data as unknown as TimeTickData;
  return (
    <div className="sg-time-tick">
      <div className="sg-time-tick-label">{nodeData.label}</div>
      <div className="sg-time-tick-line" />
    </div>
  );
}

export const sessionGraphNodeTypes = {
  agentLabel: AgentLabelNode,
  laneBg: LaneBgNode,
  sessionBar: SessionBarNode,
  timeTick: TimeTickNode,
  messageDot: MessageDotNode,
} as const;
