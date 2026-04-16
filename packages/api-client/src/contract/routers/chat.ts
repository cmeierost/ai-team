import type { ApiDescription } from '@ts-http/core';
import type { ChatSummary, ChatMessage, MessageStats } from '../shared-types.js';

export interface IChatService {
  getSummaries(): Promise<ChatSummary[]>;
  getMessages(agentId: string, query?: { includeArchived?: boolean }): Promise<ChatMessage[]>;
  post(
    agentId: string,
    body: { content: string; pendingIntroduction?: string }
  ): Promise<{ content: string; handoff?: unknown }>;
  editMessage(agentId: string, index: string, body: { content: string }): Promise<ChatMessage>;
  archiveMessage(agentId: string, index: string): Promise<{ ok: boolean }>;
  unarchiveMessage(agentId: string, index: string): Promise<{ ok: boolean }>;
  clearHistory(agentId: string): Promise<{ ok: boolean }>;
  getStats(agentId: string): Promise<MessageStats>;
}

export const chatDesc: ApiDescription<IChatService> = {
  subRoute: '/api/chat',
  mapping: {
    getSummaries: { method: 'GET', path: 'summaries' },
    getMessages: { method: 'GET', path: ':agentId' },
    post: { method: 'POST', path: ':agentId' },
    editMessage: { method: 'PUT', path: ':agentId/messages/:index' },
    archiveMessage: { method: 'DELETE', path: ':agentId/messages/:index', resultType: 'NONE' },
    unarchiveMessage: { method: 'PUT', path: ':agentId/messages/:index/unarchive' },
    clearHistory: { method: 'DELETE', path: ':agentId', resultType: 'NONE' },
    getStats: { method: 'GET', path: ':agentId/stats' },
  },
};
