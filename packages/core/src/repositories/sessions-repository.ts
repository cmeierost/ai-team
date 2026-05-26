import type { ChatSession } from '../types/communication.js';
import type {
  SessionFilter,
  SessionDeleteImpact,
  SessionDeleteOptions,
} from '../storage/contracts.js';

export interface ISessionsRepository {
  createSession(session: Omit<ChatSession, 'id' | 'messageCount'>): Promise<ChatSession>;
  getSession(sessionId: string): Promise<ChatSession | null>;
  updateSession(
    sessionId: string,
    updates: Partial<Omit<ChatSession, 'id' | 'messageCount'>>
  ): Promise<void>;
  listSessions(filter?: SessionFilter): Promise<ChatSession[]>;
  addSessionAgent(sessionId: string, agentId: string): Promise<void>;
  removeSessionAgent(sessionId: string, agentId: string): Promise<void>;
  deleteSession(sessionId: string, options?: SessionDeleteOptions): Promise<boolean>;
  getSessionDeleteImpact(sessionId: string): Promise<SessionDeleteImpact>;
}
