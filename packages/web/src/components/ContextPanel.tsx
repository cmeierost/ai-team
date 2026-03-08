import { useState, useEffect } from 'react';
import { Artifact, ChatSession, SessionActivatedTool, Task, TaskStatus, TaskPriority } from '../types';
import { API_BASE } from '../context/TeamContext';
import { FileTree } from './FileTree';
import './ContextPanel.css';

interface ContextPanelProps {
  agentId: string;
  sessionId?: string;
  artifacts: string[]; // Artifact IDs in context
  allowedTools: string[];
  activatedTools: SessionActivatedTool[];
  onToggleArtifact: (artifactId: string) => void;
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
  onOpenSessionGraph?: (sessionId: string) => void;
  /** Increment this to trigger a session list refresh */
  refreshTrigger?: number;
}

export function ContextPanel({ agentId, sessionId, artifacts, allowedTools, activatedTools, onToggleArtifact, onSwitchSession, onDeleteSession, onCreateSession, onOpenSessionGraph, refreshTrigger }: ContextPanelProps) {
  const [allArtifacts, setAllArtifacts] = useState<Artifact[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [skillEntries, setSkillEntries] = useState<Array<{ name: string; assignedToAgent?: boolean; description?: string }>>([]);
  const [skillActionPending, setSkillActionPending] = useState<string | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<'sessions' | 'notes' | 'skills' | 'tools' | 'tasks' | 'artifacts' | 'files' | null>('sessions');

  const SESSION_META_PREFIX = '<!-- ai-team:session-meta ';

  const stripSessionMetaNotes = (raw?: string) => {
    if (!raw) return '';
    const idx = raw.lastIndexOf(SESSION_META_PREFIX);
    if (idx < 0) return raw;
    return raw.slice(0, idx).trimEnd();
  };

  useEffect(() => {
    loadArtifacts();
    loadSessions();
    loadTasks();
    loadSkills();
  }, [agentId]);

  // Re-fetch sessions whenever ChatPanel signals a new session was created
  useEffect(() => {
    if (refreshTrigger === undefined || refreshTrigger === 0) return;
    loadSessions();
  }, [refreshTrigger]);

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

  const loadSkills = async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const response = await fetch(`${API_BASE}/api/skills?agent=${encodeURIComponent(agentId)}`);
      if (!response.ok) {
        throw new Error(`Failed to load skills: ${response.statusText}`);
      }
      const data = await response.json();
      const entries = Array.isArray(data.entries) ? data.entries : [];
      setSkillEntries(
        entries
          .map((entry: any) => ({
            name: entry.name,
            assignedToAgent: entry.assignedToAgent,
            description: entry.description,
          }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
      );
    } catch (error: any) {
      setSkillsError(error?.message || 'Failed to load skills');
      setSkillEntries([]);
    } finally {
      setSkillsLoading(false);
    }
  };

  const handleToggleSkill = async (skillName: string, currentlyAssigned: boolean) => {
    setSkillActionPending(skillName);
    setSkillsError(null);
    try {
      const endpoint = currentlyAssigned ? 'remove' : 'add';
      const response = await fetch(`${API_BASE}/api/skills/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentId, skill: skillName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${currentlyAssigned ? 'remove' : 'add'} skill`);
      }

      await loadSkills();
    } catch (error: any) {
      setSkillsError(error?.message || 'Failed to update skill assignment');
    } finally {
      setSkillActionPending(null);
    }
  };

  const currentSession = sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    setNotesDraft(stripSessionMetaNotes(currentSession?.notes));
    setNotesError(null);
  }, [sessionId, currentSession?.notes]);

  const saveNotes = async () => {
    if (!sessionId) return;
    setSavingNotes(true);
    setNotesError(null);
    try {
      const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesDraft }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save notes: ${response.statusText}`);
      }
      await loadSessions();
    } catch (error: any) {
      setNotesError(error?.message || 'Failed to save notes');
    } finally {
      setSavingNotes(false);
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

  const toggleSection = (section: 'sessions' | 'notes' | 'skills' | 'tools' | 'tasks' | 'artifacts' | 'files') => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const getToolPhaseLabel = (phase?: SessionActivatedTool['toolPhase']) => {
    switch (phase) {
      case 'request': return 'Requested';
      case 'start': return 'Running';
      case 'result': return 'Completed';
      case 'error': return 'Error';
      case 'denied': return 'Denied';
      default: return 'Observed';
    }
  };

  const getToolPhaseClass = (phase?: SessionActivatedTool['toolPhase']) => {
    switch (phase) {
      case 'request':
      case 'start':
        return 'running';
      case 'result':
        return 'completed';
      case 'error':
      case 'denied':
        return 'failed';
      default:
        return 'neutral';
    }
  };

  const recentToolEvents = [...activatedTools]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 12);

  const activeToolNames = (() => {
    const latestByTool = new Map<string, SessionActivatedTool>();
    for (const event of activatedTools) {
      const prev = latestByTool.get(event.toolName);
      if (!prev || new Date(event.timestamp).getTime() >= new Date(prev.timestamp).getTime()) {
        latestByTool.set(event.toolName, event);
      }
    }
    return Array.from(latestByTool.values())
      .filter((entry) => entry.toolPhase === 'request' || entry.toolPhase === 'start')
      .map((entry) => entry.toolName)
      .sort((a, b) => a.localeCompare(b));
  })();

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
          <div className="context-section-header-wrapper">
            <button
              className={`context-section-header ${expandedSection === 'sessions' ? 'expanded' : ''}`}
              onClick={() => toggleSection('sessions')}
            >
              <i className={`codicon codicon-chevron-${expandedSection === 'sessions' ? 'down' : 'right'}`} />
              <span className="context-section-title"><i className="codicon codicon-comment-discussion" /> Session</span>
              <span className="context-section-count">{sessions.length}</span>
            </button>
            {onCreateSession && (
              <button
                className="context-section-action"
                onClick={onCreateSession}
                title="Create new session"
              >
                <i className="codicon codicon-add" />
              </button>
            )}
          </div>

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
                        {onOpenSessionGraph && (
                          <button
                            className="context-item-action"
                            onClick={(e) => { e.stopPropagation(); onOpenSessionGraph(session.id); }}
                            title="View session thread graph"
                          >
                            <i className="codicon codicon-git-branch" />
                          </button>
                        )}
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

        {/* Notes Section */}
        <div className="context-section">
          <button
            className={`context-section-header ${expandedSection === 'notes' ? 'expanded' : ''}`}
            onClick={() => toggleSection('notes')}
          >
            <i className={`codicon codicon-chevron-${expandedSection === 'notes' ? 'down' : 'right'}`} />
            <span className="context-section-title"><i className="codicon codicon-note" /> Notes</span>
            <span className="context-section-count">{notesDraft.trim().length > 0 ? 1 : 0}</span>
          </button>

          {expandedSection === 'notes' && (
            <div className="context-section-content">
              {!sessionId ? (
                <div className="context-empty">Start or open a session to keep notes.</div>
              ) : (
                <div className="context-notes-wrap">
                  <textarea
                    className="context-notes-input"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Write session notes here..."
                    rows={5}
                  />
                  <div className="context-notes-actions">
                    <button type="button" className="context-notes-save" onClick={saveNotes} disabled={savingNotes}>
                      {savingNotes ? 'Saving…' : 'Save notes'}
                    </button>
                    {notesError ? <span className="context-notes-error">{notesError}</span> : null}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Skills Section */}
        <div className="context-section">
          <button
            className={`context-section-header ${expandedSection === 'skills' ? 'expanded' : ''}`}
            onClick={() => toggleSection('skills')}
          >
            <i className={`codicon codicon-chevron-${expandedSection === 'skills' ? 'down' : 'right'}`} />
            <span className="context-section-title"><i className="codicon codicon-library" /> Skills</span>
            <span className="context-section-count">{skillEntries.filter((entry) => entry.assignedToAgent).length}</span>
          </button>

          {expandedSection === 'skills' && (
            <div className="context-section-content">
              {skillsLoading ? (
                <div className="context-loading">Loading skills...</div>
              ) : skillEntries.length === 0 ? (
                <div className="context-empty">No skills available.</div>
              ) : (
                <div className="context-items">
                  {skillEntries.map((entry) => {
                    const assigned = entry.assignedToAgent === true;
                    const pending = skillActionPending === entry.name;
                    return (
                      <div key={entry.name} className={`context-item ${assigned ? 'context-item-active' : ''}`}>
                        <div className="context-item-header">
                          <span className="context-item-title">{entry.name}</span>
                          <button
                            className="context-item-action context-skill-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleToggleSkill(entry.name, assigned);
                            }}
                            disabled={pending || !!skillActionPending}
                            title={assigned ? 'Remove skill' : 'Assign skill'}
                          >
                            {pending ? '…' : assigned ? '−' : '+'}
                          </button>
                        </div>
                        {entry.description ? (
                          <div className="context-item-meta">
                            <span className="context-item-extra">{entry.description}</span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              {skillsError ? <div className="context-empty context-skills-error">{skillsError}</div> : null}
            </div>
          )}
        </div>

        {/* Tools Section */}
        <div className="context-section">
          <button
            className={`context-section-header ${expandedSection === 'tools' ? 'expanded' : ''}`}
            onClick={() => toggleSection('tools')}
          >
            <i className={`codicon codicon-chevron-${expandedSection === 'tools' ? 'down' : 'right'}`} />
            <span className="context-section-title"><i className="codicon codicon-tools" /> Tools</span>
            <span className="context-section-count">{activeToolNames.length}/{allowedTools.length}</span>
          </button>

          {expandedSection === 'tools' && (
            <div className="context-section-content">
              <div className="context-tools-block">
                <div className="context-tools-subtitle">Allowed</div>
                {allowedTools.length === 0 ? (
                  <div className="context-empty">No tools are currently allowed for this agent.</div>
                ) : (
                  <div className="context-tool-chip-list">
                    {allowedTools.map((toolName) => (
                      <span key={toolName} className={`context-tool-chip ${activeToolNames.includes(toolName) ? 'is-active' : ''}`}>
                        {toolName}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="context-tools-block">
                <div className="context-tools-subtitle">Activated (recent)</div>
                {recentToolEvents.length === 0 ? (
                  <div className="context-empty">No tool activity yet in this session.</div>
                ) : (
                  <div className="context-items">
                    {recentToolEvents.map((event, index) => (
                      <div key={`${event.toolName}-${event.timestamp}-${index}`} className="context-item context-tool-event">
                        <div className="context-item-header">
                          <span className="context-item-title">{event.toolName}</span>
                          <span className={`context-tool-phase ${getToolPhaseClass(event.toolPhase)}`}>
                            {getToolPhaseLabel(event.toolPhase)}
                          </span>
                        </div>
                        <div className="context-item-meta">
                          <span className="context-item-date">{formatSessionTime(event.timestamp)}</span>
                          {event.message ? <span className="context-item-extra">{event.message}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
          </button>

          {expandedSection === 'files' && (
            <div className="context-section-content context-section-filetree">
              <FileTree agentId={agentId} editMode={false} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
