import type { ChatMessage, ChatSession } from '@ai-team/infrastructure';
import type {
  PlanningIntakeItem,
  PlanningPlan,
  PlanningPlanSessionVisibility,
  PlanningTask,
  PlanningTaskDelegation,
  PlanningTodo,
  IntakeItemStatus,
  PlanStatus,
} from '@ai-team/core';

/**
 * Storage interface for chat messages and sessions
 * This abstraction allows swapping storage implementations (SQLite, PostgreSQL, file-based, etc.)
 * without changing business logic in SessionManager or other services.
 */

/**
 * Agent note - persistent notes assigned to agents
 */
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
  id: string; // Auto-generated ID
  agentId: string; // Agent this note belongs to (e.g., 'architect-agent')
  sessionId?: string; // Session this note belongs to
  sharedSessionIds?: string[]; // Additional sessions this note is shared with
  title?: string; // Optional title
  content: string; // Note content (markdown supported; may be empty)
  compactedContent?: string; // LLM-generated summary used instead of content when available
  hiddenFromLlm: boolean; // When true the note is excluded from LLM context
  showOnDashboard: boolean; // When true the note is shown on the developer start page
  tags?: string[]; // Optional tags for categorization
  attachments?: NoteAttachment[];
  attachment?: NoteAttachment;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
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

export interface SessionDeleteImpactTransfer {
  noteId: string;
  title?: string;
  targetSessionId: string;
  remainingSharedSessionIds: string[];
}

export interface SessionDeleteImpactBlockingNote {
  noteId: string;
  title?: string;
}

export interface SessionDeleteImpact {
  sessionId: string;
  transferableNotes: SessionDeleteImpactTransfer[];
  unsharedOwnedNotes: SessionDeleteImpactBlockingNote[];
}

export interface SessionDeleteOptions {
  deleteUnsharedOwnedNotes?: boolean;
}

export interface MessageSessionLink {
  messageId: number;
  sessionId: string;
  createdAt: string;
}

/**
 * A skill file that has been loaded into a session.
 * Only the path is stored; content is read from disk on demand.
 */
export interface SessionSkill {
  sessionId: string;
  /** Workspace-relative path, e.g. `.ai-team/skills/frontend-web-delivery/SKILL.md` */
  skillPath: string;
  loadedAt: string; // ISO timestamp
  paused: boolean;
}

export interface PlanningIntakeFilter {
  status?: IntakeItemStatus | IntakeItemStatus[];
  sourceType?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export interface PlanningPlanFilter {
  status?: PlanStatus | PlanStatus[];
  assignedTo?: string;
  createdBy?: string;
  limit?: number;
  offset?: number;
}

export interface PlanningTaskFilter {
  planId?: string;
  sessionId?: string;
  assignedTo?: string;
  status?: string | string[];
  limit?: number;
  offset?: number;
}

export interface IPlanningStorage {
  listPlanningIntakeItemsAsync(filter?: PlanningIntakeFilter): Promise<PlanningIntakeItem[]>;
  upsertPlanningIntakeItemAsync(item: PlanningIntakeItem): Promise<void>;

  createPlanningPlanAsync(plan: PlanningPlan): Promise<PlanningPlan>;
  getPlanningPlanAsync(planId: string): Promise<PlanningPlan | null>;
  listPlanningPlansAsync(filter?: PlanningPlanFilter): Promise<PlanningPlan[]>;
  updatePlanningPlanAsync(planId: string, updates: Partial<PlanningPlan>): Promise<void>;
  getPlanningPlanSessionVisibilityAsync(
    planId: string
  ): Promise<PlanningPlanSessionVisibility | null>;

  createPlanningTaskAsync(task: PlanningTask): Promise<PlanningTask>;
  getPlanningTaskAsync(taskId: string): Promise<PlanningTask | null>;
  listPlanningTasksAsync(filter?: PlanningTaskFilter): Promise<PlanningTask[]>;
  updatePlanningTaskAsync(taskId: string, updates: Partial<PlanningTask>): Promise<void>;

  createPlanningTodoAsync(todo: PlanningTodo): Promise<PlanningTodo>;
  listPlanningTodosAsync(taskId: string): Promise<PlanningTodo[]>;
  updatePlanningTodoAsync(todoId: string, updates: Partial<PlanningTodo>): Promise<void>;

  createPlanningTaskDelegationAsync(
    delegation: PlanningTaskDelegation
  ): Promise<PlanningTaskDelegation>;
  listPlanningTaskDelegationsAsync(taskId: string): Promise<PlanningTaskDelegation[]>;
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
  timestampFrom?: string; // ISO timestamp
  timestampTo?: string; // ISO timestamp
  limit?: number;
  offset?: number;
}

/**
 * Filter options for querying sessions
 */
export interface SessionFilter {
  developerId?: string;
  agentId?: string; // Filter by sessions that include this agent
  hasAgents?: string[]; // Filter by sessions that include ALL these agents
  timestampFrom?: string; // ISO timestamp (startedAt)
  timestampTo?: string; // ISO timestamp (startedAt)
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
  storageSize?: number; // Size in bytes (if applicable)
  schemaVersion?: number;
}

/**
 * Result of a message insertion
 */
export interface MessageInsertResult {
  messageId: string | number; // Auto-generated ID
  timestamp: string; // Actual timestamp used
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

  /**
   * Get a single message by numeric database id.
   */
  getMessageById(messageId: number): Promise<ChatMessage | null>;

  /**
   * Toggle whether a message is visible to the LLM context builder.
   */
  setMessageHiddenFromLlm(messageId: number, hidden: boolean): Promise<boolean>;

  /**
   * Replace persisted message content text.
   */
  updateMessageContent(messageId: number, newContent: string): Promise<boolean>;

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
  updateSession(
    sessionId: string,
    updates: Partial<Omit<ChatSession, 'id' | 'messageCount'>>
  ): Promise<void>;

  /**
   * List sessions with optional filtering and sorting
   */
  listSessions(filter?: SessionFilter): Promise<ChatSession[]>;

  /**
   * Delete a session and all its messages
   * @returns true if session was found and deleted
   */
  deleteSession(sessionId: string, options?: SessionDeleteOptions): Promise<boolean>;

  /**
   * Preview how deleting a session would affect notes owned by that session.
   */
  getSessionDeleteImpact(sessionId: string): Promise<SessionDeleteImpact>;

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
  createNote(note: NoteCreateInput): Promise<Note>;

  /**
   * Get a note by ID
   * @returns Note or null if not found
   */
  getNote(noteId: string): Promise<Note | null>;

  /**
   * List all notes attached to a specific session
   */
  listSessionNotes(sessionId: string): Promise<Note[]>;

  /**
   * List all notes for a specific agent
   */
  listAgentNotes(agentId: string): Promise<Note[]>;

  /**
   * List notes pinned to the dashboard / start page for the developer.
   */
  listDashboardNotes(limit?: number): Promise<Note[]>;

  /**
   * Update a note's content, title, or tags
   */
  updateNote(noteId: string, updates: NoteUpdateInput): Promise<void>;

  /**
   * Update the stored attachment metadata for a note without rewriting file content.
   * Used when attachment files are relocated within the workspace.
   */
  setNoteAttachmentsAsync(noteId: string, attachments: NoteAttachment[]): Promise<void>;

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

  // ========== Note ↔ Session Shares ==========

  /**
   * List all note-session share rows for a session, including anchor metadata.
   */
  listNoteSessionSharesBySessionAsync(sessionId: string): Promise<NoteSessionShare[]>;

  /**
   * Upsert anchor/kind/active metadata on a note_session_shares row.
   * Creates the share row if it does not already exist.
   */
  updateNoteSessionShareAsync(
    noteId: string,
    sessionId: string,
    updates: NoteSessionShareUpdateInput
  ): Promise<void>;

  // ========== Message ↔ Session Links ==========

  createMessageSessionLink(messageId: number, sessionId: string): Promise<MessageSessionLink>;

  listMessageSessionLinks(sessionId: string): Promise<MessageSessionLink[]>;

  deleteMessageSessionLink(messageId: number, sessionId: string): Promise<boolean>;

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

  /**
   * Update the LLM-facing result text for a tool call.
   * Allows the user to edit or summarize a stored tool result so the next
   * LLM turn receives the new text instead of the original output.
   */
  updateToolCallLlmResult(toolCallId: number, newText: string): Promise<void>;
}

/**
 * Factory function type for creating storage instances
 * Allows dependency injection and easy testing
 */
export type MessageStorageFactory = (workspaceRoot: string) => IMessageStorage;
