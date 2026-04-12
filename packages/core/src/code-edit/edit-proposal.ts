import { z } from 'zod';

/**
 * Minimal diff shape used for proposal validation/summaries.
 * Kept in core so proposal types remain infrastructure-agnostic.
 */
export interface ProposalDiffSummary {
  additions: number;
  deletions: number;
}

/**
 * Status of a code edit proposal
 */
export enum ProposalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  APPLIED = 'applied',
  FAILED = 'failed',
}

/**
 * A single file change in an edit proposal
 */
export interface FileChange {
  filePath: string;
  oldContent: string;
  newContent: string;
  diff: ProposalDiffSummary;
}

/**
 * A code edit proposal from an AI agent
 */
export interface CodeEditProposal {
  /** Unique identifier */
  id: string;
  /** Agent that created the proposal */
  agentName: string;
  /** Timestamp when created */
  timestamp: Date;
  /** Human-readable description of the changes */
  description: string;
  /** Files to be modified */
  changes: FileChange[];
  /** Current status */
  status: ProposalStatus;
  /** Reason for rejection (if rejected) */
  rejectionReason?: string;
  /** Error message (if failed to apply) */
  errorMessage?: string;
}

/**
 * Zod schema for validating edit proposals from LLMs
 */
export const FileChangeSchema = z.object({
  filePath: z.string().min(1, 'File path is required'),
  oldContent: z.string(),
  newContent: z.string(),
});

export const CodeEditProposalInputSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  changes: z.array(FileChangeSchema).min(1, 'At least one file change is required'),
});

export type CodeEditProposalInput = z.infer<typeof CodeEditProposalInputSchema>;

/**
 * Options for creating an edit proposal
 */
export interface CreateProposalOptions {
  /** Validate file permissions before creating proposal */
  checkPermissions?: boolean;
  /** Validate that files exist before creating proposal */
  checkFilesExist?: boolean;
  /** Maximum number of files that can be changed in one proposal */
  maxFiles?: number;
  /** Maximum diff size (lines) per file */
  maxDiffLines?: number;
}

/**
 * Validation result for an edit proposal
 */
export interface ProposalValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates code edit proposals
 */
export interface IProposalValidator {
  /**
   * Validate a proposal input from LLM
   */
  validateInput(input: unknown): ProposalValidationResult;

  /**
   * Validate proposal constraints
   */
  validateConstraints(
    proposal: CodeEditProposal,
    options: CreateProposalOptions
  ): ProposalValidationResult;
  validateConstraints(proposal: CodeEditProposal): ProposalValidationResult;

  /**
   * Check if file paths are safe (no path traversal, etc.)
   */
  validateFilePaths(filePaths: string[]): ProposalValidationResult;
}
