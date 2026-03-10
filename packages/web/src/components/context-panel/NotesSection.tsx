import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface NotesSectionProps {
  notesDraft: string;
  hasSession: boolean;
  savingNotes: boolean;
  notesError: string | null;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onNotesDraftChange: (value: string) => void;
  onSaveNotes: () => void;
}

export function NotesSection({ notesDraft, hasSession, savingNotes, notesError, expandedSection, onToggleSection, onNotesDraftChange, onSaveNotes }: Readonly<NotesSectionProps>) {
  return (
    <ContextPanelSectionFrame
      section="notes"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<span><i className="codicon codicon-note" /> Notes</span>}
      count={notesDraft.trim().length > 0 ? 1 : 0}
    >
      {hasSession ? (
        <div className="context-notes-wrap">
          <textarea
            className="context-notes-input"
            value={notesDraft}
            onChange={(event) => onNotesDraftChange(event.target.value)}
            placeholder="Write session notes here..."
            rows={5}
          />
          <div className="context-notes-actions">
            <button type="button" className="context-notes-save" onClick={onSaveNotes} disabled={savingNotes}>
              {savingNotes ? 'Saving…' : 'Save notes'}
            </button>
            {notesError ? <span className="context-notes-error">{notesError}</span> : null}
          </div>
        </div>
      ) : (
        <div className="context-empty">Start or open a session to keep notes.</div>
      )}
    </ContextPanelSectionFrame>
  );
}
