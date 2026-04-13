import type { ApiDescription } from '@ts-http/core';
import type { ChatSession, ChatMessage, SessionThread } from '../shared-types.js';

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
    summarize: { method: 'POST', path: ':sessionId/summarize' },
    split: { method: 'POST', path: ':sessionId/split' },
    generateTitle: { method: 'POST', path: ':sessionId/generate-title' },
    update: { method: 'PUT', path: ':sessionId' },
    delete: { method: 'DELETE', path: ':sessionId', resultType: 'NONE' },
  },
};
