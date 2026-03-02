import React from 'react';

interface AgentBriefingBadgeProps {
  targetAgentName: string;
}

export function AgentBriefingBadge({ targetAgentName }: AgentBriefingBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: '12px',
        fontSize: '0.75rem',
        fontWeight: 500,
        color: 'rgb(59, 130, 246)',
        marginLeft: '8px',
      }}
    >
      <span style={{ fontSize: '0.8rem' }}>→</span>
      <span>{targetAgentName}</span>
    </span>
  );
}
