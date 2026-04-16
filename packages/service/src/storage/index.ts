/**
 * Storage abstraction layer for AI Team
 * Provides interface and implementations for message/session storage
 */

// Contracts
export type {
  IMessageStorage,
  IPlanningStorage,
  MessageFilter,
  SessionFilter,
  StorageStats,
  MessageInsertResult,
  MessageStorageFactory,
  Note,
  SessionSkill,
  PlanningIntakeFilter,
  PlanningPlanFilter,
  PlanningTaskFilter,
} from './contracts.js';

// SQLite implementation
export { SqliteMessageStorage } from './sqlite/sqlite-storage.js';
export { SqliteConnection } from './sqlite/connection.js';
export { MigrationManager, MIGRATIONS, type Migration } from './sqlite/migrations.js';

// Proposal persistence
export { ProposalStore, type StoredProposal, type StoredProposalFile } from './proposal-store.js';

/**
 * Create a SQLite storage instance
 * Default factory function for production use
 */
import { SqliteMessageStorage } from './sqlite/sqlite-storage.js';
export function createSqliteStorage(workspaceRoot: string): SqliteMessageStorage {
  return new SqliteMessageStorage(workspaceRoot);
}
