import { Avatar } from '../Avatar';
import type { Agent } from '../../types';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextPanelNoteItem, ContextSection } from './contextPanelTypes';

interface NotesSectionProps {
  onToggleNoteHidden?: (note: ContextPanelNoteItem, hidden: boolean) => void;
  onDeleteNote?: (note: ContextPanelNoteItem) => void;
  notes: ContextPanelNoteItem[];
  hasSession: boolean;
  notesLoading: boolean;
  sharingNoteId?: string | null;
  deletingNoteId?: string | null;
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
    return 'Pin this note in the current session context.';
  }

  return 'Open note';
}

function getOwnerAgent(noteItem: ContextPanelNoteItem): Agent {
  const ownerId = noteItem.ownerSession.agentIds[0] ?? `owner-${noteItem.ownerSession.sessionId}`;
  const ownerName = noteItem.ownerSession.agentNames[0] ?? ownerId;
  return {
    id: ownerId,
    name: ownerName,
    role: 'Session owner',
  };
}

function getPinnedSubtitle(noteItem: ContextPanelNoteItem, isPinnedInSession: boolean): string {
  if (!isPinnedInSession) {
    return 'Not pinned in this session';
  }

  if (noteItem.isOwnedByCurrentSession) {
    return 'Pinned in this session';
  }

  return `Pinned from ${getOwnerLabel(noteItem)}`;
}

interface NoteRowProps {
  noteItem: ContextPanelNoteItem;
  sharingNoteId?: string | null;
  deletingNoteId?: string | null;
  onSelectNote: (note: ContextPanelNoteItem) => void;
  onDeleteNote?: (note: ContextPanelNoteItem) => void;
  onToggleNoteHidden?: (note: ContextPanelNoteItem, hidden: boolean) => void;
}

interface NoteBadgesProps {
  noteItem: ContextPanelNoteItem;
  sharingNoteId?: string | null;
}

function NoteBadges({ noteItem, sharingNoteId }: Readonly<NoteBadgesProps>) {
  return (
    <span className="context-note-list-badges">
      {noteItem.note.attachment ? <span className="context-note-list-badge">file</span> : null}
      {noteItem.canPullIntoCurrentSession ? (
        <span className="context-note-list-badge context-note-list-badge--muted">
          {sharingNoteId === noteItem.note.id ? 'pinning…' : 'pin'}
        </span>
      ) : null}
      {!noteItem.canPullIntoCurrentSession && !noteItem.isOwnedByCurrentSession ? (
        <span className="context-note-list-badge context-note-list-badge--shared">shared</span>
      ) : null}
    </span>
  );
}

interface NoteRowActionsProps {
  noteItem: ContextPanelNoteItem;
  deletingNoteId?: string | null;
  onDeleteNote?: (note: ContextPanelNoteItem) => void;
  onToggleNoteHidden?: (note: ContextPanelNoteItem, hidden: boolean) => void;
}

function NoteRowActions({
  noteItem,
  deletingNoteId,
  onDeleteNote,
  onToggleNoteHidden,
}: Readonly<NoteRowActionsProps>) {
  const canDelete =
    Boolean(onDeleteNote) &&
    noteItem.isOwnedByCurrentSession &&
    (noteItem.note.sharedSessionIds?.length ?? 0) === 0;

  const canToggleLlmVisibility = Boolean(onToggleNoteHidden) && noteItem.isOwnedByCurrentSession;

  if (!canToggleLlmVisibility && !canDelete) {
    return null;
  }

  return (
    <span className="context-note-list-actions">
      {canToggleLlmVisibility ? (
        <button
          type="button"
          className="context-note-row-action context-note-eye-toggle"
          title={
            noteItem.note.hiddenFromLlm
              ? 'Hidden from LLM (click to show)'
              : 'Visible to LLM (click to hide)'
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggleNoteHidden?.(noteItem, !noteItem.note.hiddenFromLlm);
          }}
        >
          <i
            className={`codicon ${noteItem.note.hiddenFromLlm ? 'codicon-eye-closed' : 'codicon-eye'}`}
            aria-hidden="true"
          />
        </button>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          className="context-note-row-action context-note-delete-toggle"
          title="Delete note (not shared with other sessions)"
          disabled={deletingNoteId === noteItem.note.id}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteNote?.(noteItem);
          }}
        >
          <i
            className={`codicon ${
              deletingNoteId === noteItem.note.id
                ? 'codicon-loading codicon-modifier-spin'
                : 'codicon-trash'
            }`}
            aria-hidden="true"
          />
        </button>
      ) : null}
    </span>
  );
}

function NoteRow({
  noteItem,
  sharingNoteId,
  deletingNoteId,
  onSelectNote,
  onDeleteNote,
  onToggleNoteHidden,
}: Readonly<NoteRowProps>) {
  const isPinnedInSession = !noteItem.canPullIntoCurrentSession;

  return (
    <li
      key={noteItem.note.id}
      className={`context-note-list-row${isPinnedInSession ? ' is-pinned' : ' is-unpinned'}`}
    >
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-note-id', noteItem.note.id);
          e.dataTransfer.effectAllowed = 'link';
        }}
        className={`context-note-list-item${isPinnedInSession ? ' is-pinned' : ' is-muted'}`}
        onClick={() => onSelectNote(noteItem)}
        title={getNoteActionTitle(noteItem)}
      >
        <span className="context-note-owner-avatar" aria-hidden="true">
          <Avatar agent={getOwnerAgent(noteItem)} size="small" />
        </span>
        <span className="context-note-list-copy">
          <span className="context-note-list-title-row">
            <i
              className={`codicon codicon-pinned context-note-pin-icon${isPinnedInSession ? ' is-pinned' : ' is-unpinned'}`}
              aria-hidden="true"
            />
            <span className="context-note-list-title">{getNoteLabel(noteItem.note)}</span>
          </span>
          <span className="context-note-list-subtitle">
            {getPinnedSubtitle(noteItem, isPinnedInSession)}
          </span>
        </span>
        <NoteBadges noteItem={noteItem} sharingNoteId={sharingNoteId} />
      </button>
      <NoteRowActions
        noteItem={noteItem}
        deletingNoteId={deletingNoteId}
        onDeleteNote={onDeleteNote}
        onToggleNoteHidden={onToggleNoteHidden}
      />
    </li>
  );
}

export function NotesSection({
  notes,
  hasSession,
  notesLoading,
  sharingNoteId,
  deletingNoteId,
  expandedSection,
  onToggleSection,
  onSelectNote,
  onDeleteNote,
  onNewNote,
  onToggleNoteHidden,
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
                <NoteRow
                  key={noteItem.note.id}
                  noteItem={noteItem}
                  sharingNoteId={sharingNoteId}
                  deletingNoteId={deletingNoteId}
                  onSelectNote={onSelectNote}
                  onDeleteNote={onDeleteNote}
                  onToggleNoteHidden={onToggleNoteHidden}
                />
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
