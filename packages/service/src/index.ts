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
  toServiceDomainError,
  type ServiceErrorCode,
  type ServiceErrorInputRequest,
} from './errors.js';
export { SessionManager } from './session-manager.js';
export { findWorkspaceRoot } from './utils/workspace.js';
export { type ChatRuntimeHooks } from './orchestrator/hooks.js';
export type { IQuestionService } from './questions/question-service.js';
export type { IEmitService, ChatCommandEmitter } from '@ai-team/core';
export {
  getEffectiveContextWindow,
  resolveEffectiveLlmSettings,
  resolveSystemLlmSettings,
} from './llm/settings.js';
export { WsQuestionService } from './questions/ws-question-service.js';
export { EmitService } from './orchestrator/services/emit-service.js';
export { serveApiCommand, type ServeApiOptions } from './commands/start/serve.js';
export { runUiCommand, type UiCommandOptions } from './commands/start/ui.js';
export { COMMAND_FACTORY_TOKENS } from './types.js';

// Interaction service (streaming interface for transports)
export { InteractionService, type IInteractionService } from './interaction-service.js';
export { InteractionStream } from './interaction-stream.js';
export { runtimeEventToStreamEvent } from './runtime-event-translator.js';
export { parseStreamPerfEnv, createStreamPerfTracker } from './stream-perf.js';
export {
  writeBackendDebugLog,
  setBackendDebugLogSettingsResolver,
  type BackendDebugLogSettingsResolver,
  type DebugLogSettings,
} from './utils/debug-log.js';
export { createDebugLogWriter, formatDebugLogForConsole } from './utils/debug-log-shared.js';

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
export { ToolDispatchSupportService } from './orchestrator/services/tool-dispatch-support-service.js';
export { ToolSerializationService } from './orchestrator/services/tool-serialization-service.js';
export {
  getWorkflowDefinitionResolvers,
  listWorkflowDefinitionIds,
  type WorkflowDefinitionResolver,
} from './workflow/definition-catalog.js';
export {
  WorkflowV2Runner,
  ChatLoopEngineV2,
  WorkflowV2AbortError,
  type ChatLoopV2EngineOptions,
  type ChatLoopV2FailureInput,
  type ChatLoopV2HandoffTransitionResult,
  type ChatLoopV2Input,
  type ChatLoopV2Output,
  type ChatLoopV2PostTurnResolutionResult,
  type ChatLoopV2PreturnResult,
  type ChatLoopV2SendTurnResult,
  type ChatLoopV2ToolCall,
  type ChatLoopV2ToolRoundResult,
  ChatRuntimeV2,
  type ChatRuntimeV2RunInput,
  type ChatRuntimeV2TurnInput,
  type ChatRuntimeV2TurnResult,
  type IChatRuntimeV2,
  type IChatRuntimeV2Dependencies,
  WorkflowV2PreTurnIntentResolver,
  type IWorkflowV2ToolSource,
  type WorkflowV2AskChoice,
  type WorkflowV2AskSpec,
  type WorkflowV2IntentProvider,
  type WorkflowV2PreTurnIntent,
  type WorkflowV2PreTurnIntentResolverOptions,
  type WorkflowV2ScoredIntentCandidate,
  type IWorkflowV2Runner,
  type IChatLoopV2Services,
  type WorkflowV2RunnerOptions,
  type WorkflowV2Definition,
  type WorkflowV2RunOptions,
  type WorkflowV2RunResult,
  type WorkflowV2Step,
  type WorkflowV2StepFrame,
  type WorkflowV2StepPhase,
} from './workflow-v2/index.js';
export { ChatCommand } from './commands/chat/chat.command.js';

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
export { ChatV2Command, type ChatV2Params } from './commands/chat/chat-v2.command.js';
export {
  registerServiceLayerServices,
  buildInteractionService,
  type ServiceLayerRegistrationTokens,
  type ServiceLayerRegistrationConfig,
} from './registration/register-service-layer-services.js';
