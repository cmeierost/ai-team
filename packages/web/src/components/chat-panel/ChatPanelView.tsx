import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import type { Agent, ChatMessage, Developer, SessionActivatedTool } from '../../types';
import { Avatar } from '../Avatar';
import { ContextPanel } from '../ContextPanel';
import { ChatMessagesView } from './ChatMessagesView';
import { PendingQuestionForm } from './PendingQuestionForm';
import type { PendingQuestion } from './chatPanelTypes';

const MOBILE_CONTEXT_MEDIA_QUERY = '(max-width: 900px)';

function isMobileViewport(): boolean {
  return globalThis.window !== undefined && globalThis.window.innerWidth <= 900;
}

function useIsMobileViewport() {
  const [mobileViewport, setMobileViewport] = useState(isMobileViewport);

  useEffect(() => {
    if (globalThis.window === undefined) {
      return undefined;
    }

    const mediaQuery = globalThis.window.matchMedia(MOBILE_CONTEXT_MEDIA_QUERY);
    const handleChange = (matches: boolean) => {
      setMobileViewport(matches);
    };

    handleChange(mediaQuery.matches);

    const listener = (event: MediaQueryListEvent) => handleChange(event.matches);
    mediaQuery.addEventListener('change', listener);

    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  return mobileViewport;
}

interface ResponsiveContextPanelProps {
  isMobileViewport: boolean;
  isMobileContextOpen: boolean;
  onCloseMobileContext: () => void;
  agentId: string;
  sessionId?: string;
  artifacts: string[];
  allowedTools: string[];
  activatedTools: SessionActivatedTool[];
  onToggleArtifact: (artifactId: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onDeleteSession: (deletedSessionId: string) => void;
  onCreateSession: () => Promise<void>;
  onOpenSessionGraph: (sessionId: string) => void;
  onSuggestedHandoff: (targetAgentId: string, task?: string) => void;
}

function ResponsiveContextPanel({ isMobileViewport, isMobileContextOpen, onCloseMobileContext, agentId, sessionId, artifacts, allowedTools, activatedTools, onToggleArtifact, onSwitchSession, onDeleteSession, onCreateSession, onOpenSessionGraph, onSuggestedHandoff }: Readonly<ResponsiveContextPanelProps>) {
  const contextPanel = (
    <ContextPanel
      agentId={agentId}
      sessionId={sessionId}
      artifacts={artifacts}
      allowedTools={allowedTools}
      activatedTools={activatedTools}
      onToggleArtifact={onToggleArtifact}
      onSwitchSession={onSwitchSession}
      onDeleteSession={onDeleteSession}
      onCreateSession={onCreateSession}
      onOpenSessionGraph={onOpenSessionGraph}
      onSuggestedHandoff={onSuggestedHandoff}
    />
  );

  if (!isMobileViewport) {
    return contextPanel;
  }

  if (!isMobileContextOpen) {
    return null;
  }

  return (
    <div className="chat-panel-context-mobile-layer">
      <button
        type="button"
        className="chat-panel-context-backdrop"
        aria-label="Close chat context"
        onClick={onCloseMobileContext}
      />
      <div className="chat-panel-context-mobile-sheet" role="dialog" aria-modal="true" aria-label="Chat context">
        <div className="chat-panel-context-mobile-header">
          <strong>Context</strong>
          <button
            type="button"
            className="chat-panel-context-close"
            onClick={onCloseMobileContext}
            aria-label="Close context panel"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>
        {contextPanel}
      </div>
    </div>
  );
}

interface ChatPanelViewProps {
  agent: Agent;
  agents: Agent[];
  developer?: Developer;
  routeAgentId?: string | null;
  currentAgentId: string;
  currentSessionId: string | null;
  graphSessionId: string | null;
  loading: boolean;
  sending: boolean;
  streaming: boolean;
  pendingQuestion: PendingQuestion | null;
  pendingInputAnswer: string;
  pendingPasswordAnswer: string;
  pendingConfirmAnswer: boolean;
  pendingSelectAnswer: string;
  pendingChecklistAnswer: string[];
  pendingFormAnswer: Record<string, string>;
  input: string;
  isRecording: boolean;
  recognition: any;
  messages: ChatMessage[];
  editingIndex: number | null;
  editContent: string;
  artifactsInContext: string[];
  allowedTools: string[];
  activatedTools: SessionActivatedTool[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onNavigatePortfolio: () => void;
  onGraphBack: () => void;
  onSelectSessionFromGraph: (targetSessionId: string, targetAgentId: string, handoffId?: string) => void;
  onScrollMessages: () => void;
  onSummarize: (toIndex: number) => void;
  onSplitSession: (atIndex: number) => void;
  onEditContentChange: (value: string) => void;
  onEditMessage: (index: number) => void;
  onCancelEdit: () => void;
  onCopyMessage: (content: string) => void;
  onToggleArchive: (index: number, currentlyArchived: boolean) => void;
  onDeleteMessage: (index: number) => void;
  onHandoffClick: (targetAgentId: string, existingSessionId?: string | null) => void;
  onPendingInputAnswerChange: (value: string) => void;
  onPendingPasswordAnswerChange: (value: string) => void;
  onPendingConfirmAnswerChange: (value: boolean) => void;
  onPendingSelectAnswerChange: (value: string) => void;
  onTogglePendingChecklistValue: (choiceValue: string, checked: boolean) => void;
  onPendingFormFieldChange: (fieldId: string, value: string) => void;
  onPendingQuestionSubmit: (event: { preventDefault(): void }) => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStartRecording: () => void;
  onSend: () => void;
  onInterrupt: () => void;
  onToggleArtifact: (artifactId: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onDeleteSession: (deletedSessionId: string) => void;
  onCreateSession: () => Promise<void>;
  onOpenSessionGraph: (sessionId: string) => void;
  onSuggestedHandoff: (targetAgentId: string, task?: string) => void;
}

export function ChatPanelView({ agent, agents, developer, routeAgentId, currentAgentId, currentSessionId, graphSessionId, loading, sending, streaming, pendingQuestion, pendingInputAnswer, pendingPasswordAnswer, pendingConfirmAnswer, pendingSelectAnswer, pendingChecklistAnswer, pendingFormAnswer, input, isRecording, recognition, messages, editingIndex, editContent, artifactsInContext, allowedTools, activatedTools, messagesEndRef, messagesContainerRef, textareaRef, onNavigatePortfolio, onGraphBack, onSelectSessionFromGraph, onScrollMessages, onSummarize, onSplitSession, onEditContentChange, onEditMessage, onCancelEdit, onCopyMessage, onToggleArchive, onDeleteMessage, onHandoffClick, onPendingInputAnswerChange, onPendingPasswordAnswerChange, onPendingConfirmAnswerChange, onPendingSelectAnswerChange, onTogglePendingChecklistValue, onPendingFormFieldChange, onPendingQuestionSubmit, onInputChange, onInputKeyDown, onStartRecording, onSend, onInterrupt, onToggleArtifact, onSwitchSession, onDeleteSession, onCreateSession, onOpenSessionGraph, onSuggestedHandoff }: Readonly<ChatPanelViewProps>) {
  const isMobileViewport = useIsMobileViewport();
  const [isMobileContextOpen, setIsMobileContextOpen] = useState(false);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileContextOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileContextOpen) {
      return undefined;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileContextOpen(false);
      }
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [isMobileContextOpen]);

  const closeMobileContext = () => setIsMobileContextOpen(false);

  const handleSwitchSession = (sessionId: string) => {
    onSwitchSession(sessionId);
    if (isMobileViewport) {
      closeMobileContext();
    }
  };

  const handleCreateSession = async () => {
    await onCreateSession();
    if (isMobileViewport) {
      closeMobileContext();
    }
  };

  const handleOpenSessionGraph = (sessionId: string) => {
    onOpenSessionGraph(sessionId);
    if (isMobileViewport) {
      closeMobileContext();
    }
  };

  if (loading) {
    return (
      <div className="chat-panel">
        <div className="chat-header">
          <Avatar agent={agent} size="medium" />
          <div className="chat-header-info">
            <h2>Chat with {agent.name}</h2>
            <p className="agent-role">{agent.role}</p>
          </div>
        </div>
        <div className="chat-messages">
          <div className="empty-chat">
            <p>Loading chat history...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel-container">
      <div className="chat-panel">
        <div className="chat-header">
          <div className="chat-header-main">
            <Avatar agent={agent} size="medium" />
            <div className="chat-header-info">
              <h2>Chat with {agent.name}</h2>
              <p className="agent-role">{agent.role}</p>
            </div>
            {streaming ? <span className="streaming-indicator">●</span> : null}
          </div>
          <div className="chat-header-actions">
            <button onClick={onNavigatePortfolio} className="btn-header-action" title="View portfolio">
              <i className="codicon codicon-account" />
              <span>Portfolio</span>
            </button>
            <button
              type="button"
              onClick={() => setIsMobileContextOpen(true)}
              className="btn-header-action chat-header-mobile-only"
              title="Open chat context"
            >
              <i className="codicon codicon-list-tree" />
              <span>Context</span>
            </button>
          </div>
        </div>

        <ChatMessagesView
          agent={agent}
          agents={agents}
          developer={developer}
          currentAgentId={currentAgentId}
          routeAgentId={routeAgentId}
          currentSessionId={currentSessionId}
          graphSessionId={graphSessionId}
          messages={messages}
          editingIndex={editingIndex}
          editContent={editContent}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          onScroll={onScrollMessages}
          onGraphBack={onGraphBack}
          onSelectSessionFromGraph={onSelectSessionFromGraph}
          onSummarize={onSummarize}
          onSplitSession={onSplitSession}
          onEditContentChange={onEditContentChange}
          onEditMessage={onEditMessage}
          onCancelEdit={onCancelEdit}
          onCopyMessage={onCopyMessage}
          onToggleArchive={onToggleArchive}
          onDeleteMessage={onDeleteMessage}
          onHandoffClick={onHandoffClick}
          streaming={streaming}
        />

        <div className="chat-input-area">
          {pendingQuestion ? (
            <PendingQuestionForm
              pendingQuestion={pendingQuestion}
              pendingInputAnswer={pendingInputAnswer}
              pendingPasswordAnswer={pendingPasswordAnswer}
              pendingConfirmAnswer={pendingConfirmAnswer}
              pendingSelectAnswer={pendingSelectAnswer}
              pendingChecklistAnswer={pendingChecklistAnswer}
              pendingFormAnswer={pendingFormAnswer}
              onPendingInputAnswerChange={onPendingInputAnswerChange}
              onPendingPasswordAnswerChange={onPendingPasswordAnswerChange}
              onPendingConfirmAnswerChange={onPendingConfirmAnswerChange}
              onPendingSelectAnswerChange={onPendingSelectAnswerChange}
              onTogglePendingChecklistValue={onTogglePendingChecklistValue}
              onPendingFormFieldChange={onPendingFormFieldChange}
              onSubmit={onPendingQuestionSubmit}
            />
          ) : (
            <div className="chat-input-container">
              <textarea
                ref={textareaRef}
                className="chat-input-textarea"
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={`Ask ${agent.name}...`}
                rows={1}
                disabled={sending && !streaming}
              />
              <div className="chat-input-actions">
                {streaming ? (
                  <button onClick={onInterrupt} className="chat-action-button chat-interrupt-button" title="Stop generation">
                    <i className="codicon codicon-debug-stop" />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (isRecording) {
                          recognition?.stop();
                        } else {
                          onStartRecording();
                        }
                      }}
                      className={`chat-action-button ${isRecording ? 'chat-recording' : ''}`}
                      title={isRecording ? 'Stop recording' : 'Voice input'}
                      disabled={sending}
                    >
                      <i className={`codicon ${isRecording ? 'codicon-record' : 'codicon-mic'}`} />
                    </button>
                    <button
                      onClick={onSend}
                      disabled={!input.trim() || sending}
                      className="chat-action-button chat-send-button"
                      title="Send message"
                    >
                      <i className="codicon codicon-send" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ResponsiveContextPanel
        isMobileViewport={isMobileViewport}
        isMobileContextOpen={isMobileContextOpen}
        onCloseMobileContext={closeMobileContext}
        agentId={routeAgentId || currentAgentId}
        sessionId={currentSessionId ?? undefined}
        artifacts={artifactsInContext}
        allowedTools={allowedTools}
        activatedTools={activatedTools}
        onToggleArtifact={onToggleArtifact}
        onSwitchSession={handleSwitchSession}
        onDeleteSession={onDeleteSession}
        onCreateSession={handleCreateSession}
        onOpenSessionGraph={handleOpenSessionGraph}
        onSuggestedHandoff={onSuggestedHandoff}
      />
    </div>
  );
}
