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
export { findWorkspaceRoot } from './utils/workspace.js';
export { type ChatRuntimeHooks } from './commands/chat/index.js';
export { type IInteractionService as IQuestionService } from './questions/question-service.js';
export { WsQuestionService } from './questions/ws-question-service.js';
export { serveApiCommand, type ServeApiOptions } from './commands/start/serve.js';
export { runUiCommand, type UiCommandOptions } from './commands/start/ui.js';
export {
  COMMAND_FACTORY_TOKENS,
} from './types.js';

// Interaction service (streaming interface for transports)
export { InteractionService, type IInteractionService } from './interaction-service.js';

// Command dispatcher (unified command dispatch for CLI + chat + tools)
export { CommandDispatcher, createCommandDispatcher } from './command-dispatcher.js';

// Command registry utilities
export { deriveRegistryKey } from './command-registry-impl.js';
export { GROUP_REGISTRY, type GroupInfo } from './commands/groups.js';

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

export { createToolManager } from './tools/create-tool-manager.js';
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
export { SlashCommandDispatcher } from './orchestrator/slash-command-dispatcher.js';
export { ToolDispatchSupportService } from './orchestrator/services/tool-dispatch-support-service.js';
export { ToolSerializationService } from './orchestrator/services/tool-serialization-service.js';
export {
  getWorkflowDefinitionResolvers,
  listWorkflowDefinitionIds,
  type WorkflowDefinitionResolver,
} from './workflow/definition-catalog.js';

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
export {
  registerServiceLayerServices,
  buildInteractionService,
  type ServiceLayerRegistrationTokens,
  type ServiceLayerRegistrationConfig,
} from './registration/register-service-layer-services.js';
