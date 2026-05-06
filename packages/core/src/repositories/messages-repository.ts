import type { ChatMessage } from '../types/communication.js';
import type {
  MessageFilter,
  MessageInsertResult,
  MessageSessionLink,
  SessionSkill,
} from '../storage/contracts.js';

export interface IMessagesRepository {
  insertMessage(sessionId: string, message: ChatMessage): Promise<MessageInsertResult>;
  getSessionMessages(sessionId: string, includeArchived?: boolean): Promise<ChatMessage[]>;
  queryMessages(filter: MessageFilter): Promise<ChatMessage[]>;
  archiveMessage(sessionId: string, messageTimestamp: string): Promise<boolean>;
  deleteMessage(sessionId: string, messageTimestamp: string): Promise<boolean>;
  searchMessages(query: string, sessionId?: string): Promise<ChatMessage[]>;
  getMessageById(messageId: number): Promise<ChatMessage | null>;
  setMessageHiddenFromLlm(messageId: number, hidden: boolean): Promise<boolean>;
  updateMessageContent(messageId: number, newContent: string): Promise<boolean>;
  createMessageSessionLink(messageId: number, sessionId: string): Promise<MessageSessionLink>;
  listMessageSessionLinks(sessionId: string): Promise<MessageSessionLink[]>;
  deleteMessageSessionLink(messageId: number, sessionId: string): Promise<boolean>;
  addSessionSkill(sessionId: string, skillPath: string): Promise<void>;
  getSessionSkills(sessionId: string): Promise<SessionSkill[]>;
  setSessionSkillPaused(sessionId: string, skillPath: string, paused: boolean): Promise<void>;
  removeSessionSkill(sessionId: string, skillPath: string): Promise<void>;
  updateToolCallLlmResult(toolCallId: number, newText: string): Promise<void>;
}
