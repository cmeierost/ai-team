import type {
  ContainerTokenValueMap,
  IContainerToken,
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
import { createBootstrappedContainer, type ContainerBootstrapper } from './bootstrap.js';
import type { MergeTokenSets, ServiceContainer, TokenSet } from './container.js';
import {
  AgentManager,
  LlmService,
  SkillManager,
  ContextRuntime,
  ChatManager,
  ChatStorage,
  type CliCommandMetadata,
  type Agent,
} from '@ai-team/infrastructure';
import {
  ToolManager,
  SessionManager,
  createSqliteStorage,
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
  type IMessageStorage,
  type IInteractionService,
  SystemService,
  AgentsService,
  TeamService,
  ChatService,
  SessionsService,
  ArtifactsService,
  TasksService,
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
  MessageStorage: new Token<IMessageStorage>('IMessageStorage'),
  LlmService: new Token<LlmService>('LlmService'),
  AgentManager: new Token<AgentManager>('AgentManager'),
  SkillManager: new Token<SkillManager>('SkillManager'),
  SessionManager: new Token<SessionManager>('SessionManager'),
  ToolManager: new Token<ToolManager>('ToolManager'),
  ChatStorage: new Token<ChatStorage>('ChatStorage'),
  ChatManager: new Token<ChatManager>('ChatManager'),

  // ── HTTP route services ──────────────────────────────────────────────────

  SystemService: new Token<SystemService>('SystemService'),
  AgentsService: new Token<AgentsService>('AgentsService'),
  TeamService: new Token<TeamService>('TeamService'),
  ChatService: new Token<ChatService>('ChatService'),
  SessionsService: new Token<SessionsService>('SessionsService'),
  ArtifactsService: new Token<ArtifactsService>('ArtifactsService'),
  TasksService: new Token<TasksService>('TasksService'),
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

  c.registerSingleton(tokens.MessageStorage, (c) =>
    createSqliteStorage(c.resolve(tokens.WorkspaceRoot))
  );
  c.registerSingleton(tokens.LlmService, (c) => new LlmService(c.resolve(tokens.WorkspaceRoot)));
  c.registerSingleton(
    tokens.AgentManager,
    (c) => new AgentManager(c.resolve(tokens.WorkspaceRoot))
  );
  c.registerSingleton(
    tokens.SkillManager,
    (c) => new SkillManager(c.resolve(tokens.WorkspaceRoot))
  );

  c.registerSingleton(
    tokens.SessionManager,
    (c) =>
      new SessionManager(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.MessageStorage) as IMessageStorage,
        c.resolve(tokens.AgentManager) as AgentManager
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
    manager = createToolManager(c.resolve(tokens.WorkspaceRoot), orchestrationDeps);
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
        c.resolve(tokens.ToolManager)
      )
  );
  c.registerSingleton(tokens.TeamService, () => new TeamService(cfg.workspaceRoot));
  c.registerSingleton(
    tokens.ChatService,
    (c) =>
      new ChatService(
        c.resolve(tokens.InteractionService),
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.ChatManager),
        c.resolve(tokens.ChatStorage)
      )
  );
  c.registerSingleton(
    tokens.SessionsService,
    (c) =>
      new SessionsService(
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.LlmService)
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
  c.registerSingleton(tokens.DeveloperService, () => new DeveloperService());
  c.registerSingleton(
    tokens.FilesService,
    (c) => new FilesService(c.resolve(tokens.WorkspaceRoot), c.resolve(tokens.AgentManager))
  );
  c.registerSingleton(tokens.IdeService, (c) => new IdeService(c.resolve(tokens.WorkspaceRoot)));
  c.registerSingleton(
    tokens.SkillsService,
    (c) => new SkillsService(c.resolve(tokens.AgentManager), c.resolve(tokens.SkillManager))
  );
  c.registerSingleton(
    tokens.ToolsService,
    (c) => new ToolsService(c.resolve(tokens.AgentManager), c.resolve(tokens.ToolManager))
  );
  c.registerSingleton(tokens.ConfigService, () => new ConfigService(cfg.workspaceRoot));
  c.registerSingleton(
    tokens.MetaService,
    (c) =>
      new MetaService(
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.SkillManager)
      )
  );
  c.registerSingleton(tokens.CommandsService, () => new CommandsService());
  c.registerSingleton(tokens.ContextRuntime, () => new ContextRuntime());
  c.registerSingleton(
    tokens.AccessService,
    (c) => new AccessService(c.resolve(tokens.ContextRuntime), c.resolve(tokens.AgentManager))
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
  );

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
