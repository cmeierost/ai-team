import {
  Token,
  type IContextBuilder,
  type IContextCompressor,
  type IContextEnricher,
  type ILlmSelector,
  type IMcpGateway,
  type IModelDiscoveryRegistry,
  type ILlmProviderTester,
  type IOrchestratorHookPlugin,
  type IOutputHandler,
  type IPathPermissionChecker,
  type IRagProvider,
  type IToolResolver,
  type ITurnResultParser,
} from './runtime-contracts.js';
import type { ICommand } from './command-types.js';
import type { IQuestionService, IEmitService } from './interaction-services.js';
import type {
  IAgentDocumentStorage,
  IConfigurationStorage,
  IMarkdownSectionService,
  IWorkspaceStorage,
  IPermissionStorage,
} from './communication.js';
import type { IDeveloperIdentityService, ISystemInfoService } from './platform-services.js';
import type {
  IFileAnnotationService,
  IFileTreeService,
  IIdeAdapterFactory,
  IWorkspaceAccessRuntime,
  IWorkspaceFsFactory,
} from '../context/index.js';
import type { IAgentManager } from '../agent/agent-manager.js';
import type { IAvatarManager } from '../agent/avatar.js';
import type { ITeamGraphBuilder } from '../agent/team-graph-builder.js';
import type { ICodeEditManager } from '../code-edit/code-edit-manager.js';
import type { ITypeScriptAnalyzer } from '../code-analysis/typescript-analyzer.js';
import type { ISkillManager } from '../skill/index.js';
import type { ILlmService, ITextToolCallParser } from '../llm/index.js';
import type { ILlmSettingsResolver } from '../llm/settings.js';
import type { IProviderConfigurationService } from '../llm/provider-configuration.service.js';
import type { IMessagesRepository } from '../repositories/messages-repository.js';
import type { INotesRepository, INoteAttachmentReader } from '../repositories/notes-repository.js';
import type { ISessionsRepository } from '../repositories/sessions-repository.js';
import type { IPlanningRepository } from '../repositories/planning-repository.js';
import type { IChatStorage } from '../chat/chat-storage.js';
import type { IChatManager } from '../chat/chat-context-manager.js';
import type { IProposalStoreFactory } from '../storage/contracts.js';

/**
 * Canonical token set for interface-backed services shared across packages.
 *
 * Non-interface or package-local runtime tokens should be defined outside core.
 */
export const CORE_SERVICE_TOKENS = {
  WorkspaceRoot: new Token<string>('WorkspaceRoot'),

  MessagesRepository: new Token<IMessagesRepository>('MessagesRepository'),
  SessionsRepository: new Token<ISessionsRepository>('SessionsRepository'),
  NotesRepository: new Token<INotesRepository>('NotesRepository'),
  PlanningRepository: new Token<IPlanningRepository>('PlanningRepository'),

  LlmService: new Token<ILlmService>('LlmService'),
  AgentManager: new Token<IAgentManager>('AgentManager'),
  AgentDocumentStorage: new Token<IAgentDocumentStorage>('AgentDocumentStorage'),
  AvatarManager: new Token<IAvatarManager>('AvatarManager'),
  CodeEditManager: new Token<ICodeEditManager>('CodeEditManager'),
  TypeScriptAnalyzer: new Token<ITypeScriptAnalyzer>('TypeScriptAnalyzer'),
  SkillManager: new Token<ISkillManager>('SkillManager'),
  QuestionService: new Token<IQuestionService>('QuestionService'),
  EmitService: new Token<IEmitService>('EmitService'),
  ChatStorage: new Token<IChatStorage>('ChatStorage'),
  ChatManager: new Token<IChatManager>('ChatManager'),

  ConfigurationStorage: new Token<IConfigurationStorage>('ConfigurationStorage'),
  DeveloperIdentityService: new Token<IDeveloperIdentityService>(
    'DeveloperIdentityService'
  ),
  SystemInfoService: new Token<ISystemInfoService>('SystemInfoService'),
  PermissionStorage: new Token<IPermissionStorage>('PermissionStorage'),
  MarkdownSectionService: new Token<IMarkdownSectionService>('MarkdownSectionService'),
  PathPermissionChecker: new Token<IPathPermissionChecker>('PathPermissionChecker'),
  WorkspaceStorage: new Token<IWorkspaceStorage>('WorkspaceStorage'),
  FileTreeService: new Token<IFileTreeService>('FileTreeService'),
  FileAnnotationService: new Token<IFileAnnotationService>('FileAnnotationService'),
  IdeAdapterFactory: new Token<IIdeAdapterFactory>('IdeAdapterFactory'),
  WorkspaceAccessRuntime: new Token<IWorkspaceAccessRuntime>('WorkspaceAccessRuntime'),
  WorkspaceFsFactory: new Token<IWorkspaceFsFactory>('WorkspaceFsFactory'),
  NoteAttachmentReader: new Token<INoteAttachmentReader>('NoteAttachmentReader'),
  ProposalStoreFactory: new Token<IProposalStoreFactory>('ProposalStoreFactory'),
  TextToolCallParser: new Token<ITextToolCallParser>('TextToolCallParser'),

  ModelDiscoveryRegistry: new Token<IModelDiscoveryRegistry>('ModelDiscoveryRegistry'),
  LlmProviderTester: new Token<ILlmProviderTester>('LlmProviderTester'),
  ProviderConfigurationService: new Token<IProviderConfigurationService>(
    'ProviderConfigurationService'
  ),
  LlmSettingsResolver: new Token<ILlmSettingsResolver>('LlmSettingsResolver'),
  TeamGraphBuilder: new Token<ITeamGraphBuilder>('TeamGraphBuilder'),

  ContextCompressor: new Token<IContextCompressor>('IContextCompressor'),
  ContextBuilder: new Token<IContextBuilder>('IContextBuilder'),
  ContextEnrichers: new Token<IContextEnricher[]>('IContextEnricher[]'),
  RagProvider: new Token<IRagProvider>('IRagProvider'),
  ToolResolver: new Token<IToolResolver>('IToolResolver'),
  McpGateway: new Token<IMcpGateway>('McpGateway'),
  LlmSelector: new Token<ILlmSelector>('LlmSelector'),
  OutputHandler: new Token<IOutputHandler>('OutputHandler'),
  SlashCommands: new Token<ICommand[]>('ICommand[]'),
  TurnResultParsers: new Token<ITurnResultParser[]>('ITurnResultParser[]'),
  HookPlugins: new Token<IOrchestratorHookPlugin[]>('IOrchestratorHookPlugin[]'),
} as const;

export type CoreServiceRegistrationTokens = typeof CORE_SERVICE_TOKENS;
