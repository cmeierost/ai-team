import { useTeam } from '../context/TeamContext';
import { Avatar } from './Avatar';
import './Portfolio.css';

interface PortfolioProps {
  agentId: string;
  onClose: () => void;
}

export function Portfolio({ agentId, onClose }: PortfolioProps) {
  const { agents, loading, error } = useTeam();
  
  if (loading) {
    return <div className="loading">Loading portfolio...</div>;
  }

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  const agent = agents.find((a) => a.id === agentId);

  if (!agent) {
    return (
      <div className="error">
        <p>Employee not found: {agentId}</p>
        <button onClick={onClose}>← Back</button>
      </div>
    );
  }

  return (
    <div className="portfolio">
      <div className="portfolio-header">
        <button onClick={onClose} className="btn-back">
          ← Back
        </button>
        <div className="portfolio-avatar">
          <Avatar agent={agent} size="large" />
        </div>
        <h1>{agent.name}</h1>
        <span className="agent-role-badge">{agent.role}</span>
      </div>

      <div className="portfolio-content">
        <section className="portfolio-section">
          <h2>About</h2>
          {agent.markdown ? (
            <div className="portfolio-bio">
              {agent.markdown}
            </div>
          ) : (
            <p className="text-muted">No portfolio information available.</p>
          )}
        </section>

        {agent.reportsTo && (
          <section className="portfolio-section">
            <h2>Reporting Structure</h2>
            <p>
              Reports to: <strong>{agents.find((a) => a.id === agent.reportsTo)?.name || agent.reportsTo}</strong>
            </p>
          </section>
        )}

        {agent.specializations && agent.specializations.length > 0 && (
          <section className="portfolio-section">
            <h2>Specializations</h2>
            <div className="skill-tags">
              {agent.specializations.map((spec) => (
                <span key={spec} className="skill-tag">
                  {spec}
                </span>
              ))}
            </div>
          </section>
        )}

        {agent.features && agent.features.length > 0 && (
          <section className="portfolio-section">
            <h2>Features</h2>
            <div className="feature-list">
              {agent.features.map((feature) => (
                <div key={feature} className="feature-item">
                  {feature}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="portfolio-section">
          <h2>Status</h2>
          <span className={`status-badge status-${agent.status || 'available'}`}>
            {agent.status || 'available'}
          </span>
        </section>
      </div>
    </div>
  );
}
