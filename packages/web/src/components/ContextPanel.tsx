import { useState, useEffect } from 'react';
import { Artifact, ChatSession, Task, TaskStatus, TaskPriority } from '../types';
import { API_BASE } from '../context/TeamContext';
import './ContextPanel.css';

interface ContextPanelProps {
  agentId: string;
  sessionId?: string;
  artifacts: string[]; // Artifact IDs in context
  onToggleArtifact: (artifactId: string) => void;
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}

export function ContextPanel({ agentId, sessionId, artifacts, onToggleArtifact, onSwitchSession, onDeleteSession }: ContextPanelProps) {
  const [allArtifacts, setAllArtifacts] = useState<Artifact[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<'sessions' | 'tasks' | 'artifacts' | 'files' | null>('sessions');

  useEffect(() => {
    loadArtifacts();
    loadSessions();
    loadTasks();
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

  const loadTasks = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/tasks?assignedTo=${agentId}`);
      if (response.ok) {
        const data = await response.json();
        setTasks(data);
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionIdToDelete: string) => {
    e.stopPropagation();

    if (!window.confirm('Delete this session? This cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/sessions/${sessionIdToDelete}`, {
        method: 'DELETE',
      });

      if (response.ok || response.status === 204) {
        // Remove from local state
        setSessions(sessions.filter(s => s.id !== sessionIdToDelete));
        
        // Notify parent if this was the current session
        if (sessionIdToDelete === sessionId && onDeleteSession) {
          onDeleteSession(sessionIdToDelete);
        }
      } else {
        console.error('Failed to delete session');
        alert('Failed to delete session. Please try again.');
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      alert('Failed to delete session. Please try again.');
    }
  };

  const isInContext = (artifactId: string) => {
    return artifacts.includes(artifactId);
  };

  const toggleSection = (section: 'sessions' | 'tasks' | 'artifacts' | 'files') => {
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

  const getTaskStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.NOT_STARTED: return 'circle-outline';
      case TaskStatus.IN_PROGRESS: return 'loading';
      case TaskStatus.BLOCKED: return 'error';
      case TaskStatus.WAITING_APPROVAL: return 'watch';
      case TaskStatus.COMPLETED: return 'pass';
      case TaskStatus.CANCELLED: return 'close';
      case TaskStatus.DELEGATED: return 'arrow-small-right';
      default: return 'circle-outline';
    }
  };

  const getTaskPriorityClass = (priority: TaskPriority) => {
    switch (priority) {
      case TaskPriority.URGENT: return 'priority-urgent';
      case TaskPriority.HIGH: return 'priority-high';
      case TaskPriority.MEDIUM: return 'priority-medium';
      case TaskPriority.LOW: return 'priority-low';
      default: return '';
    }
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
            <i className={`codicon codicon-chevron-${expandedSection === 'sessions' ? 'down' : 'right'}`} />
            <span className="context-section-title"><i className="codicon codicon-comment-discussion" /> Sessions</span>
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
                        <i className={`codicon codicon-${session.id === sessionId ? 'circle-filled' : 'circle-outline'} context-item-pin`} />
                        <span className="context-item-title">{getSessionTitle(session)}</span>
                        <button
                          className="context-item-action"
                          onClick={(e) => handleDeleteSession(e, session.id)}
                          title="Delete session"
                        >
                          <i className="codicon codicon-trash" />
                        </button>
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

        {/* Tasks Section */}
        <div className="context-section">
          <button
            className={`context-section-header ${expandedSection === 'tasks' ? 'expanded' : ''}`}
            onClick={() => toggleSection('tasks')}
          >
            <i className={`codicon codicon-chevron-${expandedSection === 'tasks' ? 'down' : 'right'}`} />
            <span className="context-section-title"><i className="codicon codicon-checklist" /> Tasks</span>
            <span className="context-section-count">{tasks.length}</span>
          </button>

          {expandedSection === 'tasks' && (
            <div className="context-section-content">
              {tasks.length === 0 ? (
                <div className="context-empty">
                  No tasks assigned yet.
                </div>
              ) : (
                <div className="context-items">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className={`context-item context-task ${getTaskPriorityClass(task.priority)}`}
                    >
                      <div className="context-item-header">
                        <i className={`codicon codicon-${getTaskStatusIcon(task.status)} context-item-pin task-status-icon`} />
                        <span className="context-item-title">{task.title}</span>
                      </div>
                      <div className="context-item-meta">
                        <span className="task-priority">{task.priority}</span>
                        {task.dueDate && (
                          <span className="task-due-date">
                            Due {formatDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                      {task.subtaskIds && task.subtaskIds.length > 0 && (
                        <div className="task-subtasks">
                          {task.subtaskIds.length} subtask{task.subtaskIds.length > 1 ? 's' : ''}
                        </div>
                      )}
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
            <i className={`codicon codicon-chevron-${expandedSection === 'artifacts' ? 'down' : 'right'}`} />
            <span className="context-section-title"><i className="codicon codicon-file" /> Briefs & Summaries</span>
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
                        <i className={`codicon codicon-${isInContext(artifact.id) ? 'pinned' : 'circle-outline'} context-item-pin`} />
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
            <i className={`codicon codicon-chevron-${expandedSection === 'files' ? 'down' : 'right'}`} />
            <span className="context-section-title"><i className="codicon codicon-folder" /> Accessible Files</span>
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
