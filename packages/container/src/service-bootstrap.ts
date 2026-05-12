import type {
  ContainerTokenValueMap,
  IAvatarManager,
  IAgentDocumentStorage,
  IAgentManager,
  ICodeEditManager,
  IConfigurationStorage,
  IContainerToken,
  IContextBuilder,
  IContextCompressor,
  IContextEnricher,
  IDeveloperIdentityService,
  IEnvironmentStorage,
  IFileAnnotationService,
  IFileTreeService,
  ITypeScriptAnalyzer,
  ILlmSelector,
  IMarkdownSectionService,
  IMcpGateway,
  IModelDiscoveryRegistry,
  ILlmProviderTester,
  IOrchestratorHookPlugin,
  IOutputHandler,
  IPathPermissionChecker,
  IPermissionStorage,
  ICommand,
  IRagProvider,
  ISkillManager,
  ITeamGraphBuilder,
  IToolResolver,
  ITurnResultParser,
  IWorkspaceStorage,
  IServiceContainerRegistrar,
  IIdeAdapterFactory,
  IWorkspaceAccessRuntime,
  IWorkspaceFsFactory,
  ISystemInfoService,
  INoteAttachmentReader,
  ITextToolCallParser,
  IProposalStoreFactory,
  CliCommandMetadata,
} from '@ai-team/core';
import { createBootstrappedContainer, type ContainerBootstrapper } from './bootstrap.js';
import type { MergeTokenSets, ServiceContainer, TokenSet } from './container.js';
import {
  registerInfrastructureCoreServices,
  type InfrastructureCoreRegistrationTokens,
  ContextRuntime,
  type SqliteBackend,
  type MessagesRepository,
  type SessionsRepository,
  type NotesRepository,
  type PlanningRepository,
  type LlmService,
  type ChatStorage,
  type ChatManager,
} from '@ai-team/infrastructure';

import {
  type ToolManager,
  type SessionManager,
  type IInteractionService,
  type SystemService,
  type AgentsService,
  type TeamService,
  type ChatService,
  type SessionsService,
  type ArtifactsService,
  type TasksService,
  type PlanningService,
  type DeveloperService,
  type FilesService,
  type IdeService,
  type SkillsService,
  type ToolsService,
  type ConfigService,
  type MetaService,
  type CommandsService,
  type AccessService,
  registerServiceLayerServices,
  type ServiceLayerRegistrationTokens,
} from '@ai-team/service';
import { Token } from './token.js';

export const SERVERTokens = {} as const;

export const EXCHANGABLE_TOKENS = {} as const;

export const TOKENS = {
  // ── Exchangable ───────────────────────────────────────────────────────
  ApiBaseUrl: new Token<string>('ApiBaseUrl'),
  InteractionService: new Token<IInteractionService>('IInteractionService'),

  // ── Core infrastructure ─────────────────────────────────────────────────
  WorkspaceRoot: new Token<string>('WorkspaceRoot'),
  SqliteBackend: new Token<SqliteBackend>('SqliteBackend'),
  MessagesRepository: new Token<MessagesRepository>('MessagesRepository'),
  SessionsRepository: new Token<SessionsRepository>('SessionsRepository'),
  NotesRepository: new Token<NotesRepository>('NotesRepository'),
  PlanningRepository: new Token<PlanningRepository>('PlanningRepository'),
  LlmService: new Token<LlmService>('LlmService'),
  AgentManager: new Token<IAgentManager>('AgentManager'),
  AgentDocumentStorage: new Token<IAgentDocumentStorage>('AgentDocumentStorage'),
  AvatarManager: new Token<IAvatarManager>('AvatarManager'),
  CodeEditManager: new Token<ICodeEditManager>('CodeEditManager'),
  TypeScriptAnalyzer: new Token<ITypeScriptAnalyzer>('TypeScriptAnalyzer'),
  SkillManager: new Token<ISkillManager>('SkillManager'),
  SessionManager: new Token<SessionManager>('SessionManager'),
  ToolManager: new Token<ToolManager>('ToolManager'),
  ChatStorage: new Token<ChatStorage>('ChatStorage'),
  ChatManager: new Token<ChatManager>('ChatManager'),

  // ── Storage interfaces (shared singletons) ───────────────────────────────
  ConfigurationStorage: new Token<IConfigurationStorage>('ConfigurationStorage'),
  EnvironmentStorage: new Token<IEnvironmentStorage>('EnvironmentStorage'),
  DeveloperIdentityService: new Token<IDeveloperIdentityService>('DeveloperIdentityService'),
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

  // ── Model discovery ──────────────────────────────────────────────────────
  ModelDiscoveryRegistry: new Token<IModelDiscoveryRegistry>('ModelDiscoveryRegistry'),
  LlmProviderTester: new Token<ILlmProviderTester>('LlmProviderTester'),
  TeamGraphBuilder: new Token<ITeamGraphBuilder>('TeamGraphBuilder'),

  // ── HTTP route services ──────────────────────────────────────────────────

  SystemService: new Token<SystemService>('SystemService'),
  AgentsService: new Token<AgentsService>('AgentsService'),
  TeamService: new Token<TeamService>('TeamService'),
  ChatService: new Token<ChatService>('ChatService'),
  SessionsService: new Token<SessionsService>('SessionsService'),
  ArtifactsService: new Token<ArtifactsService>('ArtifactsService'),
  TasksService: new Token<TasksService>('TasksService'),
  PlanningService: new Token<PlanningService>('PlanningService'),
  DeveloperService: new Token<DeveloperService>('DeveloperService'),
  FilesService: new Token<FilesService>('FilesService'),
  IdeService: new Token<IdeService>('IdeService'),
  SkillsService: new Token<SkillsService>('SkillsService'),
  ToolsService: new Token<ToolsService>('ToolsService'),
  ConfigService: new Token<ConfigService>('ConfigService'),
  MetaService: new Token<MetaService>('MetaService'),
  CommandsService: new Token<CommandsService>('CommandsService'),
  AccessService: new Token<AccessService>('AccessService'),
  ContextRuntime: new Token<ContextRuntime>('ContextRuntime'),

  // ── Pipeline plugins — all override-able before first resolve ───────────
  ContextCompressor: new Token<IContextCompressor>('IContextCompressor'),
  ContextBuilder: new Token<IContextBuilder>('IContextBuilder'),
  /** Array of enrichers; resolved as a single Token to keep ordering explicit. */
  ContextEnrichers: new Token<IContextEnricher[]>('IContextEnricher[]'),
  RagProvider: new Token<IRagProvider>('IRagProvider'),
  ToolResolver: new Token<IToolResolver>('IToolResolver'),
  McpGateway: new Token<IMcpGateway>('IMcpGateway'),
  LlmSelector: new Token<ILlmSelector>('ILlmSelector'),
  OutputHandler: new Token<IOutputHandler>('IOutputHandler'),
  /** Array of slash commands; each command registers itself. */
  SlashCommands: new Token<ICommand[]>('ICommand[]'),
  /** Ordered array of turn-result parsers; first non-null return wins. */
  TurnResultParsers: new Token<ITurnResultParser[]>('ITurnResultParser[]'),
  /** Ordered array of hook plugins; each plugin may implement multiple hooks. */
  HookPlugins: new Token<IOrchestratorHookPlugin[]>('IOrchestratorHookPlugin[]'),
} as const;

export const COMMAND_METADATA_BY_KEY = new Token<Map<string, CliCommandMetadata>>(
  'CommandMetadataByKey'
);

export type ServiceBootstrapTypes = ContainerTokenValueMap<typeof TOKENS>;

export interface ServiceBootstrapConfig {
  workspaceRoot: string;
  apiBaseUrl?: string;
}

export type ServiceBootstrapTokens<T extends ServiceBootstrapTypes = ServiceBootstrapTypes> = {
  [K in keyof T]: IContainerToken<T[K]>;
};

export type ExtendedServiceContainer<TSets extends readonly TokenSet[]> = ServiceContainer<
  ServiceBootstrapTypes & MergeTokenSets<TSets>
>;

function registerBaseServices(
  c: ServiceContainer<ServiceBootstrapTypes>,
  cfg: ServiceBootstrapConfig,
  tokens: ServiceBootstrapTokens<ServiceBootstrapTypes>
): void {
  c.registerSingleton(tokens.ApiBaseUrl, () => cfg.apiBaseUrl ?? 'http://localhost:3002');
  c.registerInstance(tokens.WorkspaceRoot, cfg.workspaceRoot);

  registerInfrastructureCoreServices(
    c as unknown as IServiceContainerRegistrar,
    tokens as unknown as InfrastructureCoreRegistrationTokens
  );

  c.registerSingleton(tokens.ContextRuntime, () => new ContextRuntime());

  registerServiceLayerServices(
    c as unknown as IServiceContainerRegistrar,
    cfg,
    tokens as unknown as ServiceLayerRegistrationTokens
  );
}

export function createContainer(
  config: ServiceBootstrapConfig
): ServiceContainer<ServiceBootstrapTypes>;
export function createContainer<const TSets extends readonly TokenSet[]>(
  config: ServiceBootstrapConfig,
  bootstrap: ContainerBootstrapper<
    ServiceBootstrapConfig,
    ServiceBootstrapTypes & MergeTokenSets<TSets>
  >,
  ...tokenSets: TSets
): ServiceContainer<ServiceBootstrapTypes & MergeTokenSets<TSets>>;
export function createContainer<const TSets extends readonly TokenSet[]>(
  config: ServiceBootstrapConfig,
  bootstrap?: ContainerBootstrapper<
    ServiceBootstrapConfig,
    ServiceBootstrapTypes & MergeTokenSets<TSets>
  >,
  ...tokenSets: TSets
): ServiceContainer<ServiceBootstrapTypes | (ServiceBootstrapTypes & MergeTokenSets<TSets>)> {
  const tokens = TOKENS as unknown as ServiceBootstrapTokens<ServiceBootstrapTypes>;

  const container = createBootstrappedContainer(
    config,
    (c, cfg) => {
      registerBaseServices(c as unknown as ServiceContainer<ServiceBootstrapTypes>, cfg, tokens);
      if (bootstrap) {
        bootstrap(c as unknown as ExtendedServiceContainer<TSets>, cfg);
      }
    },
    TOKENS,
    ...tokenSets
  ) as unknown as ServiceContainer<ServiceBootstrapTypes & MergeTokenSets<TSets>>;

  return container as unknown as ServiceContainer<
    ServiceBootstrapTypes | (ServiceBootstrapTypes & MergeTokenSets<TSets>)
  >;
}

export function createContainerWithTokenSets<const TSets extends readonly TokenSet[]>(
  config: ServiceBootstrapConfig,
  ...tokenSets: TSets
): ExtendedServiceContainer<TSets> {
  return createContainer(
    config,
    () => {},
    ...tokenSets
  ) as unknown as ExtendedServiceContainer<TSets>;
}

export function createContainerWithBootstrap<const TSets extends readonly TokenSet[]>(
  config: ServiceBootstrapConfig,
  bootstrap: (container: ExtendedServiceContainer<TSets>) => void,
  ...tokenSets: TSets
): ExtendedServiceContainer<TSets> {
  const container = createContainerWithTokenSets(config, ...tokenSets);
  bootstrap(container);
  return container;
}
