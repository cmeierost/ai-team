import { useState } from 'react';

interface MessageDividerProps {
  messageIndex: number;
  onRestore: (atIndex: number) => void;
  onSummarize: (toIndex: number) => void;
  onSplitSession: (atIndex: number) => void;
}

export function MessageDivider({
  messageIndex,
  onRestore,
  onSummarize,
  onSplitSession,
}: Readonly<MessageDividerProps>) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuId = `message-divider-mobile-menu-${messageIndex}`;

  const handleAction = (action: (index: number) => void) => {
    action(messageIndex);
    setMobileMenuOpen(false);
  };

  return (
    <div className="message-divider">
      <div className="message-divider-line" role="separator" />
      <button
        type="button"
        className="message-divider-mobile-toggle"
        aria-expanded={mobileMenuOpen}
        aria-controls={mobileMenuId}
        onClick={() => setMobileMenuOpen((value) => !value)}
      >
        <i className="codicon codicon-bookmark" aria-hidden="true" />
        <span>Checkpoint actions</span>
        <i
          className={`codicon ${mobileMenuOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'}`}
          aria-hidden="true"
        />
      </button>
      <div
        id={mobileMenuId}
        className={`message-divider-mobile-menu${mobileMenuOpen ? ' is-open' : ''}`}
      >
        <button
          onClick={() => handleAction(onRestore)}
          className="btn-divider-action btn-divider-action-primary"
          title="Restore from this checkpoint"
        >
          <i className="codicon codicon-history" aria-hidden="true" />
          <span>Restore</span>
        </button>
        <button
          onClick={() => handleAction(onSummarize)}
          className="btn-divider-action"
          title="Summarize conversation up to here and create a brief"
        >
          <i className="codicon codicon-note" aria-hidden="true" />
          <span>Summarize</span>
        </button>
        <button
          onClick={() => handleAction(onSplitSession)}
          className="btn-divider-action"
          title="Start a new session from this point"
        >
          <i className="codicon codicon-git-branch" aria-hidden="true" />
          <span>Split session</span>
        </button>
      </div>
      <div
        className="message-divider-card"
        aria-label={`Checkpoint before message ${messageIndex + 1}`}
      >
        <div className="message-divider-bookmark" aria-hidden="true">
          <i className="codicon codicon-bookmark" />
        </div>
        <div className="message-divider-copy">
          <span className="message-divider-title">Restore checkpoint</span>
          <span className="message-divider-subtitle">
            Jump back to this point and continue from here.
          </span>
        </div>
        <div className="message-divider-actions">
          <button
            onClick={() => handleAction(onRestore)}
            className="btn-divider-action btn-divider-action-primary"
            title="Restore from this checkpoint"
          >
            <i className="codicon codicon-history" aria-hidden="true" />
            <span>Restore</span>
          </button>
          <button
            onClick={() => handleAction(onSummarize)}
            className="btn-divider-action"
            title="Summarize conversation up to here and create a brief"
          >
            <i className="codicon codicon-note" aria-hidden="true" />
            <span>Summarize</span>
          </button>
          <button
            onClick={() => handleAction(onSplitSession)}
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
