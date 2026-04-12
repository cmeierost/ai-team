import { z } from 'zod';
import type { StructuredDiff } from './diff-builder.js';

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
  diff: StructuredDiff;
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
export class ProposalValidator {
  /**
   * Validate a proposal input from LLM
   */
  validateInput(input: unknown): ProposalValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      CodeEditProposalInputSchema.parse(input);
    } catch (error) {
      if (error instanceof z.ZodError) {
        errors.push(...error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`));
      } else {
        errors.push(`Validation error: ${error}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate proposal constraints
   */
  validateConstraints(
    proposal: CodeEditProposal,
    options: CreateProposalOptions = {}
  ): ProposalValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const { maxFiles = 10, maxDiffLines = 500 } = options;

    // Check number of files
    if (proposal.changes.length > maxFiles) {
      errors.push(
        `Too many files in proposal: ${proposal.changes.length} (max: ${maxFiles}). Consider splitting into multiple proposals.`
      );
    }

    // Check diff sizes
    for (const change of proposal.changes) {
      const totalLines = change.diff.additions + change.diff.deletions;
      if (totalLines > maxDiffLines) {
        warnings.push(
          `Large diff in ${change.filePath}: ${totalLines} lines (recommended max: ${maxDiffLines})`
        );
      }
    }

    // Check for suspicious patterns
    for (const change of proposal.changes) {
      // Warn if deleting more than 50% of file
      const oldLines = change.oldContent.split('\n').length;
      if (change.diff.deletions > oldLines * 0.5) {
        warnings.push(
          `Large deletion in ${change.filePath}: ${change.diff.deletions} lines removed (${((change.diff.deletions / oldLines) * 100).toFixed(0)}% of file)`
        );
      }

      // Warn if file becomes very large
      const newLines = change.newContent.split('\n').length;
      if (newLines > 1000) {
        warnings.push(
          `${change.filePath} will have ${newLines} lines after changes (consider refactoring)`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if file paths are safe (no path traversal, etc.)
   */
  validateFilePaths(filePaths: string[]): ProposalValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const filePath of filePaths) {
      // Check for path traversal attempts
      if (filePath.includes('..')) {
        errors.push(`Path traversal detected in: ${filePath}`);
      }

      // Check for absolute paths (should be relative to workspace)
      if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) {
        warnings.push(`Absolute path detected: ${filePath} (should be relative to workspace)`);
      }

      // Check for hidden files/directories
      const parts = filePath.split(/[\\/]/);
      if (parts.some((part) => part.startsWith('.'))) {
        warnings.push(`Hidden file/directory in path: ${filePath}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

/**
 * Generate a unique ID for a proposal
 */
export function generateProposalId(): string {
  return `edit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a human-readable summary of a proposal
 */
export function summarizeProposal(proposal: CodeEditProposal): string {
  const fileCount = proposal.changes.length;
  const totalAdditions = proposal.changes.reduce((sum, c) => sum + c.diff.additions, 0);
  const totalDeletions = proposal.changes.reduce((sum, c) => sum + c.diff.deletions, 0);

  const fileList = proposal.changes.map((c) => `  - ${c.filePath}`).join('\n');

  return `
Proposal ${proposal.id} (${proposal.status})
Agent: ${proposal.agentName}
Description: ${proposal.description}

Changes:
${fileList}

Summary: ${fileCount} file(s), +${totalAdditions} additions, -${totalDeletions} deletions
`.trim();
}
