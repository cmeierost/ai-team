export {
  TreeSitterManager,
  type LanguageConfig,
  DEFAULT_LANGUAGE_CONFIGS,
} from './tree-sitter-manager.js';
export {
  DiffBuilder,
  type DiffHunk,
  type StructuredDiff,
  type DiffOptions,
} from './diff-builder.js';
export {
  type CodeEditProposal,
  type FileChange,
  type CodeEditProposalInput,
  type CreateProposalOptions,
  type ProposalValidationResult,
  ProposalStatus,
  ProposalValidator,
  CodeEditProposalInputSchema,
  generateProposalId,
  summarizeProposal,
} from './edit-proposal.js';
export { CodeEditManager } from './code-edit-manager.js';
