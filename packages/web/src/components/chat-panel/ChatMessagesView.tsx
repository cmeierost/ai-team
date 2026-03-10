import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { Agent, ChatMessage, Developer } from '../../types';
import { getAgentColor } from '../../utils/color';
import { Avatar } from '../Avatar';
import { MarkdownMessage } from '../MarkdownMessage';
import { RelativeTime } from '../RelativeTime';
import { SessionGraphLoader } from '../SessionGraph';
import { MessageDivider } from './MessageDivider';
import { formatDeveloperName, getMessageDisplayName, isHumanMessage, resolveNavigateAgent } from './chatPanelUtils';

interface MessageShellProps {
  className: string;
  handoffId?: string;
  color?: string;
  children: ReactNode;
}

function MessageShell({ className, handoffId, color, children }: Readonly<MessageShellProps>) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    if (color) {
      ref.current.style.setProperty('--agent-color', color);
    } else {
      ref.current.style.removeProperty('--agent-color');
    }
  }, [color]);

  return (
    <div ref={ref} className={className} data-handoff-id={handoffId}>
      {children}
    </div>
  );
}

interface ChatMessagesViewProps {
  agent: Agent;
  agents: Agent[];
  developer?: Developer;
  currentAgentId: string;
  routeAgentId?: string | null;
  currentSessionId: string | null;
  graphSessionId: string | null;
  messages: ChatMessage[];
  editingIndex: number | null;
  editContent: string;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onGraphBack: () => void;
  onSelectSessionFromGraph: (targetSessionId: string, targetAgentId: string, handoffId?: string) => void;
  onSummarize: (toIndex: number) => void;
  onSplitSession: (atIndex: number) => void;
  onEditContentChange: (value: string) => void;
  onEditMessage: (index: number) => void;
  onCancelEdit: () => void;
  onCopyMessage: (content: string) => void;
  onToggleArchive: (index: number, currentlyArchived: boolean) => void;
  onDeleteMessage: (index: number) => void;
  onHandoffClick: (targetAgentId: string, existingSessionId?: string | null) => void;
}

export function ChatMessagesView({ agent, agents, developer, currentAgentId, routeAgentId, currentSessionId, graphSessionId, messages, editingIndex, editContent, messagesContainerRef, messagesEndRef, onScroll, onGraphBack, onSelectSessionFromGraph, onSummarize, onSplitSession, onEditContentChange, onEditMessage, onCancelEdit, onCopyMessage, onToggleArchive, onDeleteMessage, onHandoffClick }: Readonly<ChatMessagesViewProps>) {
  if (graphSessionId) {
    return (
      <>
        <div className="graph-view-header">
          <button className="graph-view-back" onClick={onGraphBack}>
            <i className="codicon codicon-arrow-left" /> Back to chat
          </button>
          <span className="graph-view-header-title">Session thread</span>
        </div>
        <div className="chat-messages chat-messages-graph">
          <SessionGraphLoader
            sessionId={graphSessionId}
            activeSessionId={currentSessionId}
            onSelectSession={onSelectSessionFromGraph}
          />
        </div>
      </>
    );
  }

  const renderDeveloperAvatar = (displayName: string) => {
    const portfolioUrl = developer?.portfolioUrl;

    if (portfolioUrl) {
      return (
        <button
          type="button"
          className="avatar avatar-small avatar-initials avatar-clickable"
          onClick={() => window.open(portfolioUrl, '_blank')}
          title={developer?.name ? `Visit ${developer.name}'s portfolio` : 'Visit developer portfolio'}
        >
          {developer.avatar ? (
            <img
              src={developer.avatar}
              alt={developer.name ?? displayName}
              className="avatar avatar-small developer-avatar-img"
            />
          ) : (
            displayName.substring(0, 2).toUpperCase()
          )}
        </button>
      );
    }

    return (
      <div className="avatar avatar-small avatar-initials">
        {developer?.avatar ? (
          <img
            src={developer.avatar}
            alt={developer.name ?? displayName}
            className="avatar avatar-small developer-avatar-img"
          />
        ) : (
          displayName.substring(0, 2).toUpperCase()
        )}
      </div>
    );
  };

  return (
    <div className="chat-messages" ref={messagesContainerRef} onScroll={onScroll}>
      {messages.length === 0 ? (
        <div className="empty-chat">
          <p>Start a conversation with {agent.name}</p>
          <div className="agent-info">
            <strong>Role:</strong> {agent.role}
          </div>
        </div>
      ) : null}

      {messages.map((message, index) => {
        const navigateTarget = resolveNavigateAgent(message, agents, currentAgentId, routeAgentId);
        const developerDisplayName = developer?.name || formatDeveloperName(message.from);
        const displayName = getMessageDisplayName(message, agents, agent, developer?.name);
        const human = isHumanMessage(message);
        const senderAgent = agents.find((entry) => entry.id === message.from) ?? agent;
        const messageKey = message.handoffId ?? `${message.timestamp}-${message.from}-${message.content.slice(0, 24)}`;
        const isEditingMessage = editingIndex === index;
        const messageClassName = `message message-${human ? 'user' : 'assistant'}${message.archived ? ' message-archived' : ''}`;
        const messageColor = human ? undefined : senderAgent ? getAgentColor(senderAgent) : undefined;

        return (
          <div key={messageKey} className="message-block">
            {index > 0 && (
              <MessageDivider
                messageIndex={index}
                onRestore={onSplitSession}
                onSummarize={onSummarize}
                onSplitSession={onSplitSession}
              />
            )}
            <MessageShell className={messageClassName} color={messageColor} handoffId={message.handoffId ?? undefined}>
              <div className="message-avatar">
                {human ? renderDeveloperAvatar(developerDisplayName) : <Avatar agent={senderAgent} size="small" />}
              </div>
              <div className="message-bubble">
                <div className="message-header">
                  <strong>{displayName}</strong>
                  <RelativeTime timestamp={message.timestamp} className="message-time" />
                  {message.archived ? <span className="archived-badge">📦 Archived</span> : null}
                </div>
                <div className="message-content">
                  {isEditingMessage ? (
                    <div className="message-edit-mode">
                      <textarea
                        value={editContent}
                        onChange={(event) => onEditContentChange(event.target.value)}
                        className="message-edit-textarea"
                        rows={5}
                        title="Edit message content"
                      />
                      <div className="message-edit-actions">
                        <button onClick={() => onEditMessage(index)} className="btn-save">
                          Save
                        </button>
                        <button onClick={onCancelEdit} className="btn-cancel">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="message-content-body">
                      <MarkdownMessage content={message.content} />
                      {navigateTarget && (
                        <button
                          onClick={() => onHandoffClick(navigateTarget.agent.id, navigateTarget.sessionId)}
                          className="btn-handoff-link"
                          title={`Go to ${navigateTarget.agent.name}`}
                        >
                          <Avatar agent={navigateTarget.agent} size="small" />
                          <span>Go to {navigateTarget.agent.name}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {!isEditingMessage && (
                  <div className="message-actions">
                    <button onClick={() => onEditMessage(index)} className="btn-action" title="Edit message">
                      ✏️
                    </button>
                    <button onClick={() => onCopyMessage(message.content)} className="btn-action" title="Copy raw content">
                      📋
                    </button>
                    <button
                      onClick={() => onToggleArchive(index, message.archived || false)}
                      className="btn-action"
                      title={message.archived ? 'Unarchive' : 'Archive (hide from LLM context)'}
                    >
                      {message.archived ? '📂' : '📦'}
                    </button>
                    <button onClick={() => onDeleteMessage(index)} className="btn-action btn-delete" title="Delete message">
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            </MessageShell>
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}
