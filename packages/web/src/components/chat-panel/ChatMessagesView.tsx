import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Agent, ChatMessage, Developer, SessionActivatedTool } from '../../types';
import { getAgentColor } from '../../utils/color';
import { Avatar } from '../Avatar';
import { MarkdownMessage } from '../MarkdownMessage';
import { RelativeTime } from '../RelativeTime';
import { SessionGraphLoader } from '../SessionGraph';
import { MessageDivider } from './MessageDivider';
import {
  formatDeveloperName,
  getMessageDisplayName,
  isHumanMessage,
  resolveNavigateAgent,
} from './chatPanelUtils';
import { groupToolEventsForMessage } from '../../utils/toolCallGrouping';
import { ToolCallBlock } from './ToolCallBlock';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveToolEvent(
  message: ChatMessage,
  index: number,
  toolEventsByMessage: Map<number, SessionActivatedTool[]>
): SessionActivatedTool {
  const toolNameMatch = /^\[tool:([^\]]+)\]/.exec(message.content);
  const extractedToolName = toolNameMatch?.[1] ?? 'unknown';
  const groupedEvents = toolEventsByMessage.get(index) ?? [];
  const matchingEvent = groupedEvents.find(
    (e) => (e.toolResult?.toolName ?? e.toolName) === extractedToolName
  );

  if (
    matchingEvent &&
    matchingEvent.toolPhase !== 'start' &&
    matchingEvent.toolPhase !== 'request'
  ) {
    return matchingEvent;
  }

  let rawContent = message.content.replace(/^\[tool:[^\]]+\]\s*/, '');
  rawContent = rawContent.replace(/^\[filtered:[^\]]+\]\s*/, '');
  let parsedResult: unknown;
  try {
    parsedResult = JSON.parse(rawContent);
  } catch {
    parsedResult = rawContent || undefined;
  }

  return {
    toolName: extractedToolName,
    toolPhase: 'result',
    timestamp: message.timestamp,
    toolResult: { toolName: extractedToolName, outcome: 'result', result: parsedResult },
  };
}

type ToolGroupItem = { index: number; message: ChatMessage; toolEvent: SessionActivatedTool };
type ToolGroup = {
  type: 'tool-group';
  items: ToolGroupItem[];
  firstIndex: number;
  senderAgent: Agent;
  messageColor: string | undefined;
  messageClassName: string;
  /** An ordinary agent message that immediately follows the tool calls (same sender, no human msg in between). */
  trailingMessage?: { index: number; message: ChatMessage };
};
type SingleMessage = { type: 'message'; index: number; message: ChatMessage };
type RenderGroup = ToolGroup | SingleMessage;

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
  onSelectSessionFromGraph: (
    targetSessionId: string,
    targetAgentId: string,
    handoffId?: string
  ) => void;
  onSummarize: (toIndex: number) => void;
  onSplitSession: (atIndex: number) => void;
  onEditContentChange: (value: string) => void;
  onEditMessage: (index: number) => void;
  onCancelEdit: () => void;
  onCopyMessage: (content: string) => void;
  onToggleArchive: (index: number, currentlyArchived: boolean) => void;
  onDeleteMessage: (index: number) => void;
  onHandoffClick: (targetAgentId: string, existingSessionId?: string | null) => void;
  onSpeakMessage: (content: string, fromAgentId: string) => void;
  onStopSpeaking: () => void;
  onPauseSpeaking: () => void;
  onResumeSpeaking: () => void;
  ttsSupported: boolean;
  ttsSpeaking: boolean;
  ttsPaused: boolean;
  ttsSpeakingWord: string | null;
  ttsSpeakingOccurrence: number | null;
  activatedTools: SessionActivatedTool[];
  streaming?: boolean;
}

export function ChatMessagesView({
  agent,
  agents,
  developer,
  currentAgentId,
  routeAgentId,
  currentSessionId,
  graphSessionId,
  messages,
  editingIndex,
  editContent,
  messagesContainerRef,
  messagesEndRef,
  onScroll,
  onGraphBack,
  onSelectSessionFromGraph,
  onSummarize,
  onSplitSession,
  onEditContentChange,
  onEditMessage,
  onCancelEdit,
  onCopyMessage,
  onToggleArchive,
  onDeleteMessage,
  onHandoffClick,
  onSpeakMessage,
  onStopSpeaking,
  onPauseSpeaking,
  onResumeSpeaking,
  ttsSupported,
  ttsSpeaking,
  ttsPaused,
  ttsSpeakingWord,
  ttsSpeakingOccurrence,
  activatedTools,
  streaming,
}: Readonly<ChatMessagesViewProps>) {
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);

  // Clear the tracked speaking bubble when TTS finishes naturally
  useEffect(() => {
    if (!ttsSpeaking) setSpeakingKey(null);
  }, [ttsSpeaking]);
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
          title={
            developer?.name ? `Visit ${developer.name}'s portfolio` : 'Visit developer portfolio'
          }
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

  const toolEventsByMessage = useMemo(
    () => groupToolEventsForMessage(messages, activatedTools),
    [messages, activatedTools]
  );

  // Group consecutive tool-result messages from the same agent into a single bubble
  const renderGroups = useMemo<RenderGroup[]>(() => {
    const groups: RenderGroup[] = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const human = isHumanMessage(message);
      const isTool = !human && message.content.startsWith('[tool:');

      if (isTool) {
        const senderAgent = agents.find((e) => e.id === message.from) ?? agent;
        const last = groups[groups.length - 1];
        const toolEvent = resolveToolEvent(message, i, toolEventsByMessage);

        if (last?.type === 'tool-group' && last.senderAgent.id === senderAgent.id) {
          last.items.push({ index: i, message, toolEvent });
        } else {
          const messageClassName = `message message-assistant${message.archived ? ' message-archived' : ''}`;
          const messageColor = getAgentColor(senderAgent);
          groups.push({
            type: 'tool-group',
            items: [{ index: i, message, toolEvent }],
            firstIndex: i,
            senderAgent,
            messageColor,
            messageClassName,
          });
        }
      } else {
        // If this non-tool agent message immediately follows a tool-group from the
        // same sender, attach it as trailing text inside that bubble instead of
        // creating a new separate bubble.
        const last = groups[groups.length - 1];
        const senderAgent = !human && (agents.find((e) => e.id === message.from) ?? agent);
        if (
          !human &&
          senderAgent &&
          last?.type === 'tool-group' &&
          last.senderAgent.id === senderAgent.id &&
          !last.trailingMessage
        ) {
          last.trailingMessage = { index: i, message };
        } else {
          groups.push({ type: 'message', index: i, message });
        }
      }
    }
    return groups;
  }, [messages, agents, agent, toolEventsByMessage]);

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

      {renderGroups.map((group, groupIndex) => {
        if (group.type === 'tool-group') {
          const { items, firstIndex, senderAgent, messageColor, messageClassName } = group;
          const displayName = senderAgent.name;
          const firstTs = items[0].message.timestamp;
          const groupKey = `tool-group-${firstIndex}`;
          return (
            <div key={groupKey} className="message-block">
              {firstIndex > 0 && (
                <MessageDivider
                  messageIndex={firstIndex}
                  onRestore={onSplitSession}
                  onSummarize={onSummarize}
                  onSplitSession={onSplitSession}
                />
              )}
              <MessageShell className={messageClassName} color={messageColor} handoffId={undefined}>
                <div className="message-avatar">
                  <Avatar agent={senderAgent} size="small" />
                </div>
                <div className="message-bubble">
                  <div className="message-header">
                    <strong>{displayName}</strong>
                    <RelativeTime timestamp={firstTs} className="message-time" />
                  </div>
                  <div className="message-content">
                    <div className="tool-call-list">
                      {items.map(({ index, toolEvent }) => (
                        <ToolCallBlock key={`${toolEvent.toolName}-${index}`} event={toolEvent} />
                      ))}
                    </div>
                    {group.trailingMessage && (
                      <div className="message-content-body tool-group-trailing-text">
                        <MarkdownMessage content={group.trailingMessage.message.content} />
                      </div>
                    )}
                  </div>
                </div>
              </MessageShell>
            </div>
          );
        }

        // Regular message
        const { index, message } = group;
        const navigateTarget = resolveNavigateAgent(message, agents, currentAgentId, routeAgentId);
        const developerDisplayName = developer?.name || formatDeveloperName(message.from);
        const displayName = getMessageDisplayName(message, agents, agent, developer?.name);
        const human = isHumanMessage(message);
        const senderAgent = agents.find((entry) => entry.id === message.from) ?? agent;
        const messageKey =
          message.handoffId ??
          `${message.timestamp}-${message.from}-${message.content.slice(0, 24)}`;
        const isEditingMessage = editingIndex === index;
        const ttsKey = `${message.from}-${index}`;
        const isLastAgentMsg = !human && messages.slice(index + 1).every((m) => isHumanMessage(m));
        const isThisSpeaking =
          !human &&
          ttsSpeaking &&
          (speakingKey === ttsKey || (speakingKey === null && isLastAgentMsg));
        const messageClassName = `message message-${human ? 'user' : 'assistant'}${message.archived ? ' message-archived' : ''}${isThisSpeaking ? ' message-speaking' : ''}`;
        const messageColor = human
          ? undefined
          : senderAgent
            ? getAgentColor(senderAgent)
            : undefined;

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
            <MessageShell
              className={messageClassName}
              color={messageColor}
              handoffId={message.handoffId ?? undefined}
            >
              <div className="message-avatar">
                {human ? (
                  renderDeveloperAvatar(developerDisplayName)
                ) : (
                  <Avatar agent={senderAgent} size="small" />
                )}
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
                      {!human && !message.content && streaming && index === messages.length - 1 ? (
                        <span className="typing-indicator" aria-label="Agent is thinking">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : (
                        <MarkdownMessage
                          content={message.content}
                          highlightWord={
                            speakingKey === ttsKey && isThisSpeaking ? ttsSpeakingWord : null
                          }
                          highlightOccurrence={
                            speakingKey === ttsKey && isThisSpeaking ? ttsSpeakingOccurrence : null
                          }
                        />
                      )}
                      {navigateTarget && (
                        <button
                          onClick={() =>
                            onHandoffClick(navigateTarget.agent.id, navigateTarget.sessionId)
                          }
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
                    <button
                      onClick={() => onEditMessage(index)}
                      className="btn-action"
                      title="Edit message"
                    >
                      <i className="codicon codicon-edit" />
                    </button>
                    <button
                      onClick={() => onCopyMessage(message.content)}
                      className="btn-action"
                      title="Copy raw content"
                    >
                      <i className="codicon codicon-copy" />
                    </button>
                    {ttsSupported &&
                      !human &&
                      (() => {
                        const key = ttsKey;
                        return (
                          <>
                            <button
                              onClick={() => {
                                if (isThisSpeaking) {
                                  onStopSpeaking();
                                  setSpeakingKey(null);
                                } else {
                                  const sel = window.getSelection();
                                  const selText = sel && sel.toString().trim();
                                  const textToSpeak = selText || message.content;
                                  setSpeakingKey(key);
                                  onSpeakMessage(textToSpeak, message.from);
                                }
                              }}
                              className="btn-action"
                              title={
                                isThisSpeaking
                                  ? 'Stop'
                                  : window.getSelection()?.toString().trim()
                                    ? 'Read selected text'
                                    : 'Read aloud'
                              }
                            >
                              <i
                                className={`codicon ${isThisSpeaking ? 'codicon-debug-stop' : 'codicon-play'}`}
                              />
                            </button>
                            {isThisSpeaking && (
                              <button
                                onClick={() => (ttsPaused ? onResumeSpeaking() : onPauseSpeaking())}
                                className="btn-action"
                                title={ttsPaused ? 'Resume' : 'Pause'}
                              >
                                <i
                                  className={`codicon ${ttsPaused ? 'codicon-play-circle' : 'codicon-debug-pause'}`}
                                />
                              </button>
                            )}
                          </>
                        );
                      })()}
                    <button
                      onClick={() => onToggleArchive(index, message.archived || false)}
                      className="btn-action"
                      title={message.archived ? 'Unarchive' : 'Archive (hide from LLM context)'}
                    >
                      <i
                        className={`codicon ${message.archived ? 'codicon-archive' : 'codicon-inbox'}`}
                      />
                    </button>
                    <button
                      onClick={() => onDeleteMessage(index)}
                      className="btn-action btn-delete"
                      title="Delete message"
                    >
                      <i className="codicon codicon-trash" />
                    </button>
                  </div>
                )}
              </div>
            </MessageShell>
            {!human && (toolEventsByMessage.get(index)?.length ?? 0) > 0 && (
              <div className="tool-call-list">
                {(toolEventsByMessage.get(index) ?? []).map((toolEvent, i) => (
                  <ToolCallBlock
                    key={`${toolEvent.toolName}-${toolEvent.timestamp}-${i}`}
                    event={toolEvent}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}
