import type { ApiDescription } from '@ts-http/core';
import type {
  ChatSession,
  ChatMessage,
  SessionThread,
  SessionDeleteImpact,
  Note,
  NoteAttachmentInput,
  NoteAttachmentUpdateInput,
  MessageSessionLink,
  NoteMarkdownExportResult,
} from '../shared-types.js';

export interface ISessionsService {
  recent(query?: { limit?: number }): Promise<ChatSession[]>;
  list(query?: { agentId?: string; limit?: number; offset?: number }): Promise<ChatSession[]>;
  latestByAgent(agentId: string): Promise<ChatSession>;
  create(body: { agentId: string; developerId?: string; title?: string }): Promise<ChatSession>;
  handoff(body: {
    toAgentId: string;
    developerId?: string;
    previousSessionId: string;
    transferArtifacts?: boolean;
    transferAllowedFiles?: boolean;
  }): Promise<ChatSession>;
  getById(sessionId: string): Promise<ChatSession>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  deleteMessage(sessionId: string, timestamp: string): Promise<{ ok: boolean }>;
  getThread(sessionId: string): Promise<SessionThread>;
  getDeleteImpact(sessionId: string): Promise<SessionDeleteImpact>;
  listNotes(sessionId: string): Promise<Note[]>;
  listDashboardNotes(query?: { limit?: number }): Promise<Note[]>;
  createNote(
    sessionId: string,
    body: {
      agentId: string;
      sharedSessionIds?: string[];
      title?: string;
      content?: string;
      hiddenFromLlm?: boolean;
      showOnDashboard?: boolean;
      tags?: string[];
      attachments?: NoteAttachmentInput[];
      attachment?: NoteAttachmentInput;
    }
  ): Promise<Note>;
  getNote(sessionId: string, noteId: string): Promise<Note>;
  updateNote(
    sessionId: string,
    noteId: string,
    body: {
      title?: string;
      content?: string;
      compactedContent?: string | null;
      tags?: string[];
      sharedSessionIds?: string[] | null;
      hiddenFromLlm?: boolean;
      showOnDashboard?: boolean;
      attachments?: NoteAttachmentUpdateInput[] | null;
      attachment?: NoteAttachmentInput | null;
    }
  ): Promise<Note>;
  compactNote(
    sessionId: string,
    noteId: string,
    body?: { maxWords?: number; focusInstruction?: string }
  ): Promise<Note>;
  crawlSummarizeWebsiteNote(
    sessionId: string,
    noteId: string,
    body: {
      websiteUrl: string;
      maxPages?: number;
      maxWords?: number;
      focusInstruction?: string;
    }
  ): Promise<Note>;
  exportNoteMarkdown(sessionId: string, noteId: string): Promise<NoteMarkdownExportResult>;
  deleteNote(sessionId: string, noteId: string): Promise<void>;
  listMessageLinks(sessionId: string): Promise<MessageSessionLink[]>;
  createMessageLink(sessionId: string, body: { messageId: number }): Promise<MessageSessionLink>;
  deleteMessageLink(sessionId: string, messageId: string): Promise<void>;
  summarize(
    sessionId: string,
    body: {
      fromIndex: number;
      toIndex: number;
      title: string;
      summary: string;
      developerId?: string;
    }
  ): Promise<unknown>;
  split(
    sessionId: string,
    body: { fromTimestamp: string; newAgentId?: string }
  ): Promise<ChatSession>;
  generateTitle(sessionId: string): Promise<{ title: string }>;
  update(sessionId: string, body: Record<string, unknown>): Promise<ChatSession>;
  deleteWithOptions(
    sessionId: string,
    body?: { deleteUnsharedOwnedNotes?: boolean }
  ): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export const sessionsDesc: ApiDescription<ISessionsService> = {
  subRoute: '/api/sessions',
  mapping: {
    recent: { method: 'GET', path: 'recent' },
    list: { method: 'GET', path: '' },
    latestByAgent: { method: 'GET', path: ':agentId/latest' },
    create: { method: 'POST', path: '' },
    handoff: { method: 'POST', path: 'handoff' },
    getById: { method: 'GET', path: ':sessionId' },
    getMessages: { method: 'GET', path: ':sessionId/messages' },
    deleteMessage: { method: 'DELETE', path: ':sessionId/messages/:timestamp', resultType: 'NONE' },
    getThread: { method: 'GET', path: ':sessionId/thread' },
    getDeleteImpact: { method: 'GET', path: ':sessionId/delete-impact' },
    listDashboardNotes: { method: 'GET', path: 'dashboard-notes' },
    listNotes: { method: 'GET', path: ':sessionId/notes' },
    createNote: { method: 'POST', path: ':sessionId/notes' },
    getNote: { method: 'GET', path: ':sessionId/notes/:noteId' },
    updateNote: { method: 'PUT', path: ':sessionId/notes/:noteId' },
    compactNote: { method: 'POST', path: ':sessionId/notes/:noteId/compact' },
    crawlSummarizeWebsiteNote: {
      method: 'POST',
      path: ':sessionId/notes/:noteId/crawl-summarize',
    },
    exportNoteMarkdown: { method: 'POST', path: ':sessionId/notes/:noteId/export-markdown' },
    deleteNote: { method: 'DELETE', path: ':sessionId/notes/:noteId', resultType: 'NONE' },
    listMessageLinks: { method: 'GET', path: ':sessionId/message-links' },
    createMessageLink: { method: 'POST', path: ':sessionId/message-links' },
    deleteMessageLink: {
      method: 'DELETE',
      path: ':sessionId/message-links/:messageId',
      resultType: 'NONE',
    },
    summarize: { method: 'POST', path: ':sessionId/summarize' },
    split: { method: 'POST', path: ':sessionId/split' },
    generateTitle: { method: 'POST', path: ':sessionId/generate-title' },
    update: { method: 'PUT', path: ':sessionId' },
    deleteWithOptions: { method: 'POST', path: ':sessionId/delete', resultType: 'NONE' },
    delete: { method: 'DELETE', path: ':sessionId', resultType: 'NONE' },
  },
};
