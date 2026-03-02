import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTeam } from '../context/TeamContext';
import { Avatar } from './Avatar';
import './Portfolio.css';

export function Portfolio() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { agents, loading, error } = useTeam();
  
  const agent = agents.find((a) => a.id === agentId);
  
  // Validate agent exists
  useEffect(() => {
    if (!loading && !agent && agentId) {
      navigate('/not-found', { replace: true });
    }
  }, [agent, agentId, loading, navigate]);
  
  if (loading) {
    return <div className="loading">Loading portfolio...</div>;
  }

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (!agentId || !agent) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="portfolio">
      <div className="portfolio-header">
        <button onClick={() => navigate('/employees')} className="btn-back">
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
