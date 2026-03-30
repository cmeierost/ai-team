import type { Agent, AgentHandoff } from '../../types';
import { Avatar } from '../Avatar';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioHandoffsSectionProps {
  handoffs: AgentHandoff[];
  allAgents: Agent[];
}

export function PortfolioHandoffsSection({
  handoffs,
  allAgents,
}: Readonly<PortfolioHandoffsSectionProps>) {
  const agentById = (id: string) => allAgents.find((a) => a.id === id);

  return (
    <PortfolioSectionCard
      title="Handoffs"
      icon="🤝"
    >
      <div className="collabs-view">
        {handoffs.length === 0 ? (
          <p className="empty-text">No handoffs configured.</p>
        ) : (
          handoffs.map((entry) => {
            const agent = agentById(entry.agent);
            return (
              <div key={`${entry.agent}-${entry.label}`} className="collab-view-row">
                <Avatar agent={agent ?? null} size="small" />
                <div className="collab-view-info">
                  <span className="collab-view-name">{agent?.name ?? entry.agent}</span>
                  {agent?.role && <span className="collab-view-role">{agent.role}</span>}
                  <p className="collab-view-comment">{entry.label}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </PortfolioSectionCard>
  );
}
