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
  /** Create a new code edit proposal. */
  createProposal(
    agentName: string,
    input: CodeEditProposalInput,
    options: CreateProposalOptions
  ): Promise<{ proposal: CodeEditProposal; validation: ProposalValidationResult }>;
  createProposal(
    agentName: string,
    input: CodeEditProposalInput
  ): Promise<{ proposal: CodeEditProposal; validation: ProposalValidationResult }>;

  /** Proposal lookup/listing APIs. */
  getProposal(proposalId: string): CodeEditProposal | undefined;
  getAllProposals(): CodeEditProposal[];
  getProposalsByStatus(status: ProposalStatus): CodeEditProposal[];
  getProposalsByAgent(agentName: string): CodeEditProposal[];

  /** Proposal lifecycle actions. */
  approveProposal(proposalId: string): CodeEditProposal;
  rejectProposal(proposalId: string, reason: string): CodeEditProposal;
  applyProposal(proposalId: string): Promise<CodeEditProposal>;

  /** Preview changes without applying them. */
  previewProposal(proposalId: string): {
    proposal: CodeEditProposal;
    diffs: StructuredDiff[];
    summary: string;
  };

  /** Get formatted diffs for terminal display. */
  getTerminalDiffs(proposalId: string): string[];

  /** Proposal cleanup. */
  deleteProposal(proposalId: string): boolean;
  clearProposals(): void;

  /** Statistics over proposal states. */
  getStatistics(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    applied: number;
    failed: number;
  };
}
