export {
  ApplicationError,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  InternalError,
} from '@ai-team/core';
export type { ChatCommandRegistryEntry } from '@ai-team/api-contracts';
export { IN_CHAT_COMMAND_ALIASES, IN_CHAT_COMMAND_REGISTRY } from './command-registry.js';

export {
  ServiceDomainError,
  AmbiguousAgentQueryError,
  type ServiceErrorCode,
  type ServiceErrorInputRequest,
} from './errors.js';
export { MissingUserInputError } from './utils/user-env.js';
export { SessionManager } from './session-manager.js';
export { TaskManager, type TaskFilter } from './task-manager.js';
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
} from './commands/fs/file-tree.js';

export { generateIntroduction } from './orchestrator/introduction.js';
export { generateDefaultHandoffPrompt } from './orchestrator/generate-handoff-prompt.js';
export { type ChatRuntimeHooks } from './commands/chat/index.js';
export { serveApiCommand, type ServeApiOptions } from './commands/start/serve.js';
export { runUiCommand, type UiCommandOptions } from './commands/start/ui.js';
export {
  COMMAND_FACTORY_TOKENS,
  COMMAND_DEFINITION_REGISTRY_TOKEN,
  createCommandDefinitionRegistry,
  type AnyCommandDefinition,
  type CommandDefinition,
  type CommandDefinitionRegistry,
  type CommandDefinitionSet,
} from './commands/definitions/types.js';

// Interaction service (streaming interface for transports)
export { InteractionService, type IInteractionService } from './interaction-service.js';

// Command dispatcher (unified command dispatch for CLI + chat + tools)
export { CommandDispatcher, createCommandDispatcher } from './command-dispatcher.js';

// Storage abstraction layer
export type {
  IPlanningStorage,
  IProposalStore,
  IProposalStoreFactory,
  MessageFilter,
  SessionFilter,
  StorageStats,
  MessageInsertResult,
  StoredProposal,
  StoredProposalFile,
} from '@ai-team/core';
export type { AgentFilesResponse } from '@ai-team/api-contracts';

export { createToolManager, type OrchestrationDeps } from './tools/create-tool-manager.js';
export { ToolManager } from './tools/tool-manager.js';
export type {
  LlmToolDefinition,
  ToolExecutionResult as ToolManagerExecutionResult,
  ToolExecutionOptions as ToolManagerExecutionOptions,
} from './tools/tool-manager.js';
export { type ResolvedPlugins } from './orchestrator/pipeline.js';
export type {
  IContextBuilder,
  IContextCompressor,
  IContextEnricher,
  ILlmSelector,
  IMcpGateway,
  IOrchestratorHookPlugin,
  IOutputHandler,
  IRagProvider,
  ISlashCommand,
  IToolResolver,
  ITurnResultParser,
} from '@ai-team/core';
export { NoOpCompressor } from './orchestrator/defaults/context-compressor.js';
export { DefaultContextBuilder } from './orchestrator/defaults/context-builder.js';
export {
  WorkspaceOverviewEnricher,
  TeamRosterEnricher,
} from './orchestrator/defaults/context-enrichers.js';
export { NoOpRagProvider } from './orchestrator/defaults/rag-provider.js';
export { DefaultToolResolver } from './orchestrator/defaults/tool-resolver.js';
export { NoOpMcpGateway } from './orchestrator/defaults/mcp-gateway.js';
export { DefaultLlmSelector } from './orchestrator/defaults/llm-selector.js';
export { DefaultOutputHandler } from './orchestrator/defaults/output-handler.js';
export { buildDefaultHookPlugins } from './orchestrator/defaults/hook-plugins.js';
export { buildDefaultTurnResultParsers } from './orchestrator/defaults/turn-result-parsers.js';
export { buildDefaultSlashCommands } from './orchestrator/slash-commands.js';

export {
  CommandsService,
  SystemService,
  DeveloperService,
  MetaService,
  TeamService,
  SkillsService,
  ToolsService,
  AccessService,
  ConfigService,
  FilesService,
  AgentsService,
  TasksService,
  PlanningService,
  ArtifactsService,
  ChatService,
  SessionsService,
  IdeService,
} from './routers/index.js';
