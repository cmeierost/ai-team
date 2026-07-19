import type { ChatSession } from './communication.js';
import type { SessionThreadGraphData } from '../storage/contracts.js';

/**
 * Thread management service for session hierarchy operations.
 *
 * Handles chain traversal, handoff resolution, session merging/splitting,
 * and thread graph data construction. Depends on ISessionManager for
 * basic session/message access.
 */
export interface IThreadManager {
  /**
   * Walk the previousSessionId chain from the given session back to the root.
   * Returns sessions ordered root → leaf (oldest first).
   */
  getSessionChain(sessionId: string): Promise<ChatSession[]>;

  /**
   * Get full thread graph data including sessions, messages, and handoff edges.
   */
  getThreadGraphData(sessionId: string): Promise<SessionThreadGraphData>;

  /**
   * Resolve the TO session for a handoff, enforcing the one-session-per-agent-per-thread rule.
   */
  resolveHandoffSession(
    targetAgentId: string,
    currentSessionId: string,
    developerId: string
  ): Promise<{ session: ChatSession; isNew: boolean }>;

  /**
   * Walk the session chain and return the first session that belongs to the specified agent.
   */
  findAgentSessionInChain(fromSessionId: string, agentId: string): Promise<ChatSession | null>;

  /**
   * Merge two sessions - combines messages from newer session into older one.
   */
  mergeSessionsIntoOlder(olderSessionId: string, newerSessionId: string): Promise<ChatSession>;

  /**
   * Split a session at a specific message index.
   * Creates a new session starting from the split point.
   */
  splitSession(sessionId: string, atIndex: number, developerId: string): Promise<ChatSession>;
}
