import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Agent, ChatMessage, Developer, SessionActivatedTool } from '../../types';
import { getAgentColor } from '../../utils/color';
import { Avatar } from '../Avatar';
import { MarkdownMessage } from '../MarkdownMessage';
import { RelativeTime } from '../RelativeTime';
import { SessionGraphLoader } from '../SessionGraph';
import { NoteEditorView } from './NoteEditorView';
import { MessageDivider } from './MessageDivider';
import {
  formatDeveloperName,
  getPersistedToolStatus,
  getMessageDisplayName,
  isHumanMessage,
  resolveNavigateAgent,
} from './chatPanelUtils';
import { groupToolEventsForMessage } from '../../utils/toolCallGrouping';
import { ToolCallBlock } from './ToolCallBlock';
import { resolveTtsSpeechText, resolveTtsSelectionRange } from '../../utils/ttsSelection';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PersistedToolCall = {
  id?: number;
  tool?: string;
  params?: unknown;
  result?: unknown;
  resultLlm?: unknown;
  longRunning?: boolean;
};

function toRuntimeCommandResponse(
  toolName: string,
  outcome: 'result' | 'error' | 'denied',
  result: unknown,
  message?: string
) {
  return {
    status: outcome === 'result' ? ('ok' as const) : ('error' as const),
    message:
      message ??
      (outcome === 'result' ? `${toolName} completed.` : `${toolName} failed.`),
    data: result,
  };
}

function getPersistedToolCall(message: ChatMessage): PersistedToolCall | undefined {
  const calls = (message as ChatMessage & { tool_calls?: PersistedToolCall[] }).tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return undefined;
  return calls[0];
}

function resolveToolEvent(
  message: ChatMessage,
  index: number,
  toolEventsByMessage: Map<number, SessionActivatedTool[]>
): SessionActivatedTool {
  const persistedCall = getPersistedToolCall(message);
  const toolNameMatch = /^\[tool:([^\]]+)\]/.exec(message.content);
  const extractedToolName = persistedCall?.tool ?? toolNameMatch?.[1] ?? 'unknown';
  const groupedEvents = toolEventsByMessage.get(index) ?? [];
  const matchingEvent = groupedEvents.find(
    (e) => (e.toolResult?.toolName ?? e.toolName) === extractedToolName
  );

  if (
    matchingEvent &&
    matchingEvent.toolPhase !== 'start' &&
    matchingEvent.toolPhase !== 'request'
  ) {
    return {
      ...matchingEvent,
      toolResult: {
        id: persistedCall?.id,
        ...(matchingEvent.toolResult ?? {
          toolName: extractedToolName,
          outcome: 'result',
        }),
      },
    };
  }

  if (persistedCall) {
    if (persistedCall.longRunning) {
      return {
        toolName: extractedToolName,
        toolPhase: 'request',
        message: 'Workflow in progress; waiting for return.',
        timestamp: message.timestamp,
        toolResult: {
          id: persistedCall.id,
          toolName: extractedToolName,
          outcome: 'request',
          request: persistedCall.params,
          longRunning: true,
        },
      };
    }
    const status = getPersistedToolStatus(persistedCall);
    return {
      toolName: extractedToolName,
      toolPhase: status.phase,
      message: status.message,
      timestamp: message.timestamp,
      toolResult: {
        id: persistedCall.id,
        toolName: extractedToolName,
        outcome: status.outcome,
        request: persistedCall.params,
        commandResponse: toRuntimeCommandResponse(
          extractedToolName,
          status.outcome,
          persistedCall.result,
          status.message
        ),
        resultLlm: persistedCall.resultLlm,
        denial: status.denial,
      },
    };
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
    toolResult: {
      toolName: extractedToolName,
      outcome: 'result',
      commandResponse: toRuntimeCommandResponse(extractedToolName, 'result', parsedResult),
    },
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

function stringifyForNote(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeToolEventForNote(toolEvent: SessionActivatedTool): string {
  const name = toolEvent.toolResult?.toolName ?? toolEvent.toolName;
  const phase = toolEvent.toolPhase;
  const outcome = toolEvent.toolResult?.outcome;
  const requestText = stringifyForNote(toolEvent.toolResult?.request);
  const resultText = stringifyForNote(
    toolEvent.toolResult?.resultLlm ??
      toolEvent.toolResult?.commandResponse?.data ??
      toolEvent.toolResult?.commandResponse?.message
  );
  const messageText = stringifyForNote(toolEvent.message);

  const parts: string[] = [`- **${name}**`];
  if (outcome || phase) {
    parts.push(`(${outcome ?? phase})`);
  }
  if (requestText) {
    parts.push(`\n  - request: ${requestText}`);
  }
  if (resultText) {
    parts.push(`\n  - result: ${resultText}`);
  } else if (messageText) {
    parts.push(`\n  - message: ${messageText}`);
  }

  return parts.join(' ');
}

function buildSingleMessageMarkdown(
  message: ChatMessage,
  displayName: string,
  toolEvents: SessionActivatedTool[]
): string {
  const sections: string[] = [
    `## ${displayName} (${new Date(message.timestamp).toLocaleString()})`,
  ];

  if (toolEvents.length > 0) {
    sections.push(`### Tool calls\n${toolEvents.map(summarizeToolEventForNote).join('\n')}`);
  }

  if (message.content.trim()) {
    sections.push(`### Message\n${message.content.trim()}`);
  }

  return sections.join('\n\n');
}

function buildToolGroupMarkdown(group: ToolGroup): string {
  const sections: string[] = [
    `## ${group.senderAgent.name} (${new Date(group.items[0].message.timestamp).toLocaleString()})`,
  ];

  sections.push(
    `### Tool calls\n${group.items.map((item) => summarizeToolEventForNote(item.toolEvent)).join('\n')}`
  );

  if (group.trailingMessage?.message.content.trim()) {
    sections.push(`### Message\n${group.trailingMessage.message.content.trim()}`);
  }

  return sections.join('\n\n');
}

export interface MessageGroupSelectionPayload {
  key: string;
  label: string;
  markdown: string;
}

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
  noteRouteId: string | null;
  messages: ChatMessage[];
  editingIndex: number | null;
  editContent: string;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onGraphBack: () => void;
  onNoteBack: () => void;
  onOpenNote: (noteId: string, options?: { sessionId?: string; agentId?: string }) => void;
  onSelectSessionFromGraph: (
    targetSessionId: string,
    targetAgentId: string,
    handoffId?: string
  ) => void;
  onSummarize: (
    toIndex: number,
    options?: { compactPercent?: number; focusInstruction?: string }
  ) => void;
  onLinkNote?: (messageIndex: number, noteId: string) => void;
  onUnlinkNote?: (messageIndex: number, noteId: string) => void;
  noteSharesByMessageIndex?: Record<number, Array<{ noteId: string; label: string }>>;
  onSplitSession: (atIndex: number) => void;
  onEditContentChange: (value: string) => void;
  onEditMessage: (index: number) => void;
  onCancelEdit: () => void;
  onCopyMessage: (content: string) => void;
  onToggleArchive: (index: number, currentlyArchived: boolean) => void;
  onToggleToolResultHidden: (messageIndex: number, hidden: boolean, toolCallId?: number) => void;
  onSummarizeToolResult: (
    messageIndex: number,
    options?: { toolCallId?: number; focusInstruction?: string; maxWords?: number }
  ) => void;
  onDeleteMessage: (index: number) => void;
  onHandoffClick: (targetAgentId: string, existingSessionId?: string | null) => void;
  onOpenFileReference: (filePath: string) => void;
  onOpenAgentReference: (agentId: string) => void;
  onSpeakMessage: (content: string, fromAgentId: string, options?: { selected?: boolean }) => void;
  onStopSpeaking: (context?: 'message' | 'input') => void;
  onPauseSpeaking: () => void;
  onResumeSpeaking: () => void;
  ttsSupported: boolean;
  ttsSpeaking: boolean;
  ttsPaused: boolean;
  ttsSpeakingWord: string | null;
  ttsSpeakingOccurrence: number | null;
  activatedTools: SessionActivatedTool[];
  streaming?: boolean;
  compressionInProgress?: boolean;
  selectedMessageGroupKeys: string[];
  onToggleMessageGroupSelection: (selection: MessageGroupSelectionPayload) => void;
}

function resolveSelectionForButton(buttonElement: HTMLButtonElement, fallbackText: string) {
  const scopeElement = buttonElement.closest('.message-bubble')?.querySelector('.message-content');
  const selection = globalThis.window?.getSelection?.() ?? null;
  return resolveTtsSpeechText({
    fallbackText,
    scopeElement: scopeElement ?? null,
    selection,
  });
}

function resolveSelectionRangeForButton(buttonElement: HTMLButtonElement) {
  const scopeElement = buttonElement.closest('.message-bubble')?.querySelector('.message-content');
  const selection = globalThis.window?.getSelection?.() ?? null;
  return resolveTtsSelectionRange({ scopeElement: scopeElement ?? null, selection });
}

function captureSelectionOnMouseDown(event: MouseEvent<HTMLButtonElement>, fallbackText: string) {
  // Keep text selection in the message bubble intact when clicking play.
  event.preventDefault();

  const speechText = resolveSelectionForButton(event.currentTarget, fallbackText);
  if (speechText.selected) {
    event.currentTarget.dataset.ttsSelectionText = speechText.text;
  } else {
    delete event.currentTarget.dataset.ttsSelectionText;
  }
}

function readCapturedOrLiveSelection(buttonElement: HTMLButtonElement, fallbackText: string) {
  const capturedSelectionText = buttonElement.dataset.ttsSelectionText?.trim();
  delete buttonElement.dataset.ttsSelectionText;

  if (capturedSelectionText) {
    return { text: capturedSelectionText, selected: true };
  }

  return resolveSelectionForButton(buttonElement, fallbackText);
}

export function ChatMessagesView({
  agent,
  agents,
  developer,
  currentAgentId,
  routeAgentId,
  currentSessionId,
  graphSessionId,
  noteRouteId,
  messages,
  editingIndex,
  editContent,
  messagesContainerRef,
  messagesEndRef,
  onScroll,
  onGraphBack,
  onNoteBack,
  onOpenNote,
  onSelectSessionFromGraph,
  onSummarize,
  onLinkNote,
  onUnlinkNote,
  noteSharesByMessageIndex,
  onSplitSession,
  onEditContentChange,
  onEditMessage,
  onCancelEdit,
  onCopyMessage,
  onToggleArchive,
  onToggleToolResultHidden,
  onSummarizeToolResult,
  onDeleteMessage,
  onHandoffClick,
  onOpenFileReference,
  onOpenAgentReference,
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
  compressionInProgress,
  selectedMessageGroupKeys,
  onToggleMessageGroupSelection,
}: Readonly<ChatMessagesViewProps>) {
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [speakingSelectionRange, setSpeakingSelectionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Clear the tracked speaking bubble when TTS finishes naturally
  useEffect(() => {
    if (!ttsSpeaking) {
      setSpeakingKey(null);
      setSpeakingSelectionRange(null);
    }
  }, [ttsSpeaking]);

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
      const isTool =
        !human &&
        (message.content.startsWith('[tool:') || getPersistedToolCall(message) !== undefined);

      if (isTool) {
        const senderAgent = agents.find((e) => e.id === message.from) ?? agent;
        const last = groups[groups.length - 1];
        const toolEvent = resolveToolEvent(message, i, toolEventsByMessage);

        if (last?.type === 'tool-group' && last.senderAgent.id === senderAgent.id) {
          last.items.push({ index: i, message, toolEvent });
        } else {
          const messageClassName = `message message-assistant${message.archived || message.hiddenFromLlm ? ' message-archived' : ''}`;
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

  const lastAssistantMessageIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (!isHumanMessage(messages[index])) {
        return index;
      }
    }

    return -1;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: renderGroups.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: () => 220,
    overscan: 8,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalVirtualHeight = virtualizer.getTotalSize();
  const selectedKeySet = useMemo(
    () => new Set(selectedMessageGroupKeys),
    [selectedMessageGroupKeys]
  );

  if (noteRouteId && currentSessionId) {
    return (
      <NoteEditorView
        noteId={noteRouteId}
        sessionId={currentSessionId}
        agentId={currentAgentId}
        onBack={onNoteBack}
        compressionInProgress={compressionInProgress}
        onNoteCreated={onOpenNote}
      />
    );
  }

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

      {messages.length > 0 ? (
        <>
          <div
            className="chat-messages-inner"
            style={{
              width: '100%',
              height: `${totalVirtualHeight}px`,
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualItem) => {
              const group = renderGroups[virtualItem.index];
              if (!group) return null;

              if (group.type === 'tool-group') {
                const { items, firstIndex, senderAgent, messageColor, messageClassName } = group;
                const displayName = senderAgent.name;
                const firstTs = items[0].message.timestamp;
                const groupKey = `tool-group-${firstIndex}`;
                const actionIndex = group.trailingMessage?.index ?? items[items.length - 1].index;
                const actionMessage =
                  group.trailingMessage?.message ?? items[items.length - 1].message;
                const groupTtsKey = `${actionMessage.from}-${actionIndex}`;
                const isGroupSelected = selectedKeySet.has(groupKey);
                const isGroupLastAgentMsg = actionIndex === lastAssistantMessageIndex;
                const isGroupSpeaking =
                  ttsSpeaking &&
                  (speakingKey === groupTtsKey || (speakingKey === null && isGroupLastAgentMsg));
                const groupSelectionRange =
                  speakingKey === groupTtsKey ? speakingSelectionRange : null;

                return (
                  <div
                    key={groupKey}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <div className="message-block">
                      {firstIndex > 0 && (
                        <MessageDivider
                          messageIndex={firstIndex}
                          onRestore={onSplitSession}
                          onSummarize={onSummarize}
                          onSplitSession={onSplitSession}
                          onLinkNote={onLinkNote}
                          onUnlinkNote={onUnlinkNote}
                          anchoredNotes={noteSharesByMessageIndex?.[firstIndex]}
                          onOpenNote={onOpenNote}
                        />
                      )}
                      <MessageShell
                        className={messageClassName}
                        color={messageColor}
                        handoffId={undefined}
                      >
                        <div className="message-avatar">
                          <Avatar agent={senderAgent} size="small" />
                        </div>
                        <div
                          className={`message-bubble${isGroupSelected ? ' message-bubble-selected' : ''}`}
                        >
                          <div className="message-header">
                            <strong>{displayName}</strong>
                            <RelativeTime timestamp={firstTs} className="message-time" />
                            <button
                              type="button"
                              onClick={() =>
                                onToggleArchive(
                                  actionIndex,
                                  actionMessage.hiddenFromLlm || actionMessage.archived || false
                                )
                              }
                              className={`message-select-toggle message-visibility-toggle${actionMessage.hiddenFromLlm || actionMessage.archived ? ' message-visibility-toggle--hidden' : ''}`}
                              title={
                                actionMessage.hiddenFromLlm || actionMessage.archived
                                  ? 'Show to LLM'
                                  : 'Hide from LLM'
                              }
                              aria-label={
                                actionMessage.hiddenFromLlm || actionMessage.archived
                                  ? 'Show to LLM'
                                  : 'Hide from LLM'
                              }
                            >
                              <i
                                className={`codicon codicon-eye message-visibility-icon${actionMessage.hiddenFromLlm || actionMessage.archived ? ' message-visibility-icon--hidden' : ''}`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onToggleMessageGroupSelection({
                                  key: groupKey,
                                  label: `${displayName} @ ${new Date(firstTs).toLocaleString()}`,
                                  markdown: buildToolGroupMarkdown(group),
                                })
                              }
                              className={`message-select-toggle${isGroupSelected ? ' message-select-toggle--active' : ''}`}
                              title={isGroupSelected ? 'Unselect bubble' : 'Select bubble'}
                              aria-label={isGroupSelected ? 'Unselect bubble' : 'Select bubble'}
                            >
                              <i
                                className={`codicon ${isGroupSelected ? 'codicon-pass-filled' : 'codicon-circle-large-outline'}`}
                              />
                            </button>
                          </div>
                          <div className="message-content">
                            <div className="tool-call-list">
                              {items.map(({ index, toolEvent }) => (
                                <ToolCallBlock
                                  key={
                                    toolEvent.toolCallId ??
                                    (typeof toolEvent.toolEventSeq === 'number'
                                      ? `tool-seq-${toolEvent.toolEventSeq}`
                                      : `${toolEvent.toolName}-${index}`)
                                  }
                                  event={toolEvent}
                                  messageIndex={index}
                                  canMutate={Boolean(currentSessionId)}
                                  onToggleHidden={onToggleToolResultHidden}
                                  onSummarize={onSummarizeToolResult}
                                />
                              ))}
                            </div>
                            {group.trailingMessage && (
                              <div className="message-content-body tool-group-trailing-text">
                                <MarkdownMessage
                                  content={group.trailingMessage.message.content}
                                  agents={agents}
                                  onOpenFile={onOpenFileReference}
                                  onOpenAgentChat={onOpenAgentReference}
                                  highlightWord={
                                    isGroupSpeaking &&
                                    (speakingKey === null || speakingKey === groupTtsKey)
                                      ? ttsSpeakingWord
                                      : null
                                  }
                                  highlightOccurrence={
                                    isGroupSpeaking &&
                                    (speakingKey === null || speakingKey === groupTtsKey)
                                      ? ttsSpeakingOccurrence
                                      : null
                                  }
                                  highlightRangeStart={groupSelectionRange?.start ?? null}
                                  highlightRangeEnd={groupSelectionRange?.end ?? null}
                                />
                              </div>
                            )}
                          </div>
                          <div className="message-actions">
                            <button
                              onClick={() => onEditMessage(actionIndex)}
                              className="btn-action"
                              title="Edit message"
                            >
                              <i className="codicon codicon-edit" />
                            </button>
                            <button
                              onClick={() => onCopyMessage(actionMessage.content)}
                              className="btn-action"
                              title="Copy raw content"
                            >
                              <i className="codicon codicon-copy" />
                            </button>
                            {ttsSupported &&
                              (() => {
                                const key = groupTtsKey;
                                return (
                                  <>
                                    <button
                                      onMouseDown={(event) =>
                                        captureSelectionOnMouseDown(event, actionMessage.content)
                                      }
                                      onClick={(clickEvent) => {
                                        const speechText = readCapturedOrLiveSelection(
                                          clickEvent.currentTarget,
                                          actionMessage.content
                                        );

                                        if (speechText.selected) {
                                          const selectionRange = resolveSelectionRangeForButton(
                                            clickEvent.currentTarget
                                          );
                                          setSpeakingSelectionRange(
                                            selectionRange
                                              ? {
                                                  start: selectionRange.start,
                                                  end: selectionRange.end,
                                                }
                                              : null
                                          );
                                          setSpeakingKey(key);
                                          onSpeakMessage(speechText.text, actionMessage.from, {
                                            selected: true,
                                          });
                                          return;
                                        }

                                        if (isGroupSpeaking) {
                                          onStopSpeaking('message');
                                          setSpeakingKey(null);
                                          setSpeakingSelectionRange(null);
                                        } else {
                                          setSpeakingSelectionRange(null);
                                          setSpeakingKey(key);
                                          onSpeakMessage(actionMessage.content, actionMessage.from);
                                        }
                                      }}
                                      className="btn-action"
                                      title={isGroupSpeaking ? 'Stop' : 'Read aloud'}
                                    >
                                      <i
                                        className={`codicon ${isGroupSpeaking ? 'codicon-debug-stop' : 'codicon-play'}`}
                                      />
                                    </button>
                                    {isGroupSpeaking && (
                                      <button
                                        onClick={() =>
                                          ttsPaused ? onResumeSpeaking() : onPauseSpeaking()
                                        }
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
                              onClick={() => onDeleteMessage(actionIndex)}
                              className="btn-action btn-delete"
                              title="Delete message"
                            >
                              <i className="codicon codicon-trash" />
                            </button>
                          </div>
                        </div>
                      </MessageShell>
                    </div>
                  </div>
                );
              }

              const { index, message } = group;
              const navigateTarget = resolveNavigateAgent(
                message,
                agents,
                currentAgentId,
                routeAgentId
              );
              const developerDisplayName = developer?.name || formatDeveloperName(message.from);
              const displayName = getMessageDisplayName(message, agents, agent, developer?.name);
              const human = isHumanMessage(message);
              const senderAgent = agents.find((entry) => entry.id === message.from) ?? agent;
              // Content is streamed and timestamps can collide for persisted
              // messages, so neither is a safe React identity by itself.
              const messageKey = `message-${message.handoffId ?? `${message.timestamp}-${message.from}`}-${index}`;
              const isEditingMessage = editingIndex === index;
              const ttsKey = `${message.from}-${index}`;
              const isLastAgentMsg = !human && index === lastAssistantMessageIndex;
              const isThisSpeaking =
                !human &&
                ttsSpeaking &&
                (speakingKey === ttsKey || (speakingKey === null && isLastAgentMsg));
              const messageSelectionRange = speakingKey === ttsKey ? speakingSelectionRange : null;
              const shouldShowTtsWordHighlight =
                isThisSpeaking && (speakingKey === null || speakingKey === ttsKey);
              const singleGroupKey = `message-${index}`;
              const isSingleGroupSelected = selectedKeySet.has(singleGroupKey);
              const groupedMessageToolEvents = toolEventsByMessage.get(index) ?? [];
              const fallbackPersistedToolEvent = getPersistedToolCall(message)
                ? [resolveToolEvent(message, index, toolEventsByMessage)]
                : [];
              const messageToolEvents =
                groupedMessageToolEvents.length > 0
                  ? groupedMessageToolEvents
                  : fallbackPersistedToolEvent;
              const showThinkingIndicator =
                !human &&
                streaming &&
                index === messages.length - 1 &&
                message.content.length === 0;
              const messageClassName = `message message-${message.kind === 'error' ? 'error' : human ? 'user' : 'assistant'}${message.archived || message.hiddenFromLlm ? ' message-archived' : ''}${isThisSpeaking ? ' message-speaking' : ''}`;
              const messageColor = human
                ? undefined
                : senderAgent
                  ? getAgentColor(senderAgent)
                  : undefined;

              return (
                <div
                  key={messageKey}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="message-block">
                    {index > 0 && (
                      <MessageDivider
                        messageIndex={index}
                        onRestore={onSplitSession}
                        onSummarize={onSummarize}
                        onSplitSession={onSplitSession}
                        onLinkNote={onLinkNote}
                        onUnlinkNote={onUnlinkNote}
                        anchoredNotes={noteSharesByMessageIndex?.[index]}
                        onOpenNote={onOpenNote}
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
                      <div
                        className={`message-bubble${isSingleGroupSelected ? ' message-bubble-selected' : ''}`}
                      >
                        <div className="message-header">
                          <strong>{displayName}</strong>
                          <RelativeTime timestamp={message.timestamp} className="message-time" />
                          <button
                            type="button"
                            onClick={() =>
                              onToggleArchive(
                                index,
                                message.hiddenFromLlm || message.archived || false
                              )
                            }
                            className={`message-select-toggle message-visibility-toggle${message.hiddenFromLlm || message.archived ? ' message-visibility-toggle--hidden' : ''}`}
                            title={
                              message.hiddenFromLlm || message.archived
                                ? 'Show to LLM'
                                : 'Hide from LLM'
                            }
                            aria-label={
                              message.hiddenFromLlm || message.archived
                                ? 'Show to LLM'
                                : 'Hide from LLM'
                            }
                          >
                            <i
                              className={`codicon codicon-eye message-visibility-icon${message.hiddenFromLlm || message.archived ? ' message-visibility-icon--hidden' : ''}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onToggleMessageGroupSelection({
                                key: singleGroupKey,
                                label: `${displayName} @ ${new Date(message.timestamp).toLocaleString()}`,
                                markdown: buildSingleMessageMarkdown(
                                  message,
                                  displayName,
                                  messageToolEvents
                                ),
                              })
                            }
                            className={`message-select-toggle${isSingleGroupSelected ? ' message-select-toggle--active' : ''}`}
                            title={isSingleGroupSelected ? 'Unselect bubble' : 'Select bubble'}
                            aria-label={isSingleGroupSelected ? 'Unselect bubble' : 'Select bubble'}
                          >
                            <i
                              className={`codicon ${isSingleGroupSelected ? 'codicon-pass-filled' : 'codicon-circle-large-outline'}`}
                            />
                          </button>
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
                              {messageToolEvents.length > 0 && (
                                <div className="tool-call-list">
                                  {messageToolEvents.map((toolEvent, i) => (
                                    <ToolCallBlock
                                      key={
                                        toolEvent.toolCallId ??
                                        (typeof toolEvent.toolEventSeq === 'number'
                                          ? `tool-seq-${toolEvent.toolEventSeq}`
                                          : `${toolEvent.toolName}-${toolEvent.timestamp}-${i}`)
                                      }
                                      event={toolEvent}
                                      messageIndex={index}
                                      canMutate={Boolean(currentSessionId)}
                                      onToggleHidden={onToggleToolResultHidden}
                                      onSummarize={onSummarizeToolResult}
                                    />
                                  ))}
                                </div>
                              )}
                              {showThinkingIndicator ? (
                                <span className="typing-indicator" aria-label="Agent is thinking">
                                  <span />
                                  <span />
                                  <span />
                                </span>
                              ) : message.content ? (
                                <MarkdownMessage
                                  content={message.content}
                                  agents={agents}
                                  onOpenFile={onOpenFileReference}
                                  onOpenAgentChat={onOpenAgentReference}
                                  highlightWord={
                                    shouldShowTtsWordHighlight ? ttsSpeakingWord : null
                                  }
                                  highlightOccurrence={
                                    shouldShowTtsWordHighlight ? ttsSpeakingOccurrence : null
                                  }
                                  highlightRangeStart={messageSelectionRange?.start ?? null}
                                  highlightRangeEnd={messageSelectionRange?.end ?? null}
                                />
                              ) : null}
                              {navigateTarget && (
                                <button
                                  onClick={() =>
                                    onHandoffClick(
                                      navigateTarget.agent.id,
                                      navigateTarget.sessionId
                                    )
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
                                      onMouseDown={(event) =>
                                        captureSelectionOnMouseDown(event, message.content)
                                      }
                                      onClick={(clickEvent) => {
                                        const speechText = readCapturedOrLiveSelection(
                                          clickEvent.currentTarget,
                                          message.content
                                        );

                                        if (speechText.selected) {
                                          const selectionRange = resolveSelectionRangeForButton(
                                            clickEvent.currentTarget
                                          );
                                          setSpeakingSelectionRange(
                                            selectionRange
                                              ? {
                                                  start: selectionRange.start,
                                                  end: selectionRange.end,
                                                }
                                              : null
                                          );
                                          setSpeakingKey(key);
                                          onSpeakMessage(speechText.text, message.from, {
                                            selected: true,
                                          });
                                          return;
                                        }

                                        if (isThisSpeaking) {
                                          onStopSpeaking('message');
                                          setSpeakingKey(null);
                                          setSpeakingSelectionRange(null);
                                        } else {
                                          setSpeakingSelectionRange(null);
                                          setSpeakingKey(key);
                                          onSpeakMessage(message.content, message.from);
                                        }
                                      }}
                                      className="btn-action"
                                      title={isThisSpeaking ? 'Stop' : 'Read aloud'}
                                    >
                                      <i
                                        className={`codicon ${isThisSpeaking ? 'codicon-debug-stop' : 'codicon-play'}`}
                                      />
                                    </button>
                                    {isThisSpeaking && (
                                      <button
                                        onClick={() =>
                                          ttsPaused ? onResumeSpeaking() : onPauseSpeaking()
                                        }
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
                  </div>
                </div>
              );
            })}

            <div
              ref={messagesEndRef}
              style={{
                position: 'absolute',
                top: `${totalVirtualHeight}px`,
                left: 0,
                width: 1,
                height: 1,
              }}
            />
          </div>
          {compressionInProgress ? (
            <div className="message-block message-compression-note-block">
              <MessageShell
                className="message message-assistant message-compression-note"
                color="#f1c40f"
              >
                <div className="message-avatar">
                  <i className="codicon codicon-note" aria-hidden="true" />
                </div>
                <div className="message-bubble">
                  <div className="message-header">
                    <strong>Context note</strong>
                    <span className="message-time">compressing…</span>
                  </div>
                  <div className="message-content-body">
                    <span className="typing-indicator" aria-label="Compression is in progress">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </div>
              </MessageShell>
            </div>
          ) : null}
        </>
      ) : (
        <div ref={messagesEndRef} />
      )}
    </div>
  );
}
