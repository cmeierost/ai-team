import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextPanelNoteItem, ContextSection } from './contextPanelTypes';

interface NotesSectionProps {
  notes: ContextPanelNoteItem[];
  hasSession: boolean;
  notesLoading: boolean;
  sharingNoteId?: string | null;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onSelectNote: (note: ContextPanelNoteItem) => void;
  onNewNote: () => void;
}

function getNoteLabel(note: ContextPanelNoteItem['note']): string {
  return note.title?.trim() || note.attachment?.fileName || 'Untitled note';
}

function getOwnerLabel(note: ContextPanelNoteItem): string {
  return note.ownerSession.title?.trim() || note.ownerSession.agentNames.join(', ');
}

function getNoteActionTitle(note: ContextPanelNoteItem): string {
  if (note.canPullIntoCurrentSession) {
    return 'Share this note with the current session so the LLM can read it.';
  }

  if (note.isOwnedByCurrentSession) {
    return 'Open note';
  }

  return 'Open the source note';
}

export function NotesSection({
  notes,
  hasSession,
  notesLoading,
  sharingNoteId,
  expandedSection,
  onToggleSection,
  onSelectNote,
  onNewNote,
}: Readonly<NotesSectionProps>) {
  return (
    <ContextPanelSectionFrame
      section="notes"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={
        <span>
          <i className="codicon codicon-note" /> Notes
        </span>
      }
      count={notes.length}
    >
      {hasSession ? (
        <div className="context-notes-wrap">
          <div className="context-notes-toolbar">
            <button type="button" className="context-notes-save" onClick={onNewNote}>
              New note
            </button>
          </div>

          {notesLoading ? <div className="context-loading">Loading notes…</div> : null}
          {!notesLoading && notes.length === 0 ? (
            <div className="context-empty">No notes yet.</div>
          ) : null}
          {!notesLoading && notes.length > 0 ? (
            <ul className="context-note-list" aria-label="Session notes">
              {notes.map((noteItem) => (
                <li key={noteItem.note.id}>
                  <button
                    type="button"
                    className={`context-note-list-item${noteItem.canPullIntoCurrentSession ? ' is-muted' : ''}`}
                    onClick={() => onSelectNote(noteItem)}
                    title={getNoteActionTitle(noteItem)}
                  >
                    <span className="context-note-list-copy">
                      <span className="context-note-list-title">{getNoteLabel(noteItem.note)}</span>
                      <span className="context-note-list-subtitle">
                        {noteItem.isOwnedByCurrentSession
                          ? 'This session'
                          : getOwnerLabel(noteItem)}
                      </span>
                    </span>
                    <span className="context-note-list-badges">
                      {noteItem.note.attachment ? (
                        <span className="context-note-list-badge">file</span>
                      ) : null}
                      {noteItem.canPullIntoCurrentSession ? (
                        <span className="context-note-list-badge context-note-list-badge--muted">
                          {sharingNoteId === noteItem.note.id ? 'sharing…' : 'pull in'}
                        </span>
                      ) : null}
                      {!noteItem.canPullIntoCurrentSession && !noteItem.isOwnedByCurrentSession ? (
                        <span className="context-note-list-badge context-note-list-badge--shared">
                          shared
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="context-empty">Start or open a session to keep notes and files.</div>
      )}
    </ContextPanelSectionFrame>
  );
}
