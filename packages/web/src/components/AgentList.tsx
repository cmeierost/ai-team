import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeam } from '../context/TeamContext';
import { getAgentColor } from '../utils/color';
import { Avatar } from './Avatar';
import { rankAgentsBySearch } from './agentListSearch';
import './AgentList.css';

export function AgentList() {
  const navigate = useNavigate();
  const { agents, loading, error } = useTeam();
  const [searchTerm, setSearchTerm] = useState('');

  const visibleAgents = useMemo(() => rankAgentsBySearch(agents, searchTerm), [agents, searchTerm]);

  if (loading) {
    return <div className="loading">Loading employees...</div>;
  }

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (agents.length === 0) {
    return (
      <div className="empty-state">
        <p>No employees found.</p>
        <p>Run <code>ai-team init</code> to set up your team.</p>
      </div>
    );
  }

  return (
    <div className="agent-list">
      <div className="agent-list-header">
        <div>
          <h2>Employees ({visibleAgents.length})</h2>
          <p className="agent-list-subtitle">Searches all agent text with weighted ranking for the strongest matches first.</p>
        </div>
        <label className="agent-search" aria-label="Search employees">
          <i className="codicon codicon-search" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search names, roles, skills, docs, and more..."
            className="agent-search-input"
          />
          {searchTerm ? (
            <button
              type="button"
              className="agent-search-clear"
              onClick={() => setSearchTerm('')}
              aria-label="Clear employee search"
              title="Clear search"
            >
              <i className="codicon codicon-close" />
            </button>
          ) : null}
        </label>
      </div>
      {visibleAgents.length === 0 ? (
        <div className="agent-list-empty-search">
          <p>No employees matched “{searchTerm}”.</p>
          <button type="button" className="btn btn-secondary" onClick={() => setSearchTerm('')}>
            Clear search
          </button>
        </div>
      ) : (
      <div className="agent-grid">
        {visibleAgents.map((agent) => (
          <article 
            key={agent.id} 
            className="agent-card"
            style={{ '--agent-color': getAgentColor(agent) } as React.CSSProperties}
          >
            <div className="agent-card-avatar">
              <Avatar agent={agent} size="large" />
            </div>
            <div className="agent-card-header">
              <h3>{agent.name}</h3>
              <span className="agent-role-badge">{agent.role}</span>
            </div>
            <div className="agent-card-body">
              {agent.reportsTo && (
                <p className="reports-to">
                  Reports to: {agents.find((a) => a.id === agent.reportsTo)?.name || agent.reportsTo}
                </p>
              )}
              {agent.specializations && agent.specializations.length > 0 && (
                <div className="skills">
                  <strong>Specializations:</strong>
                  <div className="skill-tags">
                    {agent.specializations.slice(0, 3).map((spec) => (
                      <span key={spec} className="skill-tag">
                        {spec}
                      </span>
                    ))}
                    {agent.specializations.length > 3 && (
                      <span className="skill-tag">+{agent.specializations.length - 3}</span>
                    )}
                  </div>
                </div>
              )}
              {agent.features && agent.features.length > 0 && (
                <p className="context-paths">
                  Features: {agent.features.length}
                </p>
              )}
            </div>
            <div className="agent-card-footer">
              <button 
                className="btn btn-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/portfolio/${agent.id}`);
                }}
              >
                <i className="codicon codicon-book" /> Portfolio
              </button>
              <button 
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/chat/${agent.id}`);
                }}
              >
                Chat <i className="codicon codicon-comment" />
              </button>
            </div>
          </article>
        ))}
      </div>
      )}
    </div>
  );
}
