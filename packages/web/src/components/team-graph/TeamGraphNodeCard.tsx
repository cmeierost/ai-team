import type { Agent } from '../../types';
import { Avatar } from '../Avatar';

interface TeamGraphNodeCardProps {
  agent: Agent;
}

export function TeamGraphNodeCard({ agent }: Readonly<TeamGraphNodeCardProps>) {
  return (
    <div className="agent-node">
      <div className="agent-node-avatar">
        <Avatar agent={agent} size="medium" className="team-graph-avatar" />
      </div>
      <div className="agent-name">{agent.name}</div>
      <div className="agent-role">{agent.role}</div>
    </div>
  );
}