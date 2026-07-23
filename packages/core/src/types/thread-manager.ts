import type { ChatSession } from './communication.js';
import type { SessionThreadGraphData } from '../storage/contracts.js';
import type { SessionNavEntry } from './command-types.js';

export interface SessionThreadState {
  rootSessionId: string;
  activeSessionId: string;
  navigationStack: SessionNavEntry[];
  updatedAt: string;
}

/**
 * Thread management service for session hierarchy operations.
 *
 * Handles chain traversal, handoff resolution, session merging/splitting,
 * and thread graph data construction. Depends on ISessionManager for
 * basic session/message access.
 */
export interface IThreadManager {
  /** Resolve any member session to the persisted active session for its thread. */
  resolveActiveSession(
    sessionId: string
  ): Promise<{ session: ChatSession | null; state: SessionThreadState }>;

  /** Resolve the most recently active thread for a developer to its persisted cursor. */
  resolveLatestActiveSession(developerId?: string): Promise<ChatSession | null>;

  /** Find the session with the developer's most recent message or persisted tool activity. */
  resolveLatestSessionWithActivity(developerId?: string): Promise<ChatSession | null>;

  /** Persist a successful outward handoff and its return frame. */
  recordHandoff(
    fromSessionId: string,
    toSessionId: string,
    returnFrame: SessionNavEntry
  ): Promise<SessionThreadState>;

  /** Persist a summarized return handoff while retaining its source in conversation history. */
  recordReturn(
    fromSessionId: string,
    toSessionId: string,
    returnFrame: SessionNavEntry
  ): Promise<SessionThreadState>;

  /** Navigate to and remove the latest conversational history entry. */
  recordBack(fromSessionId: string): Promise<SessionThreadState>;

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
