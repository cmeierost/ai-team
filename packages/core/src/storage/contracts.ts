import type { IPlanningRepository } from '../repositories/planning-repository.js';
import type { ChatMessage } from '../types/communication.js';

export interface SessionThreadGraphSession {
  sessionId: string;
  agentIds: string[];
  developerId: string | null;
  title: string | null;
  startedAt: string;
  lastActivityAt: string;
  previousSessionId: string | null;
  mergedFromSessionIds: string[] | null;
  messageCount: number;
  messages: ChatMessage[];
}

export interface HandoffEdge {
  fromSessionId: string;
  toSessionId: string;
  agentId: string;
  createdAt: string;
}

export interface SessionThreadGraphData {
  rootSessionId: string;
  depth: number;
  sessions: SessionThreadGraphSession[];
  handoffs: HandoffEdge[];
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

export type IPlanningStorage = IPlanningRepository;

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
 * Lifecycle interface for the storage backend.
 * Implemented by SqliteBackend; used only where lifecycle (close, stats) is needed.
 * Domain operations are accessed directly via the repository interfaces.
 */
export interface IMessageStorage {
  migrate(): Promise<number>;
  resetAndInitializeAsync(): Promise<number>;
  close(): Promise<void>;
  getStats(): Promise<StorageStats>;
}

export interface StoredProposalFile {
  filePath: string;
  oldContent: string;
  newContent: string;
  additions?: number;
  deletions?: number;
}

export interface StoredProposal {
  proposalId: string;
  agentName: string;
  description: string;
  createdAt: string;
  files: StoredProposalFile[];
}

export interface IProposalStore {
  save(proposal: StoredProposal): void;
  delete(proposalId: string): void;
  loadAll(): StoredProposal[];
  load(proposalId: string): StoredProposal | null;
}

export interface IProposalStoreFactory {
  create(workspaceRoot: string): IProposalStore;
}
