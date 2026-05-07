export interface NoteAttachment {
  id: string;
  fileName: string;
  filePath: string;
  contentType?: string;
  sizeBytes: number;
  description?: string;
}

export interface NoteAttachmentInput {
  fileName: string;
  contentBase64: string;
  contentType?: string;
  sizeBytes?: number;
  description?: string;
}

export interface RetainedNoteAttachmentInput {
  id: string;
}

export type NoteAttachmentUpdateInput = NoteAttachmentInput | RetainedNoteAttachmentInput;

export type NoteSessionShareKind = 'compression' | 'linked';

export interface NoteSessionShare {
  noteId: string;
  sessionId: string;
  anchorMessageId?: number;
  kind?: NoteSessionShareKind;
  active: boolean;
  fromMessageId?: number;
  toMessageId?: number;
  createdAt: string;
}

export interface NoteSessionShareUpdateInput {
  anchorMessageId?: number | null;
  kind?: NoteSessionShareKind | null;
  active?: boolean;
  fromMessageId?: number | null;
  toMessageId?: number | null;
}

export interface Note {
  id: string;
  agentId: string;
  sessionId?: string;
  sharedSessionIds?: string[];
  title?: string;
  content: string;
  compactedContent?: string;
  hiddenFromLlm: boolean;
  showOnDashboard: boolean;
  tags?: string[];
  attachments?: NoteAttachment[];
  attachment?: NoteAttachment;
  createdAt: string;
  updatedAt: string;
}

export interface NoteCreateInput {
  agentId: string;
  sessionId?: string;
  sharedSessionIds?: string[];
  title?: string;
  content?: string;
  hiddenFromLlm?: boolean;
  showOnDashboard?: boolean;
  tags?: string[];
  attachments?: NoteAttachmentInput[];
  attachment?: NoteAttachmentInput;
}

export interface NoteUpdateInput {
  sessionId?: string;
  sharedSessionIds?: string[] | null;
  title?: string;
  content?: string;
  compactedContent?: string | null;
  hiddenFromLlm?: boolean;
  showOnDashboard?: boolean;
  tags?: string[];
  attachments?: NoteAttachmentUpdateInput[] | null;
  attachment?: NoteAttachmentInput | null;
}

export interface INotesRepository {
  deleteAttachmentsIfPresentAsync(note: Note | null): Promise<void>;
  createNote(note: NoteCreateInput): Promise<Note>;
  getNote(noteId: string): Promise<Note | null>;
  listSessionNotes(sessionId: string): Promise<Note[]>;
  listAgentNotes(agentId: string): Promise<Note[]>;
  listDashboardNotes(limit?: number): Promise<Note[]>;
  updateNote(noteId: string, updates: NoteUpdateInput): Promise<void>;
  setNoteAttachmentsAsync(noteId: string, attachments: NoteAttachment[]): Promise<void>;
  deleteNote(noteId: string): Promise<boolean>;
  searchNotes(query: string, agentId?: string): Promise<Note[]>;
  listNoteSessionSharesBySessionAsync(sessionId: string): Promise<NoteSessionShare[]>;
  updateNoteSessionShareAsync(
    noteId: string,
    sessionId: string,
    updates: NoteSessionShareUpdateInput
  ): Promise<void>;
}

import type { ILlmToolDefinition, ILlmToolCall, ILlmToolResult } from '../types/runtime-contracts.js';

export interface AttachmentReaderTool {
  toolDef: ILlmToolDefinition;
  executeTool: (toolCall: ILlmToolCall) => Promise<ILlmToolResult>;
}

export interface INoteAttachmentReader {
  isImageAttachment(attachment: NoteAttachment): boolean;
  readAttachmentAsDataUrlAsync(attachment: NoteAttachment): Promise<string>;
  extractAttachmentContentAsync(attachment: NoteAttachment): Promise<string>;
  buildAttachmentReaderTool(attachment: NoteAttachment): AttachmentReaderTool;
  splitIntoChunks(text: string, maxCharsPerChunk?: number): string[];
}
