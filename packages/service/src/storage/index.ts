/**
 * Storage abstraction layer for AI Team
 */

// Contracts
export type {
  IPlanningStorage,
  MessageFilter,
  SessionFilter,
  StorageStats,
  MessageInsertResult,
  Note,
  SessionSkill,
  PlanningIntakeFilter,
  PlanningPlanFilter,
  PlanningTaskFilter,
} from './contracts.js';

// Proposal persistence
export { ProposalStore, type StoredProposal, type StoredProposalFile } from './proposal-store.js';
