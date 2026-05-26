import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './AgentNode.css';

interface AgentNodeData {
  label: string;
  role: string;
  status: 'available' | 'busy' | 'in-meeting' | 'offline';
}

export const AgentNode = memo(({ data }: { data: AgentNodeData }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available':
        return '#4caf50';
      case 'busy':
        return '#ff9800';
      case 'in-meeting':
        return '#2196f3';
      case 'offline':
        return '#9e9e9e';
      default:
        return '#9e9e9e';
    }
  };

  return (
    <div className="agent-node">
      <Handle type="target" position={Position.Top} />
      
      <div className="agent-node-header">
        <div 
          className="status-indicator" 
          style={{ backgroundColor: getStatusColor(data.status) }}
        />
        <div className="agent-name">{data.label}</div>
      </div>
      
      <div className="agent-role">{data.role}</div>
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

AgentNode.displayName = 'AgentNode';
