export {
  type ITreeSitterManager,
  type LanguageConfig,
  DEFAULT_LANGUAGE_CONFIGS,
} from './tree-sitter-manager.js';
export {
  type IDiffBuilder,
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
  type ProposalStatus,
  type IProposalValidator,
  CodeEditProposalInputSchema,
} from './edit-proposal.js';
export { type ICodeEditManager } from './code-edit-manager.js';
