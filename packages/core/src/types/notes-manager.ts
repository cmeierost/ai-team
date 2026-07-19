import type {
  Note,
  NoteSessionShare,
  NoteCreateInput,
  NoteUpdateInput,
  NoteSessionShareKind,
} from '../repositories/notes-repository.js';

/**
 * Notes management service.
 *
 * Handles note CRUD, compacting, website crawling, markdown export,
 * note sharing between sessions, and note title generation.
 */
export interface INotesManager {
  listSessionNotes(sessionId: string): Promise<Note[]>;
  listDashboardNotes(limit?: number): Promise<Note[]>;
  listAgentNotes(agentId: string): Promise<Note[]>;
  getNote(noteId: string): Promise<Note | null>;
  createNote(input: NoteCreateInput): Promise<Note>;
  updateNote(noteId: string, updates: NoteUpdateInput): Promise<Note | null>;
  deleteNote(noteId: string): Promise<boolean>;

  exportNoteAsMarkdownAsync(
    noteId: string
  ): Promise<{ markdownPath: string; attachmentPath?: string; attachmentPaths?: string[] } | null>;

  summarizeWebsiteNoteAsync(
    noteId: string,
    websiteUrl: string,
    maxPages?: number,
    maxWords?: number,
    focusInstruction?: string,
    generateTitle?: boolean
  ): Promise<Note | null>;

  compactNoteAsync(
    noteId: string,
    maxWords?: number,
    focusInstruction?: string,
    generateTitle?: boolean
  ): Promise<Note | null>;

  generateNoteTitleForNoteAsync(
    noteId: string,
    focusInstruction?: string
  ): Promise<Note | null>;

  listNoteSessionSharesAsync(sessionId: string): Promise<NoteSessionShare[]>;

  setNoteAnchorAsync(
    sessionId: string,
    noteId: string,
    anchorMessageId: number,
    kind: NoteSessionShareKind,
    fromMessageId?: number,
    toMessageId?: number
  ): Promise<void>;

  deactivateNoteShareAsync(sessionId: string, noteId: string): Promise<void>;
}
