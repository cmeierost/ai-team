import type {
  ContainerTokenValueMap,
  IAvatarManager,
  IAgentDocumentStorage,
  IAgentManager,
  IChatManager,
  ICodeEditManager,
  IConfigurationStorage,
  IContainerToken,
  IContextBuilder,
  IContextCompressor,
  IContextEnricher,
  IEnvironmentStorage,
  IFileAnnotationService,
  IFileTreeService,
  ITypeScriptAnalyzer,
  ILlmSelector,
  ILlmService,
  IMarkdownSectionService,
  IMcpGateway,
  IModelDiscoveryRegistry,
  ILlmProviderTester,
  IOrchestratorHookPlugin,
  IOutputHandler,
  IPathPermissionChecker,
  IPermissionStorage,
  IRagProvider,
  ISkillManager,
  ISlashCommand,
  ITeamGraphBuilder,
  IToolResolver,
  ITurnResultParser,
  IWorkspaceStorage,
  IServiceContainer,
  IIdeAdapterFactory,
  IWorkspaceAccessRuntime,
  IWorkspaceFsFactory,
  INoteAttachmentReader,
  ITextToolCallParser,
  IProposalStoreFactory,
} from '@ai-team/core';
import { createBootstrappedContainer, type ContainerBootstrapper } from './bootstrap.js';
import type { MergeTokenSets, ServiceContainer, TokenSet } from './container.js';
import {
  AgentDocumentStorage,
  AgentManager,
  AvatarManager,
  CodeEditManager,
  ConfigurationStorage,
  EnvironmentStorage,
  FileAnnotationServiceImpl,
  FileTreeServiceImpl,
  LlmService,
  MarkdownSectionService,
  createModelDiscoveryRegistry,
  LlmProviderTester,
  PermFileRegistry,
  SkillManager,
  WorkspaceDiscoveryStorage,
  WorkspaceStorage,
  ContextRuntime,
  ChatManager,
  ChatStorage,
  InfrastructureIdeAdapterFactory,
  InfrastructureProposalStoreFactory,
  InfrastructureWorkspaceAccessRuntime,
  InfrastructureWorkspaceFsFactory,
  InfrastructureTextToolCallParser,
  SqliteBackend,
  MessagesRepository,
  SessionsRepository,
  NotesRepository,
  PlanningRepository,
  PathPermissionChecker,
  TeamGraphBuilder,
  TypeScriptAnalyzer,
  NoteAttachmentReader,
  type CliCommandMetadata,
  type Agent,
} from '@ai-team/infrastructure';

import {
  ToolManager,
  SessionManager,
  createToolManager,
  type OrchestrationDeps,
  NoOpCompressor,
  DefaultContextBuilder,
  WorkspaceOverviewEnricher,
  TeamRosterEnricher,
  NoOpRagProvider,
  DefaultToolResolver,
  NoOpMcpGateway,
  DefaultLlmSelector,
  DefaultOutputHandler,
  buildDefaultHookPlugins,
  buildDefaultTurnResultParsers,
  buildDefaultSlashCommands,
  COMMAND_DEFINITION_REGISTRY_TOKEN,
  createCommandDefinitionRegistry,
  type IInteractionService,
  InteractionService,
  SystemService,
  AgentsService,
  TeamService,
  ChatService,
  SessionsService,
  ArtifactsService,
  TasksService,
  PlanningService,
  DeveloperService,
  FilesService,
  IdeService,
  SkillsService,
  ToolsService,
  ConfigService,
  MetaService,
  CommandsService,
  AccessService,
} from '@ai-team/service';
import { ChatCommand } from '@ai-team/service/src/commands/chat/index.js';
import { registerDefaultCommandDefinitions } from './command-definitions/index.js';
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
  SlashCommands: new Token<ISlashCommand[]>('ISlashCommand[]'),
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

  c.registerSingleton(
    tokens.SqliteBackend,
    (c) => new SqliteBackend(c.resolve(tokens.WorkspaceRoot))
  );
  c.registerSingleton(tokens.NotesRepository, (c) => {
    const b = c.resolve(tokens.SqliteBackend);
    return new NotesRepository(c.resolve(tokens.WorkspaceRoot), b.ensureReadyAsync, b.getDb);
  });
  c.registerSingleton(tokens.MessagesRepository, (c) => {
    const b = c.resolve(tokens.SqliteBackend);
    return new MessagesRepository(b.ensureReadyAsync, b.getDb);
  });
  c.registerSingleton(tokens.SessionsRepository, (c) => {
    const b = c.resolve(tokens.SqliteBackend);
    return new SessionsRepository(b.ensureReadyAsync, b.getDb, c.resolve(tokens.NotesRepository));
  });
  c.registerSingleton(tokens.PlanningRepository, (c) => {
    const b = c.resolve(tokens.SqliteBackend);
    return new PlanningRepository(b.ensureReadyAsync, b.getDb);
  });
  c.registerSingleton(
    tokens.LlmService,
    (c) =>
      new LlmService(
        c.resolve(tokens.WorkspaceRoot),
        new ConfigurationStorage(),
        new EnvironmentStorage()
      )
  );

  // ── Shared storage singletons ────────────────────────────────────────────
  c.registerSingleton(tokens.MarkdownSectionService, () => new MarkdownSectionService());
  c.registerSingleton(tokens.PathPermissionChecker, () => new PathPermissionChecker());
  c.registerSingleton(tokens.WorkspaceStorage, () => new WorkspaceStorage());
  c.registerSingleton(tokens.ConfigurationStorage, () => new ConfigurationStorage());
  c.registerSingleton(tokens.EnvironmentStorage, () => new EnvironmentStorage());
  c.registerSingleton(
    tokens.PermissionStorage,
    (c) => new PermFileRegistry(c.resolve(tokens.WorkspaceRoot))
  );
  c.registerSingleton(tokens.ModelDiscoveryRegistry, () => createModelDiscoveryRegistry());
  c.registerSingleton(
    tokens.LlmProviderTester,
    (c) => new LlmProviderTester(c.resolve(tokens.EnvironmentStorage))
  );

  c.registerSingleton(tokens.AgentDocumentStorage, (c) => {
    const workspaceStorage = c.resolve(tokens.WorkspaceStorage);
    const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();
    return new AgentDocumentStorage(
      c.resolve(tokens.MarkdownSectionService),
      workspaceStorage,
      workspaceDiscoveryStorage
    );
  });

  c.registerSingleton(tokens.AgentManager, (c) => {
    const agentDocumentStorage = c.resolve(tokens.AgentDocumentStorage);
    const workspaceStorage = c.resolve(tokens.WorkspaceStorage);
    const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();

    return new AgentManager(
      c.resolve(tokens.WorkspaceRoot),
      agentDocumentStorage,
      workspaceStorage,
      workspaceDiscoveryStorage,
      c.resolve(tokens.PermissionStorage)
    );
  });
  c.registerSingleton(
    tokens.AvatarManager,
    (c) => new AvatarManager(c.resolve(tokens.AgentDocumentStorage))
  );
  c.registerSingleton(tokens.CodeEditManager, () => new CodeEditManager());
  c.registerSingleton(tokens.TypeScriptAnalyzer, () => new TypeScriptAnalyzer());
  c.registerSingleton(tokens.FileAnnotationService, () => new FileAnnotationServiceImpl());
  c.registerSingleton(tokens.FileTreeService, () => new FileTreeServiceImpl());
  c.registerSingleton(tokens.IdeAdapterFactory, () => new InfrastructureIdeAdapterFactory());
  c.registerSingleton(
    tokens.WorkspaceAccessRuntime,
    () => new InfrastructureWorkspaceAccessRuntime()
  );
  c.registerSingleton(tokens.WorkspaceFsFactory, () => new InfrastructureWorkspaceFsFactory());
  c.registerSingleton(tokens.NoteAttachmentReader, () => new NoteAttachmentReader());
  c.registerSingleton(tokens.ProposalStoreFactory, () => new InfrastructureProposalStoreFactory());
  c.registerSingleton(tokens.TextToolCallParser, () => new InfrastructureTextToolCallParser());
  c.registerSingleton(tokens.SkillManager, (c) => {
    const agentDocumentStorage = c.resolve(tokens.AgentDocumentStorage);
    const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();
    return new SkillManager(
      c.resolve(tokens.WorkspaceRoot),
      agentDocumentStorage,
      workspaceDiscoveryStorage
    );
  });

  c.registerSingleton(
    tokens.SessionManager,
    (c) =>
      new SessionManager(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.MessagesRepository),
        c.resolve(tokens.SessionsRepository),
        c.resolve(tokens.NotesRepository),
        c.resolve(tokens.AgentManager) as AgentManager,
        c.resolve(tokens.NoteAttachmentReader)
      )
  );

  c.registerSingleton(tokens.ToolManager, (c) => {
    let manager!: ToolManager;
    const orchestrationDeps: OrchestrationDeps = {
      sessions: c.resolve(tokens.SessionManager) as SessionManager,
      agents: c.resolve(tokens.AgentManager) as AgentManager,
      tools: {
        whoCanExecute: (toolName: string, args: unknown, agents: Agent[]) =>
          manager.whoCanExecute(toolName, args, agents),
        catalog: (agent: Agent) => manager.catalog(agent),
      },
    };
    manager = createToolManager(c.resolve(tokens.WorkspaceRoot), orchestrationDeps, {
      pathPermissionChecker: c.resolve(tokens.PathPermissionChecker),
      container: c as unknown as IServiceContainer,
    });
    return manager;
  });

  c.registerSingleton(tokens.ChatStorage, (c) => new ChatStorage(c.resolve(tokens.WorkspaceRoot)));
  c.registerSingleton(
    tokens.ChatManager,
    (c) => new ChatManager(c.resolve(tokens.ChatStorage), c.resolve(tokens.WorkspaceRoot))
  );

  c.registerSingleton(tokens.ContextCompressor, () => new NoOpCompressor());
  c.registerSingleton(tokens.ContextBuilder, () => new DefaultContextBuilder());
  c.registerSingleton(tokens.ContextEnrichers, () => [
    new WorkspaceOverviewEnricher(),
    new TeamRosterEnricher(),
  ]);
  c.registerSingleton(tokens.RagProvider, () => new NoOpRagProvider());
  c.registerSingleton(tokens.ToolResolver, () => new DefaultToolResolver());
  c.registerSingleton(tokens.McpGateway, () => new NoOpMcpGateway());
  c.registerSingleton(tokens.LlmSelector, () => new DefaultLlmSelector());
  c.registerSingleton(tokens.OutputHandler, () => new DefaultOutputHandler());
  c.registerSingleton(tokens.SlashCommands, () => buildDefaultSlashCommands());
  c.registerSingleton(tokens.TurnResultParsers, () => buildDefaultTurnResultParsers());
  c.registerSingleton(tokens.HookPlugins, () => buildDefaultHookPlugins());
  c.registerSingleton(COMMAND_DEFINITION_REGISTRY_TOKEN, () => {
    const registry = createCommandDefinitionRegistry();
    registerDefaultCommandDefinitions(registry);
    return registry;
  });

  // ── HTTP route services (lazily resolved; server overrides ApiBaseUrl) ──
  c.registerSingleton(
    tokens.SystemService,
    (c) => new SystemService(c.resolve(tokens.WorkspaceRoot), c.resolve(tokens.ApiBaseUrl))
  );
  c.registerSingleton(
    tokens.AgentsService,
    (c) =>
      new AgentsService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.ToolManager),
        c.resolve(tokens.ConfigurationStorage),
        c.resolve(tokens.PermissionStorage),
        c.resolve(tokens.MarkdownSectionService),
        c.resolve(tokens.FileAnnotationService)
      )
  );
  c.registerSingleton(
    tokens.TeamGraphBuilder,
    (c) => new TeamGraphBuilder(c.resolve(tokens.AgentManager))
  );
  c.registerSingleton(
    tokens.TeamService,
    (c) => new TeamService(c.resolve(tokens.TeamGraphBuilder))
  );
  c.registerSingleton(tokens.InteractionService, (c) => {
    const cmd = new ChatCommand(
      c.resolve(tokens.ConfigurationStorage),
      c.resolve(tokens.EnvironmentStorage),
      c.resolve(tokens.AgentDocumentStorage),
      c.resolve(tokens.AgentManager),
      c.resolve(tokens.LlmService) as unknown as ILlmService,
      c.resolve(tokens.SkillManager),
      c.resolve(tokens.MarkdownSectionService),
      c.resolve(tokens.PathPermissionChecker),
      c.resolve(tokens.ProposalStoreFactory),
      c.resolve(tokens.MetaService),
      c.resolve(tokens.SessionManager)
    );
    const runChat = (
      workspaceRoot: string,
      agentId: string | undefined,
      options: unknown,
      hooks: unknown
    ) =>
      cmd.execute(workspaceRoot, agentId, options as never, hooks as never);
    return new InteractionService(cfg.workspaceRoot, runChat);
  });
  c.registerSingleton(
    tokens.ChatService,
    (c) =>
      new ChatService(
        c.resolve(tokens.InteractionService),
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.ChatManager) as unknown as IChatManager,
        c.resolve(tokens.ChatStorage),
        c.resolve(tokens.LlmService) as unknown as ILlmService
      )
  );
  c.registerSingleton(
    tokens.SessionsService,
    (c) =>
      new SessionsService(
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.LlmService) as unknown as ILlmService
      )
  );
  c.registerSingleton(
    tokens.ArtifactsService,
    (c) => new ArtifactsService(c.resolve(tokens.SessionManager))
  );
  c.registerSingleton(
    tokens.TasksService,
    (c) => new TasksService(c.resolve(tokens.WorkspaceRoot), c.resolve(tokens.AgentManager))
  );
  c.registerSingleton(
    tokens.PlanningService,
    (c) => new PlanningService(c.resolve(tokens.PlanningRepository))
  );
  c.registerSingleton(tokens.DeveloperService, () => new DeveloperService());
  c.registerSingleton(
    tokens.FilesService,
    (c) =>
      new FilesService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.ConfigurationStorage),
        c.resolve(tokens.PermissionStorage),
        c.resolve(tokens.FileTreeService)
      )
  );
  c.registerSingleton(
    tokens.IdeService,
    (c) =>
      new IdeService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.IdeAdapterFactory)
      )
  );
  c.registerSingleton(
    tokens.SkillsService,
    (c) =>
      new SkillsService(
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.SkillManager),
        c.resolve(tokens.MarkdownSectionService)
      )
  );
  c.registerSingleton(
    tokens.ToolsService,
    (c) =>
      new ToolsService(
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.ToolManager),
        c.resolve(tokens.McpGateway)
      )
  );
  c.registerSingleton(
    tokens.ConfigService,
    (c) =>
      new ConfigService(
        cfg.workspaceRoot,
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.ConfigurationStorage),
        c.resolve(tokens.EnvironmentStorage),
        c.resolve(tokens.LlmProviderTester)
      )
  );
  c.registerSingleton(tokens.MetaService, (c) => {
    return new MetaService(
      c.resolve(tokens.AgentManager),
      c.resolve(tokens.SessionManager),
      c.resolve(tokens.SkillManager),
      c.resolve(tokens.ToolManager),
      c.resolve(tokens.AgentDocumentStorage),
      c.resolve(tokens.McpGateway),
      c.resolve(tokens.PlanningService)
    );
  });
  c.registerSingleton(tokens.CommandsService, () => new CommandsService());
  c.registerSingleton(tokens.ContextRuntime, () => new ContextRuntime());
  c.registerSingleton(
    tokens.AccessService,
    (c) =>
      new AccessService(
        c.resolve(tokens.ContextRuntime),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.WorkspaceAccessRuntime)
      )
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
