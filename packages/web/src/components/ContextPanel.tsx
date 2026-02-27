import { useState, useEffect } from 'react';
import { Artifact, ChatSession } from '../types';
import { API_BASE } from '../context/TeamContext';
import './ContextPanel.css';

interface ContextPanelProps {
  agentId: string;
  sessionId?: string;
  artifacts: string[]; // Artifact IDs in context
  onToggleArtifact: (artifactId: string) => void;
  onSwitchSession?: (sessionId: string) => void;
}

export function ContextPanel({ agentId, sessionId, artifacts, onToggleArtifact, onSwitchSession }: ContextPanelProps) {
  const [allArtifacts, setAllArtifacts] = useState<Artifact[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<'sessions' | 'artifacts' | 'files' | null>('sessions');

  useEffect(() => {
    loadArtifacts();
    loadSessions();
  }, [agentId]);

  const loadArtifacts = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/artifacts`);
      if (response.ok) {
        const data = await response.json();
        setAllArtifacts(data);
      }
    } catch (error) {
      console.error('Failed to load artifacts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sessions?agentId=${agentId}&limit=20`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const isInContext = (artifactId: string) => {
    return artifacts.includes(artifactId);
  };

  const toggleSection = (section: 'sessions' | 'artifacts' | 'files') => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatSessionTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const getSessionTitle = (session: ChatSession) => {
    const date = new Date(session.startedAt);
    return `Session ${date.toLocaleDateString()} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="context-panel">
      <div className="context-panel-header">
        <h3>Context</h3>
      </div>

      <div className="context-sections">
        {/* Sessions Section */}
        <div className="context-section">
          <button
            className={`context-section-header ${expandedSection === 'sessions' ? 'expanded' : ''}`}
            onClick={() => toggleSection('sessions')}
          >
            <span className="context-section-icon">
              {expandedSection === 'sessions' ? '▼' : '▶'}
            </span>
            <span className="context-section-title">💬 Sessions</span>
            <span className="context-section-count">{sessions.length}</span>
          </button>

          {expandedSection === 'sessions' && (
            <div className="context-section-content">
              {sessions.length === 0 ? (
                <div className="context-empty">
                  No previous sessions. Start chatting to create a new session.
                </div>
              ) : (
                <div className="context-items">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`context-item ${session.id === sessionId ? 'context-item-current' : ''}`}
                      onClick={() => onSwitchSession?.(session.id)}
                    >
                      <div className="context-item-header">
                        <span className="context-item-pin">
                          {session.id === sessionId ? '🔵' : '○'}
                        </span>
                        <span className="context-item-title">{getSessionTitle(session)}</span>
                      </div>
                      <div className="context-item-meta">
                        <span className="context-item-date">{formatSessionTime(session.lastActivityAt)}</span>
                        {session.artifacts && session.artifacts.length > 0 && (
                          <span className="context-item-extra">
                            {session.artifacts.length} brief{session.artifacts.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Artifacts Section */}
        <div className="context-section">
          <button
            className={`context-section-header ${expandedSection === 'artifacts' ? 'expanded' : ''}`}
            onClick={() => toggleSection('artifacts')}
          >
            <span className="context-section-icon">
              {expandedSection === 'artifacts' ? '▼' : '▶'}
            </span>
            <span className="context-section-title">📄 Briefs & Summaries</span>
            <span className="context-section-count">{artifacts.length}</span>
          </button>

          {expandedSection === 'artifacts' && (
            <div className="context-section-content">
              {loading ? (
                <div className="context-loading">Loading...</div>
              ) : allArtifacts.length === 0 ? (
                <div className="context-empty">
                  No briefs created yet. Hover between messages and click "Summarize" to create one.
                </div>
              ) : (
                <div className="context-items">
                  {allArtifacts.map((artifact) => (
                    <div
                      key={artifact.id}
                      className={`context-item ${isInContext(artifact.id) ? 'context-item-active' : ''}`}
                      onClick={() => onToggleArtifact(artifact.id)}
                    >
                      <div className="context-item-header">
                        <span className="context-item-pin">
                          {isInContext(artifact.id) ? '📌' : '○'}
                        </span>
                        <span className="context-item-title">{artifact.title}</span>
                      </div>
                      <div className="context-item-meta">
                        <span className="context-item-date">{formatDate(artifact.createdAt)}</span>
                        <span className="context-item-creator">by {artifact.createdBy}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Files Section */}
        <div className="context-section">
          <button
            className={`context-section-header ${expandedSection === 'files' ? 'expanded' : ''}`}
            onClick={() => toggleSection('files')}
          >
            <span className="context-section-icon">
              {expandedSection === 'files' ? '▼' : '▶'}
            </span>
            <span className="context-section-title">📁 Accessible Files</span>
            <span className="context-section-count">0</span>
          </button>

          {expandedSection === 'files' && (
            <div className="context-section-content">
              <div className="context-empty">
                File tree coming soon. You'll be able to grant agents access to specific files and folders here.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
