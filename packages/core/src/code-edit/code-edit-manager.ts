import { type StructuredDiff } from './diff-builder.js';
import {
  type CodeEditProposal,
  type CodeEditProposalInput,
  type CreateProposalOptions,
  type ProposalValidationResult,
  ProposalStatus,
} from './edit-proposal.js';

/**
 * Manages code edit proposals and their lifecycle
 */
export interface ICodeEditManager {
  /**
   * Create a new code edit proposal
   */
  createProposal(
    agentName: string,
    input: CodeEditProposalInput,
    options: CreateProposalOptions
  ): Promise<{ proposal: CodeEditProposal; validation: ProposalValidationResult }>;
  createProposal(
    agentName: string,
    input: CodeEditProposalInput
  ): Promise<{ proposal: CodeEditProposal; validation: ProposalValidationResult }>;

  /**
   * Get a proposal by ID
   */
  getProposal(proposalId: string): CodeEditProposal | undefined;

  /**
   * Get all proposals
   */
  getAllProposals(): CodeEditProposal[];
  /**
   * Get proposals by status
   */
  getProposalsByStatus(status: ProposalStatus): CodeEditProposal[];
  /**
   * Get proposals by agent
   */
  getProposalsByAgent(agentName: string): CodeEditProposal[];
  /**
   * Approve a proposal
   */
  approveProposal(proposalId: string): CodeEditProposal;

  /**
   * Reject a proposal
   */
  rejectProposal(proposalId: string, reason: string): CodeEditProposal;

  /**
   * Apply an approved proposal to the file system
   */
  applyProposal(proposalId: string): Promise<CodeEditProposal>;

  /**
   * Preview changes without applying them
   */
  previewProposal(proposalId: string): {
    proposal: CodeEditProposal;
    diffs: StructuredDiff[];
    summary: string;
  };

  /**
   * Get formatted diffs for terminal display
   */
  getTerminalDiffs(proposalId: string): string[];

  /**
   * Delete a proposal
   */
  deleteProposal(proposalId: string): boolean;
  /**
   * Clear all proposals
   */
  clearProposals(): void;

  /**
   * Get statistics about proposals
   */
  getStatistics(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    applied: number;
    failed: number;
  };
}
