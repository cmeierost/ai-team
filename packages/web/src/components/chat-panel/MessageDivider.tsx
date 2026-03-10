interface MessageDividerProps {
  messageIndex: number;
  onRestore: (atIndex: number) => void;
  onSummarize: (toIndex: number) => void;
  onSplitSession: (atIndex: number) => void;
}

export function MessageDivider({ messageIndex, onRestore, onSummarize, onSplitSession }: Readonly<MessageDividerProps>) {
  return (
    <div className="message-divider">
      <div className="message-divider-line" role="separator" />
      <div className="message-divider-card" aria-label={`Checkpoint before message ${messageIndex + 1}`}>
        <div className="message-divider-bookmark" aria-hidden="true">
          <i className="codicon codicon-bookmark" />
        </div>
        <div className="message-divider-copy">
          <span className="message-divider-title">Restore checkpoint</span>
          <span className="message-divider-subtitle">Jump back to this point and continue from here.</span>
        </div>
        <div className="message-divider-actions">
          <button
            onClick={() => onRestore(messageIndex)}
            className="btn-divider-action btn-divider-action-primary"
            title="Restore from this checkpoint"
          >
            <i className="codicon codicon-history" aria-hidden="true" />
            <span>Restore</span>
          </button>
          <button
            onClick={() => onSummarize(messageIndex)}
            className="btn-divider-action"
            title="Summarize conversation up to here and create a brief"
          >
            <i className="codicon codicon-note" aria-hidden="true" />
            <span>Summarize</span>
          </button>
          <button
            onClick={() => onSplitSession(messageIndex)}
            className="btn-divider-action"
            title="Start a new session from this point"
          >
            <i className="codicon codicon-git-branch" aria-hidden="true" />
            <span>Split session</span>
          </button>
        </div>
      </div>
    </div>
  );
}
