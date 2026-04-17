import { useState, type DragEvent } from 'react';

interface MessageDividerProps {
  onLinkNote?: (messageIndex: number, noteId: string) => void;
  onUnlinkNote?: (messageIndex: number, noteId: string) => void;
  anchoredNotes?: Array<{ noteId: string; label: string }>;
  onOpenNote?: (noteId: string) => void;
  messageIndex: number;
  onRestore: (atIndex: number) => void;
  onSummarize: (
    toIndex: number,
    options?: { compactPercent?: number; focusInstruction?: string }
  ) => void;
  onSplitSession: (atIndex: number) => void;
}

export function MessageDivider({
  messageIndex,
  onRestore,
  onSummarize,
  onSplitSession,
  onLinkNote,
  onUnlinkNote,
  anchoredNotes,
  onOpenNote,
}: Readonly<MessageDividerProps>) {
  const hasAnchoredNotes = Boolean(anchoredNotes && anchoredNotes.length > 0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [summarizeControlsOpen, setSummarizeControlsOpen] = useState(false);
  const [compactPercent, setCompactPercent] = useState(35);
  const [summaryHint, setSummaryHint] = useState('');

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('application/x-note-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    setIsDragOver(false);
    const noteId = e.dataTransfer.getData('application/x-note-id');
    if (noteId && onLinkNote) {
      e.preventDefault();
      onLinkNote(messageIndex, noteId);
    }
  };
  const mobileMenuId = `message-divider-mobile-menu-${messageIndex}`;

  const handleAction = (action: (index: number) => void) => {
    action(messageIndex);
    setMobileMenuOpen(false);
  };

  const handleToggleSummarizeControls = () => {
    if (hasAnchoredNotes) return;
    setSummarizeControlsOpen((open) => !open);
  };

  const handleApplySummarize = () => {
    const trimmedHint = summaryHint.trim();
    onSummarize(messageIndex, {
      compactPercent,
      ...(trimmedHint ? { focusInstruction: trimmedHint } : {}),
    });
    setSummarizeControlsOpen(false);
    setMobileMenuOpen(false);
  };

  const handleMouseLeave = () => {
    setSummarizeControlsOpen(false);
    setMobileMenuOpen(false);
  };

  return (
    <div
      className={`message-divider${isDragOver ? ' message-divider--drop-target' : ''}${summarizeControlsOpen ? ' message-divider--summarize-open' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseLeave={handleMouseLeave}
    >
      <div className="message-divider-line" role="separator" />
      {anchoredNotes && anchoredNotes.length > 0 ? (
        <div className="message-divider-anchors">
          {anchoredNotes.map((note) => (
            <span key={note.noteId} className="message-divider-anchor-chip-wrap">
              <button
                type="button"
                className="message-divider-anchor-chip"
                title={`Open context summary: ${note.label}`}
                onClick={() => onOpenNote?.(note.noteId)}
              >
                <i className="codicon codicon-note" aria-hidden="true" />
                {note.label}
              </button>
              {onUnlinkNote ? (
                <button
                  type="button"
                  className="message-divider-anchor-remove"
                  title="Remove from context"
                  aria-label={`Remove ${note.label} from context`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUnlinkNote(messageIndex, note.noteId);
                  }}
                >
                  <i className="codicon codicon-close" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {!hasAnchoredNotes && !summarizeControlsOpen ? (
        <>
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
              onClick={handleToggleSummarizeControls}
              className="btn-divider-action"
              title="Show summarize controls"
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
        </>
      ) : null}
      <div
        className="message-divider-card"
        aria-label={`Checkpoint before message ${messageIndex + 1}`}
      >
        <div className="message-divider-bookmark" aria-hidden="true">
          <i className="codicon codicon-bookmark" />
        </div>
        {!hasAnchoredNotes && !summarizeControlsOpen ? (
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
              onClick={handleToggleSummarizeControls}
              className="btn-divider-action"
              title="Show summarize controls"
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
        ) : null}
      </div>
      {!hasAnchoredNotes && summarizeControlsOpen ? (
        <div className="tool-call-summarize-controls" onClick={(event) => event.stopPropagation()}>
          <label
            className="tool-call-summarize-label"
            htmlFor={`checkpoint-compact-${messageIndex}`}
          >
            Compactness: {compactPercent}%
          </label>
          <input
            id={`checkpoint-compact-${messageIndex}`}
            className="tool-call-summarize-slider"
            type="range"
            min={10}
            max={90}
            step={5}
            value={compactPercent}
            onChange={(event) => setCompactPercent(Number(event.target.value))}
          />
          <input
            className="tool-call-summarize-hint"
            type="text"
            value={summaryHint}
            onChange={(event) => setSummaryHint(event.target.value)}
            placeholder="Optional hint (e.g. preserve decisions only)"
          />
          <button
            type="button"
            className="tool-call-summarize-apply"
            onClick={handleApplySummarize}
          >
            Summarize
          </button>
        </div>
      ) : null}
    </div>
  );
}
