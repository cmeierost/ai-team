import { ChatPanelView } from './chat-panel/ChatPanelView';
import { useChatPanelController } from './chat-panel/useChatPanelController';
import './ChatPanel.css';

export function ChatPanel() {
  const controller = useChatPanelController();

  if (!controller.agent) {
    return <div className="error">Agent not found: {controller.currentAgentId}</div>;
  }

  return (
    <ChatPanelView
      agent={controller.agent}
      agents={controller.agents}
      developer={controller.developer ?? undefined}
      routeAgentId={controller.routeAgentId}
      currentAgentId={controller.currentAgentId}
      currentSessionId={controller.currentSessionId}
      currentSessionTitle={controller.currentSessionTitle}
      graphSessionId={controller.graphSessionId}
      loading={controller.loading}
      sending={controller.sending}
      streaming={controller.streaming}
      pendingQuestion={controller.pendingQuestion}
      pendingInputAnswer={controller.pendingInputAnswer}
      pendingPasswordAnswer={controller.pendingPasswordAnswer}
      pendingConfirmAnswer={controller.pendingConfirmAnswer}
      pendingSelectAnswer={controller.pendingSelectAnswer}
      pendingChecklistAnswer={controller.pendingChecklistAnswer}
      pendingFormAnswer={controller.pendingFormAnswer}
      input={controller.input}
      isRecording={controller.isRecording}
      interimTranscript={controller.interimTranscript}
      recognition={controller.recognition}
      ttsEnabled={controller.ttsEnabled}
      ttsSupported={controller.ttsSupported}
      ttsSpeaking={controller.ttsSpeaking}
      ttsPaused={controller.ttsPaused}
      ttsSpeakingWord={controller.ttsSpeakingWord}
      ttsSpeakingOccurrence={controller.ttsSpeakingOccurrence}
      ttsRate={controller.ttsRate}
      onSetTtsRate={controller.setTtsRate}
      messages={controller.messages}
      editingIndex={controller.editingIndex}
      editContent={controller.editContent}
      toolEntries={controller.toolEntries}
      activatedTools={controller.activatedTools}
      messagesEndRef={controller.messagesEndRef}
      messagesContainerRef={controller.messagesContainerRef}
      textareaRef={controller.textareaRef}
      onNavigatePortfolio={controller.handleNavigatePortfolio}
      onGraphBack={controller.handleGraphBack}
      onSelectSessionFromGraph={controller.handleSelectSessionFromGraph}
      onScrollMessages={controller.handleScroll}
      onSummarize={controller.handleSummarize}
      onSplitSession={controller.handleSplitSession}
      onEditContentChange={controller.setEditContent}
      onEditMessage={controller.handleEditMessage}
      onCancelEdit={controller.handleCancelEdit}
      onCopyMessage={controller.handleCopyMessage}
      onSpeakMessage={controller.handleSpeakMessage}
      onStopSpeaking={controller.handleStopSpeaking}
      onPauseSpeaking={controller.handlePauseSpeaking}
      onResumeSpeaking={controller.handleResumeSpeaking}
      onToggleArchive={controller.handleToggleArchive}
      onDeleteMessage={controller.handleDeleteMessage}
      onHandoffClick={controller.handleHandoffClick}
      onOpenFileReference={controller.handleOpenFileReference}
      onOpenAgentReference={controller.handleOpenAgentReference}
      onPendingInputAnswerChange={controller.setPendingInputAnswer}
      onPendingPasswordAnswerChange={controller.setPendingPasswordAnswer}
      onPendingConfirmAnswerChange={controller.setPendingConfirmAnswer}
      onPendingSelectAnswerChange={controller.setPendingSelectAnswer}
      onTogglePendingChecklistValue={controller.togglePendingChecklistValue}
      onPendingFormFieldChange={controller.setPendingFormFieldValue}
      onConfirmDirectAnswer={controller.handleConfirmDirectAnswer}
      onPendingQuestionSubmit={controller.handlePendingQuestionSubmit}
      onInputChange={controller.handleInputChange}
      onInputKeyDown={controller.handleInputKeyDown}
      onStartRecording={controller.startVoiceRecording}
      onStopRecording={controller.stopVoiceRecording}
      onToggleTts={controller.toggleTts}
      onSend={controller.handleSend}
      onInterrupt={controller.handleInterrupt}
      onSwitchSession={controller.handleSwitchSession}
      onDeleteSession={controller.handleDeleteSession}
      onCreateSession={controller.handleCreateSession}
      onSaveSessionTitle={controller.handleSaveSessionTitle}
      onOpenSessionGraph={controller.handleOpenSessionGraph}
      onOpenNote={controller.handleOpenNote}
      onNoteBack={controller.handleNoteBack}
      onNewNote={() => controller.handleOpenNote('new')}
      selectedMessageGroupKeys={controller.selectedMessageGroupKeys}
      onToggleMessageGroupSelection={controller.handleToggleMessageGroupSelection}
      onClearMessageGroupSelection={controller.handleClearMessageGroupSelection}
      onSaveInputAsNote={controller.handleSaveInputAsNote}
      noteRouteId={controller.noteRouteId}
      onSuggestedHandoff={controller.handleSuggestedToolHandoff}
      slashSuggestions={controller.slashSuggestions}
      slashSelectedIndex={controller.slashSelectedIndex}
      slashIsOpen={controller.slashIsOpen}
      onSlashSelect={controller.handleSlashSelect}
    />
  );
}
