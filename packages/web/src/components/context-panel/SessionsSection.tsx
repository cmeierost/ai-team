import type { MouseEvent } from 'react';
import type { ChatSession } from '../../types';
import { formatSessionTime, getSessionTitle } from '../../utils/contextPanel';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface SessionsSectionProps {
  sessions: ChatSession[];
  sessionId?: string;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession: (event: MouseEvent, sessionId: string) => void;
  onCreateSession?: () => void;
  onOpenSessionGraph?: (sessionId: string) => void;
}

export function SessionsSection({
  sessions,
  sessionId,
  expandedSection,
  onToggleSection,
  onSwitchSession,
  onDeleteSession,
  onCreateSession,
  onOpenSessionGraph,
}: Readonly<SessionsSectionProps>) {
  return (
    <ContextPanelSectionFrame
      section="sessions"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={
        <span>
          <i className="codicon codicon-comment-discussion" /> Sessions
        </span>
      }
      count={sessions.length}
      action={
        onCreateSession ? (
          <button
            className="context-section-action"
            onClick={onCreateSession}
            title="Create new session"
          >
            <i className="codicon codicon-add" />
          </button>
        ) : null
      }
    >
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
            >
              <div className="context-item-header">
                <button
                  type="button"
                  className="context-item-link"
                  onClick={() => onSwitchSession?.(session.id)}
                >
                  <i
                    className={`codicon codicon-${session.id === sessionId ? 'circle-filled' : 'circle-outline'} context-item-pin`}
                  />
                  <span className="context-item-title">{getSessionTitle(session)}</span>
                </button>
                <button
                  className="context-item-action"
                  onClick={(event) => onDeleteSession(event, session.id)}
                  title="Delete session"
                >
                  <i className="codicon codicon-trash" />
                </button>
                {onOpenSessionGraph ? (
                  <button
                    className="context-item-action"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSessionGraph(session.id);
                    }}
                    title="View session thread graph"
                  >
                    <i className="codicon codicon-git-branch" />
                  </button>
                ) : null}
              </div>
              <div className="context-item-meta">
                <span className="context-item-date">
                  {formatSessionTime(session.lastActivityAt)}
                </span>
                {session.artifacts && session.artifacts.length > 0 ? (
                  <span className="context-item-extra">
                    {session.artifacts.length} brief{session.artifacts.length > 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </ContextPanelSectionFrame>
  );
}
