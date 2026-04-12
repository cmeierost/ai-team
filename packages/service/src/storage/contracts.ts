import type {
  ChatMessage,
  ChatSession,
} from '@ai-team/infrastructure';

/**
 * Storage interface for chat messages and sessions
 * This abstraction allows swapping storage implementations (SQLite, PostgreSQL, file-based, etc.)
 * without changing business logic in SessionManager or other services.
 */

/**
 * Agent note - persistent notes assigned to agents
 */
export interface Note {
  id: string;  // Auto-generated ID
  agentId: string;  // Agent this note belongs to (e.g., 'architect-agent')
  title?: string;  // Optional title
  content: string;  // Note content (markdown supported)
  tags?: string[];  // Optional tags for categorization
  createdAt: string;  // ISO timestamp
  updatedAt: string;  // ISO timestamp
}

/**
 * A skill file that has been loaded into a session.
 * Only the path is stored; content is read from disk on demand.
 */
export interface SessionSkill {
  sessionId: string;
  /** Workspace-relative path, e.g. `.ai-team/skills/frontend-web-delivery/SKILL.md` */
  skillPath: string;
  loadedAt: string;  // ISO timestamp
  paused: boolean;
}

/**
 * Filter options for querying messages
 */
export interface MessageFilter {
  sessionId?: string;
  fromId?: string;
  toId?: string;
  isHuman?: boolean;
  archived?: boolean;
  handoffType?: string;
  timestampFrom?: string;  // ISO timestamp
  timestampTo?: string;    // ISO timestamp
  limit?: number;
  offset?: number;
}

/**
 * Filter options for querying sessions
 */
export interface SessionFilter {
  developerId?: string;
  agentId?: string;  // Filter by sessions that include this agent
  hasAgents?: string[];  // Filter by sessions that include ALL these agents
  timestampFrom?: string;  // ISO timestamp (startedAt)
  timestampTo?: string;    // ISO timestamp (startedAt)
  limit?: number;
  offset?: number;
  sortBy?: 'startedAt' | 'lastActivityAt' | 'messageCount';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Statistics about storage usage
 */
export interface StorageStats {
  totalSessions: number;
  totalMessages: number;
  storageSize?: number;  // Size in bytes (if applicable)
  schemaVersion?: number;
}

/**
 * Result of a message insertion
 */
export interface MessageInsertResult {
  messageId: string | number;  // Auto-generated ID
  timestamp: string;  // Actual timestamp used
}

/**
 * Abstract interface for message and session storage
 * Implementations must handle their own connection lifecycle and error handling
 */
export interface IMessageStorage {
  // ========== Lifecycle ==========
  
  /**
   * Close storage connections gracefully
   * Called at shutdown
   */
  close(): Promise<void>;
  
  // ========== Messages ==========
  
  /**
   * Insert a new message into storage
   * @returns Auto-generated message ID and actual timestamp used
   */
  insertMessage(sessionId: string, message: ChatMessage): Promise<MessageInsertResult>;
  
  /**
   * Get all messages for a session, ordered by timestamp ascending
   */
  getSessionMessages(sessionId: string, includeArchived?: boolean): Promise<ChatMessage[]>;
  
  /**
   * Query messages with filters
   */
  queryMessages(filter: MessageFilter): Promise<ChatMessage[]>;
  
  /**
   * Archive a message (mark as archived, exclude from LLM context)
   * @returns true if message was found and archived
   */
  archiveMessage(sessionId: string, messageTimestamp: string): Promise<boolean>;
  
  /**
   * Delete a message permanently
   * @returns true if message was found and deleted
   */
  deleteMessage(sessionId: string, messageTimestamp: string): Promise<boolean>;
  
  /**
   * Search messages by content (full-text search if supported, otherwise LIKE)
   */
  searchMessages(query: string, sessionId?: string): Promise<ChatMessage[]>;
  
  // ========== Sessions ==========
  
  /**
   * Create a new session
   * @returns The created session with generated ID
   */
  createSession(session: Omit<ChatSession, 'id' | 'messageCount'>): Promise<ChatSession>;
  
  /**
   * Get a session by ID
   * @returns Session or null if not found
   */
  getSession(sessionId: string): Promise<ChatSession | null>;
  
  /**
   * Update session metadata (title, notes, lastActivityAt, etc.)
   * Does NOT update messageCount - that's managed automatically on message insert
   */
  updateSession(sessionId: string, updates: Partial<Omit<ChatSession, 'id' | 'messageCount'>>): Promise<void>;
  
  /**
   * List sessions with optional filtering and sorting
   */
  listSessions(filter?: SessionFilter): Promise<ChatSession[]>;
  
  /**
   * Delete a session and all its messages
   * @returns true if session was found and deleted
   */
  deleteSession(sessionId: string): Promise<boolean>;
  
  /**
   * Add an agent to a session's agentIds array
   */
  addSessionAgent(sessionId: string, agentId: string): Promise<void>;
  
  /**
   * Remove an agent from a session's agentIds array
   */
  removeSessionAgent(sessionId: string, agentId: string): Promise<void>;
  
  // ========== Statistics ==========
  
  /**
   * Get storage statistics (counts, size, schema version)
   */
  getStats(): Promise<StorageStats>;
  
  // ========== Notes ==========
  
  /**
   * Create a new note for an agent
   * @returns The created note with generated ID
   */
  createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note>;
  
  /**
   * Get a note by ID
   * @returns Note or null if not found
   */
  getNote(noteId: string): Promise<Note | null>;
  
  /**
   * List all notes for a specific agent
   */
  listAgentNotes(agentId: string): Promise<Note[]>;
  
  /**
   * Update a note's content, title, or tags
   */
  updateNote(noteId: string, updates: Partial<Omit<Note, 'id' | 'agentId' | 'createdAt' | 'updatedAt'>>): Promise<void>;
  
  /**
   * Delete a note permanently
   * @returns true if note was found and deleted
   */
  deleteNote(noteId: string): Promise<boolean>;
  
  /**
   * Search notes by content or title
   * @param query Search string
   * @param agentId Optional: limit search to specific agent
   */
  searchNotes(query: string, agentId?: string): Promise<Note[]>;

  // ========== Session Skills ==========

  /**
   * Mark a skill file path as loaded for a session.
   * Idempotent — safe to call if already present (updates loaded_at).
   */
  addSessionSkill(sessionId: string, skillPath: string): Promise<void>;

  /**
   * Return all skill records for a session (both active and paused).
   */
  getSessionSkills(sessionId: string): Promise<SessionSkill[]>;

  /**
   * Set the paused flag for a session skill.
   * Paused skills are not injected into LLM context even when their triggers match.
   */
  setSessionSkillPaused(sessionId: string, skillPath: string, paused: boolean): Promise<void>;

  /**
   * Remove a skill from a session entirely.
   */
  removeSessionSkill(sessionId: string, skillPath: string): Promise<void>;
}

/**
 * Factory function type for creating storage instances
 * Allows dependency injection and easy testing
 */
export type MessageStorageFactory = (workspaceRoot: string) => IMessageStorage;
