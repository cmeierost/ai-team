/**
 * @ai-team/core - Public API exports
 *
 * This is the main entry point for the core library.
 * Types and interfaces are exported from here.
 */

// Type definitions and schemas only
export * from './types/index.js';
export {
  ApplicationError,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  InternalError,
} from './errors/application-errors.js';
export * from './repositories/index.js';
export * from './storage/index.js';
export { IAvatarManager } from './agent/avatar.js';
export { ITeamGraphBuilder } from './agent/team-graph-builder.js';
export type {
  ILlmService,
  ITextToolCallParser,
  LlmDiagnosticMessage,
  LlmDiagnosticReporter,
  LlmChatOptions,
} from './llm/index.js';
export {
  resolveEffectiveLlmSettings,
  resolveSystemLlmSettings,
  getEffectiveContextWindow,
  type ResolvedLlmSettings,
} from './llm/settings.js';
export type {
  CliCommandMetadata,
  CommandOptionMetadata,
  CommandArgumentMetadata,
} from './command-catalog/index.js';
export type {
  AnnotatedFile,
  FileTreeNode,
  GetFileTreeOptions,
  IFileTreeService,
  IFileAnnotationService,
  IIdeAdapterFactory,
  IWorkspaceAccessRuntime,
  IWorkspaceFs,
  IWorkspaceFsFactory,
} from './context/index.js';
export {
  checkPathRight,
  resolveWorkspacePathMeta,
  type WorkspacePathMeta,
} from './context/index.js';
export type { IProposalStoreFactory } from './storage/index.js';
export type { ITypeScriptAnalyzer } from './code-analysis/typescript-analyzer.js';
export type { INoteAttachmentReader } from './repositories/notes-repository.js';
export type {
  ISkillManager,
  ResolvedAgentSkills,
  SessionSkillRecord,
  ResolvedSessionSkillsResult,
} from './skill/index.js';
export type { IChatManager, IChatStorage } from './chat/index.js';
export { ProposalStatus } from './code-edit/edit-proposal.js';
export type { ICodeEditManager } from './code-edit/code-edit-manager.js';
export type { CodeEditProposal, FileChange } from './code-edit/edit-proposal.js';
