import { CoreAiTeamService } from './core-service.js';
import type { AiTeamService } from './contracts.js';

export {
  CLI_COMMAND_REGISTRY,
  IN_CHAT_COMMAND_ALIASES,
  IN_CHAT_COMMAND_REGISTRY,
  getCliCommandMetadata,
  getLlmCallableCliCommands,
} from './command-registry.js';
export type { ChatCommandRegistryEntry } from './command-registry.js';

export function createAiTeamService(workspaceRoot: string): AiTeamService {
  return new CoreAiTeamService(workspaceRoot);
}

export type {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  AiTeamMediator,
  AiTeamService,
  ChatOptions,
  AddProviderOptions,
  ConfigureProviderOptions,
  CreateAgentSetupInput,
  CreateOptions,
  CreateSetupInput,
  CreateSkillSetupInput,
  Employee,
  FireOptions,
  HireOptions,
  InitOptions,
  ListEmployeesRequest,
  MediatorContext,
  MediatorEvent,
  MediatorRuntimeEvent,
  MediatorRequest,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionRequest,
  QuestionSelectChoice,
  QuestionSelectRequest,
  QuestionWorkflowMetadata,
  ProviderSetupInput,
  ProviderListOptions,
  SearchSkillsOptions,
  SearchSkillsResponse,
  ListToolsOptions,
  ListToolsResponse,
  SetProviderOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  UpdateAgentSkillOptions,
  UpdateAgentSkillResponse,
  UpdateAgentToolOptions,
  UpdateAgentToolResponse,
  PathMode,
  FilePatternCollections,
  GetFilePatternsResponse,
  UpdateGlobalPathOptions,
  UpdateGlobalPathResponse,
  UpdateAgentPathOptions,
  UpdateAgentPathResponse,
  SearchAgentsRequest,
  SearchAgentsResponse,
  WorkflowFrame,
  WorkflowStateSnapshot,
  TestConnectionOptions,
  GovernanceMutationOptions,
  FilePermission,
  WhoHasPermissionOptions,
  WhoHasPermissionResponse,
  DoIHavePermissionOptions,
  DoIHavePermissionResponse,
} from './contracts.js';

export { ServiceDomainError, AmbiguousAgentQueryError, type ServiceErrorCode, type ServiceErrorInputRequest } from './errors.js';
export { MissingUserInputError } from './utils/user-env.js';
export { SessionManager } from './session-manager.js';
export { TaskManager, type TaskFilter } from './task-manager.js';
export { resolveAgentForOperation, resolveAgentSafe } from './utils/agent-resolution.js';
export { findWorkspaceRoot } from './utils/workspace.js';
export { getSystemInfo, type SystemInfo } from './utils/system-info.js';
export {
  getFileTreeCommand,
  allowPathCommand,
  disallowPathCommand,
  agentPermissionPathCommand,
  agentDisallowPathCommand,
  permissionAllowCommand,
  permissionDenyCommand,
  type AgentPathResult,
} from './commands/file-tree.js';

export { generateIntroduction } from './orchestrator/introduction.js';
export { generateDefaultHandoffPrompt } from './orchestrator/generate-handoff-prompt.js';
export { serveApiCommand, type ServeApiOptions } from './commands/serve.js';
export { runUiCommand, type UiCommandOptions } from './commands/ui.js';

// Storage abstraction layer
export {
  type IMessageStorage,
  type MessageFilter,
  type SessionFilter,
  type StorageStats,
  type MessageInsertResult,
  type MessageStorageFactory,
  SqliteMessageStorage,
  SqliteConnection,
  MigrationManager,
  createSqliteStorage,
} from './storage/index.js';
export { ProposalStore, type StoredProposal, type StoredProposalFile } from './storage/proposal-store.js';
