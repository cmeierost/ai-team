import { readFile, writeFile } from 'fs/promises';
import { DiffBuilder, type StructuredDiff } from './diff-builder.js';
import {
  type CodeEditProposal,
  type CodeEditProposalInput,
  type FileChange,
  type CreateProposalOptions,
  type ProposalValidationResult,
  ProposalStatus,
  ProposalValidator,
  generateProposalId,
} from './edit-proposal.js';

/**
 * Manages code edit proposals and their lifecycle
 */
export class CodeEditManager {
  private diffBuilder: DiffBuilder;
  private validator: ProposalValidator;
  private proposals: Map<string, CodeEditProposal> = new Map();

  constructor() {
    this.diffBuilder = new DiffBuilder();
    this.validator = new ProposalValidator();
  }

  /**
   * Create a new code edit proposal
   */
  async createProposal(
    agentName: string,
    input: CodeEditProposalInput,
    options: CreateProposalOptions = {}
  ): Promise<{ proposal: CodeEditProposal; validation: ProposalValidationResult }> {
    // Validate input structure
    const inputValidation = this.validator.validateInput(input);
    if (!inputValidation.valid) {
      throw new Error(`Invalid proposal input: ${inputValidation.errors.join(', ')}`);
    }

    // Validate file paths
    const pathValidation = this.validator.validateFilePaths(
      input.changes.map((c) => c.filePath)
    );
    if (!pathValidation.valid) {
      throw new Error(`Invalid file paths: ${pathValidation.errors.join(', ')}`);
    }

    // Create file changes with diffs
    const changes: FileChange[] = [];

    for (const change of input.changes) {
      const diff = this.diffBuilder.createDiff(
        change.filePath,
        change.oldContent,
        change.newContent
      );

      changes.push({
        filePath: change.filePath,
        oldContent: change.oldContent,
        newContent: change.newContent,
        diff,
      });
    }

    // Create proposal
    const proposal: CodeEditProposal = {
      id: generateProposalId(),
      agentName,
      timestamp: new Date(),
      description: input.description,
      changes,
      status: ProposalStatus.PENDING,
    };

    // Validate constraints
    const constraintValidation = this.validator.validateConstraints(proposal, options);

    // Store proposal
    this.proposals.set(proposal.id, proposal);

    return {
      proposal,
      validation: {
        valid: constraintValidation.valid,
        errors: [...pathValidation.errors, ...constraintValidation.errors],
        warnings: [...pathValidation.warnings, ...constraintValidation.warnings],
      },
    };
  }

  /**
   * Get a proposal by ID
   */
  getProposal(proposalId: string): CodeEditProposal | undefined {
    return this.proposals.get(proposalId);
  }

  /**
   * Get all proposals
   */
  getAllProposals(): CodeEditProposal[] {
    return Array.from(this.proposals.values());
  }

  /**
   * Get proposals by status
   */
  getProposalsByStatus(status: ProposalStatus): CodeEditProposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.status === status);
  }

  /**
   * Get proposals by agent
   */
  getProposalsByAgent(agentName: string): CodeEditProposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.agentName === agentName);
  }

  /**
   * Approve a proposal
   */
  approveProposal(proposalId: string): CodeEditProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== ProposalStatus.PENDING) {
      throw new Error(
        `Proposal ${proposalId} is ${proposal.status}, cannot approve (must be pending)`
      );
    }

    proposal.status = ProposalStatus.APPROVED;
    return proposal;
  }

  /**
   * Reject a proposal
   */
  rejectProposal(proposalId: string, reason: string): CodeEditProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== ProposalStatus.PENDING) {
      throw new Error(
        `Proposal ${proposalId} is ${proposal.status}, cannot reject (must be pending)`
      );
    }

    proposal.status = ProposalStatus.REJECTED;
    proposal.rejectionReason = reason;
    return proposal;
  }

  /**
   * Apply an approved proposal to the file system
   */
  async applyProposal(proposalId: string): Promise<CodeEditProposal> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== ProposalStatus.APPROVED) {
      throw new Error(
        `Proposal ${proposalId} is ${proposal.status}, cannot apply (must be approved)`
      );
    }

    try {
      // Apply all changes
      for (const change of proposal.changes) {
        await writeFile(change.filePath, change.newContent, 'utf-8');
      }

      proposal.status = ProposalStatus.APPLIED;
    } catch (error) {
      proposal.status = ProposalStatus.FAILED;
      proposal.errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    }

    return proposal;
  }

  /**
   * Preview changes without applying them
   */
  previewProposal(proposalId: string): {
    proposal: CodeEditProposal;
    diffs: StructuredDiff[];
    summary: string;
  } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    const diffs = proposal.changes.map((c) => c.diff);
    const summary = this.diffBuilder.getSummary(diffs);

    return {
      proposal,
      diffs,
      summary: `${summary.filesChanged} file(s), +${summary.totalAdditions} additions, -${summary.totalDeletions} deletions`,
    };
  }

  /**
   * Get formatted diffs for terminal display
   */
  getTerminalDiffs(proposalId: string): string[] {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    return proposal.changes.map((change) =>
      this.diffBuilder.formatForTerminal(change.diff)
    );
  }

  /**
   * Delete a proposal
   */
  deleteProposal(proposalId: string): boolean {
    return this.proposals.delete(proposalId);
  }

  /**
   * Clear all proposals
   */
  clearProposals(): void {
    this.proposals.clear();
  }

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
  } {
    const proposals = Array.from(this.proposals.values());

    return {
      total: proposals.length,
      pending: proposals.filter((p) => p.status === ProposalStatus.PENDING).length,
      approved: proposals.filter((p) => p.status === ProposalStatus.APPROVED).length,
      rejected: proposals.filter((p) => p.status === ProposalStatus.REJECTED).length,
      applied: proposals.filter((p) => p.status === ProposalStatus.APPLIED).length,
      failed: proposals.filter((p) => p.status === ProposalStatus.FAILED).length,
    };
  }
}
