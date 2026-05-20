import type {
  IContainerToken,
  IServiceContainer,
  IServiceContainerRegistrar,
  ILlmService,
  IChatManager,
  IPathPermissionChecker,
  IMessagesRepository,
  ISessionsRepository,
  INotesRepository,
  IAgentManager,
  INoteAttachmentReader,
  IChatStorage,
  IContextCompressor,
  IContextBuilder,
  IContextEnricher,
  IRagProvider,
  IToolResolver,
  IMcpGateway,
  ILlmSelector,
  IOutputHandler,
  ICommand,
  ISystemInfoService,
  ITeamGraphBuilder,
  IConfigurationStorage,
  IEnvironmentStorage,
  IAgentDocumentStorage,
  ISkillManager,
  IMarkdownSectionService,
  IProposalStoreFactory,
  IDeveloperIdentityService,
  IPermissionStorage,
  IFileAnnotationService,
  IFileTreeService,
  ILlmProviderTester,
  IWorkspaceAccessRuntime,
  IIdeAdapterFactory,
  IPlanningRepository,
  IWorkspaceFsFactory,
} from '@ai-team/core';
import {
  type IQuestionService,
  InteractionQuestionService,
} from '../questions/question-service.js';
import { SessionManager } from '../session-manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { CommandRegistry } from '../command-registry-impl.js';
import {
  WhoHasAccessTool,
  DoIHaveAccessTool,
  AnalyzePermissionOverlapTool,
} from '../commands/fs/access-introspection-tools.js';
import {
  FsExistsTool,
  FsInfoTool,
  FsReadFileTool,
  FsReadLinesTool,
  FsWriteFileTool,
  FsCreateFileTool,
  FsDeletePathTool,
  FsMkdirTool,
  FsListTool,
  FsTreeTool,
  FsSearchContentTool,
  FsSearchMetadataTool,
} from '../commands/fs/fs-tools.js';
import { FileTreeService } from '../commands/fs/file-tree.js';
import {
  FindSymbolTool,
  FindReferencesTool,
  LspTool,
  GrepCodeTool,
} from '../commands/edit/code-tools.js';
import { HttpFetchCommand } from '../commands/http/http-fetch.command.js';
import { HttpCrawlCommand } from '../commands/http/http-crawl.command.js';
import { CodeSearchTool } from '../commands/edit/codesearch-tool.js';
import { ApplyPatchTool, MultiEditTool, FsEditTool } from '../commands/fs/edit-tools.js';
import { createOrchestrationTools } from '../tools/orchestration-tools.js';
import { getWorkflowDefinitionResolvers } from '../workflow/index.js';
import { NoOpCompressor } from '../orchestrator/defaults/context-compressor.js';
import { DefaultContextBuilder } from '../orchestrator/defaults/context-builder.js';
import {
  WorkspaceOverviewEnricher,
  TeamRosterEnricher,
} from '../orchestrator/defaults/context-enrichers.js';
import { NoOpRagProvider } from '../orchestrator/defaults/rag-provider.js';
import { DefaultToolResolver } from '../orchestrator/defaults/tool-resolver.js';
import { NoOpMcpGateway } from '../orchestrator/defaults/mcp-gateway.js';
import { DefaultLlmSelector } from '../orchestrator/defaults/llm-selector.js';
import { DefaultOutputHandler } from '../orchestrator/defaults/output-handler.js';
import { buildDefaultHookPlugins } from '../orchestrator/defaults/hook-plugins.js';
import { buildDefaultTurnResultParsers } from '../orchestrator/defaults/turn-result-parsers.js';
import { SlashCommandDispatcher } from '../orchestrator/slash-command-dispatcher.js';
import { EmitService } from '../orchestrator/services/emit-service.js';
import { ToolSchemaService } from '../orchestrator/services/schema-service.js';
import { ToolDispatchSupportService } from '../orchestrator/services/tool-dispatch-support-service.js';
import { ToolSerializationService } from '../orchestrator/services/tool-serialization-service.js';
import {
  COMMAND_DEFINITION_REGISTRY_TOKEN,
  COMMAND_FACTORY_TOKENS,
  createCommandDefinitionRegistry,
} from '../types.js';
import {
  InfoChatCommand,
  ChatCommand,
  ChatInfoService,
  ChatPreflightService,
} from '../commands/chat/index.js';
import { IInteractionService, InteractionService } from '../interaction-service.js';
import { GovernanceService } from '../commands/agents/governance.js';
import { AgentToolsService } from '../commands/tools/tools-service.js';
import {
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
} from '../routers/index.js';
import {
  IAccessService,
  IAgentsService,
  IArtifactsService,
  IChatService,
  ICommandsService,
  IConfigService,
  IContextService,
  IDeveloperService,
  IIdeService,
  IPlanningService,
  ISessionsService,
  ISkillsService,
  ISystemService,
  ITasksService,
  IToolsService,
} from '@ai-team/api-contracts';

export interface ServiceLayerRegistrationTokens {
  WorkspaceRoot: IContainerToken<string>;
  MessagesRepository: IContainerToken<IMessagesRepository>;
  SessionsRepository: IContainerToken<ISessionsRepository>;
  NotesRepository: IContainerToken<INotesRepository>;
  AgentManager: IContainerToken<IAgentManager>;
  NoteAttachmentReader: IContainerToken<INoteAttachmentReader>;
  SessionManager: IContainerToken<SessionManager>;
  ToolManager: IContainerToken<ToolManager>;
  ToolDispatchSupportService: IContainerToken<ToolDispatchSupportService>;
  ToolSerializationService: IContainerToken<ToolSerializationService>;
  PathPermissionChecker: IContainerToken<IPathPermissionChecker>;
  WorkspaceFsFactory: IContainerToken<IWorkspaceFsFactory>;
  ChatStorage: IContainerToken<IChatStorage>;
  ChatManager: IContainerToken<IChatManager>;

  ContextCompressor: IContainerToken<IContextCompressor>;
  ContextBuilder: IContainerToken<IContextBuilder>;
  ContextEnrichers: IContainerToken<IContextEnricher[]>;
  RagProvider: IContainerToken<IRagProvider>;
  ToolResolver: IContainerToken<IToolResolver>;
  McpGateway: IContainerToken<IMcpGateway>;
  LlmSelector: IContainerToken<ILlmSelector>;
  OutputHandler: IContainerToken<IOutputHandler>;
  SlashCommands: IContainerToken<ICommand<any, any>[]>;
  TurnResultParsers: IContainerToken<any[]>;
  HookPlugins: IContainerToken<any>;

  ApiBaseUrl: IContainerToken<string>;
  SystemInfoService: IContainerToken<ISystemInfoService>;
  SystemService: IContainerToken<ISystemService>;
  AgentsService: IContainerToken<IAgentsService>;
  TeamGraphBuilder: IContainerToken<ITeamGraphBuilder>;
  TeamService: IContainerToken<any>;
  InteractionService: IContainerToken<IInteractionService>;
  ChatService: IContainerToken<IChatService>;
  SessionsService: IContainerToken<ISessionsService>;
  ArtifactsService: IContainerToken<IArtifactsService>;
  TasksService: IContainerToken<ITasksService>;
  PlanningService: IContainerToken<IPlanningService>;
  DeveloperService: IContainerToken<IDeveloperService>;
  FilesService: IContainerToken<any>;
  IdeService: IContainerToken<IIdeService>;
  SkillsService: IContainerToken<ISkillsService>;
  ToolsService: IContainerToken<IToolsService>;
  ConfigService: IContainerToken<IConfigService>;
  MetaService: IContainerToken<any>;
  CommandsService: IContainerToken<ICommandsService>;
  ContextRuntime: IContainerToken<any>;
  AccessService: IContainerToken<IAccessService>;

  ConfigurationStorage: IContainerToken<IConfigurationStorage>;
  EnvironmentStorage: IContainerToken<IEnvironmentStorage>;
  AgentDocumentStorage: IContainerToken<IAgentDocumentStorage>;
  LlmService: IContainerToken<ILlmService>;
  SkillManager: IContainerToken<ISkillManager>;
  MarkdownSectionService: IContainerToken<IMarkdownSectionService>;
  ProposalStoreFactory: IContainerToken<IProposalStoreFactory>;
  ContextService: IContainerToken<IContextService>;
  DeveloperIdentityService: IContainerToken<IDeveloperIdentityService>;

  PermissionStorage: IContainerToken<IPermissionStorage>;
  FileAnnotationService: IContainerToken<IFileAnnotationService>;
  LlmProviderTester: IContainerToken<ILlmProviderTester>;
  FileTreeService: IContainerToken<IFileTreeService>;
  IdeAdapterFactory: IContainerToken<IIdeAdapterFactory>;
  WorkspaceAccessRuntime: IContainerToken<IWorkspaceAccessRuntime>;
  PlanningRepository: IContainerToken<IPlanningRepository>;
  QuestionService: IContainerToken<IQuestionService>;
}

export interface ServiceLayerRegistrationConfig {
  workspaceRoot: string;
  apiBaseUrl?: string;
}

export function buildInteractionService(
  c: IServiceContainer,
  tokens: ServiceLayerRegistrationTokens,
  workspaceRoot: string
): InteractionService {
  const cmd = new ChatCommand(
    {
      configurationStorage: c.resolve(tokens.ConfigurationStorage),
      environmentStorage: c.resolve(tokens.EnvironmentStorage),
      developerIdentityService: c.resolve(tokens.DeveloperIdentityService),
      ...(null as any),
      contextService: c.resolve(tokens.MetaService),
    },
    {
      agentManager: c.resolve(tokens.AgentManager),
      agentDocumentStorage: c.resolve(tokens.AgentDocumentStorage),
      markdownSectionService: c.resolve(tokens.MarkdownSectionService),
      skillManager: c.resolve(tokens.SkillManager),
    },
    {
      sessionManager: c.resolve(tokens.SessionManager),
      llmService: c.resolve(tokens.LlmService),
      proposalStoreFactory: c.resolve(tokens.ProposalStoreFactory),
    },
    {
      pathPermissionChecker: c.resolve(tokens.PathPermissionChecker),
      serviceContainer: c as any,
    },
    new ChatInfoService(),
    new ChatPreflightService(
      c.resolve(tokens.ConfigurationStorage),
      c.resolve(tokens.EnvironmentStorage),
      c.resolve(tokens.DeveloperIdentityService)
    ),
    new InfoChatCommand(c.resolve(tokens.AgentManager), c.resolve(tokens.QuestionService))
  );

  const runChat = (wr: string, agentId: string | undefined, options: any, hooks: any) =>
    cmd.execute(wr, agentId, options, hooks);

  return new InteractionService(workspaceRoot, runChat);
}

export function registerServiceLayerServices(
  container: IServiceContainerRegistrar,
  cfg: ServiceLayerRegistrationConfig,
  tokens: ServiceLayerRegistrationTokens
): void {
  container.registerSingleton(
    tokens.SessionManager,
    (c) =>
      new SessionManager(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.MessagesRepository),
        c.resolve(tokens.SessionsRepository),
        c.resolve(tokens.NotesRepository),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.NoteAttachmentReader)
      )
  );

  // Register CommandRegistry with all built-in tools
  container.registerSingleton(COMMAND_FACTORY_TOKENS.CommandRegistry, (c) => {
    const registry = new CommandRegistry();
    const workspaceRoot = c.resolve(tokens.WorkspaceRoot) as string;
    const workspaceFsFactory = c.resolve(tokens.WorkspaceFsFactory);
    // File system tools
    const fsReadFileTool = new FsReadFileTool(workspaceRoot, workspaceFsFactory);
    const fsReadLinesTool = new FsReadLinesTool(fsReadFileTool);
    registry.register(fsReadFileTool);
    registry.register(fsReadLinesTool);
    registry.register(new FsWriteFileTool(workspaceFsFactory));
    registry.register(new FsCreateFileTool(workspaceFsFactory));
    registry.register(new FsDeletePathTool(workspaceFsFactory));
    registry.register(new FsMkdirTool(workspaceFsFactory));
    registry.register(new FsExistsTool(workspaceFsFactory));
    registry.register(new FsInfoTool(workspaceFsFactory));
    registry.register(new FsListTool(workspaceFsFactory));
    registry.register(new FsTreeTool(workspaceFsFactory));
    registry.register(new FsSearchContentTool(workspaceRoot, workspaceFsFactory));
    registry.register(new FsSearchMetadataTool(workspaceRoot, workspaceFsFactory));
    // File system access tools
    const accessChecker = c.resolve(tokens.PathPermissionChecker);
    const accessAgentManager = c.resolve(tokens.AgentManager);
    const ideAdapterFactory = c.resolve(tokens.IdeAdapterFactory);
    registry.register(new WhoHasAccessTool(workspaceRoot, accessAgentManager, accessChecker));
    registry.register(new DoIHaveAccessTool(workspaceRoot, accessAgentManager, accessChecker));
    registry.register(new AnalyzePermissionOverlapTool(accessAgentManager));
    // Code analysis and editing tools
    registry.register(new FindSymbolTool(workspaceRoot, ideAdapterFactory));
    registry.register(new FindReferencesTool(workspaceRoot, ideAdapterFactory));
    registry.register(new LspTool(workspaceRoot, ideAdapterFactory));
    registry.register(new GrepCodeTool());
    // HTTP tools
    registry.register(new HttpFetchCommand());
    registry.register(new HttpCrawlCommand());
    // Additional editing tools
    registry.register(new CodeSearchTool());
    const fsEditTool = new FsEditTool(workspaceRoot, accessChecker, ideAdapterFactory);
    registry.register(fsEditTool);
    registry.register(new ApplyPatchTool(workspaceRoot, accessChecker, ideAdapterFactory));
    registry.register(
      new MultiEditTool(workspaceRoot, fsEditTool, accessChecker, ideAdapterFactory)
    );
    return registry;
  });

  // Register ToolManager with pure DI — resolves from registry and container
  container.registerSingleton(tokens.ToolManager, (c) => {
    const workspaceRoot = c.resolve(tokens.WorkspaceRoot) as string;
    const pathPermissionChecker = c.resolve(tokens.PathPermissionChecker);
    const registry = c.resolve(COMMAND_FACTORY_TOKENS.CommandRegistry);

    const manager = new ToolManager(workspaceRoot, pathPermissionChecker, registry, c);

    // Register orchestration tools (factory-constructed)
    const workflowCatalog = {
      listWorkflowIds(): string[] {
        return registry
          .getAll({ availableIn: { tool: true }, group: 'workflow' })
          .filter((t) => t.key !== 'list')
          .map((t) => t.key);
      },
      async getWorkflowDefinition(workflowId: string) {
        const tool = registry.get(`workflow_${workflowId}`) as
          | { getDefinition?: () => unknown; availableIn?: { tool?: boolean } }
          | undefined;
        if (!tool?.availableIn?.tool || !tool?.getDefinition) {
          throw new Error(`Workflow definition '${workflowId}' is not available.`);
        }
        return tool.getDefinition() as import('@ai-team/api-contracts').WorkflowDefinitionApiResponse;
      },
    };

    const workflowResolvers = getWorkflowDefinitionResolvers();

    for (const tool of createOrchestrationTools(c, {
      tools: {
        whoCanExecute: (toolName: string, args: unknown, agents: import('@ai-team/core').Agent[]) =>
          manager.whoCanExecute(toolName, args, agents),
        catalog: (agent: import('@ai-team/core').Agent) => manager.catalog(agent),
      },
      workflows: workflowCatalog,
      workflowResolvers,
    })) {
      registry.register(tool);
    }

    return manager;
  });
  container.registerSingleton(tokens.ContextCompressor, () => new NoOpCompressor());
  container.registerSingleton(tokens.ContextBuilder, () => new DefaultContextBuilder());
  container.registerSingleton(
    tokens.ToolSerializationService,
    () => new ToolSerializationService()
  );
  container.registerSingleton(
    tokens.ToolDispatchSupportService,
    (c) =>
      new ToolDispatchSupportService(
        c.resolve(tokens.ToolSerializationService),
        c.resolve(tokens.LlmService),
        c.resolve(tokens.ProposalStoreFactory)
      )
  );
  container.registerSingleton(tokens.ContextEnrichers, (c) => [
    new WorkspaceOverviewEnricher(),
    new TeamRosterEnricher(c.resolve(tokens.AgentManager)),
  ]);
  container.registerSingleton(COMMAND_FACTORY_TOKENS.EmitService, () => new EmitService());
  container.registerSingleton(
    COMMAND_FACTORY_TOKENS.ToolSchemaService,
    (c) => new ToolSchemaService(c.resolve(COMMAND_FACTORY_TOKENS.ToolManager))
  );
  container.registerSingleton(tokens.RagProvider, () => new NoOpRagProvider());
  container.registerSingleton(
    tokens.ToolResolver,
    (c) => new DefaultToolResolver(c.resolve(tokens.ToolManager))
  );
  container.registerSingleton(tokens.McpGateway, () => new NoOpMcpGateway());
  container.registerSingleton(
    tokens.LlmSelector,
    (c) => new DefaultLlmSelector(c.resolve(tokens.LlmService))
  );
  container.registerSingleton(tokens.OutputHandler, () => new DefaultOutputHandler());
  container.registerSingleton(tokens.SlashCommands, (c) =>
    new SlashCommandDispatcher(c.resolve(tokens.ToolManager) as any).list()
  );
  container.registerSingleton(tokens.TurnResultParsers, (c) =>
    buildDefaultTurnResultParsers(c.resolve(tokens.AgentManager))
  );
  container.registerSingleton(tokens.HookPlugins, () => buildDefaultHookPlugins());
  container.registerSingleton(COMMAND_DEFINITION_REGISTRY_TOKEN, () =>
    createCommandDefinitionRegistry()
  );

  container.registerSingleton(
    tokens.SystemService,
    (c) =>
      new SystemService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.ApiBaseUrl),
        c.resolve(tokens.SystemInfoService)
      )
  );
  container.registerSingleton(
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
  container.registerSingleton(
    tokens.TeamService,
    (c) => new TeamService(c.resolve(tokens.TeamGraphBuilder))
  );
  container.registerSingleton(tokens.QuestionService, () => InteractionQuestionService({}));

  container.registerScoped(tokens.InteractionService, (c) =>
    buildInteractionService(c, tokens, cfg.workspaceRoot)
  );

  container.registerSingleton(
    tokens.ChatService,
    (c) =>
      new ChatService(
        c.resolve(tokens.InteractionService),
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.ChatManager),
        c.resolve(tokens.ChatStorage),
        c.resolve(tokens.LlmService)
      )
  );
  container.registerSingleton(
    tokens.SessionsService,
    (c) =>
      new SessionsService(
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.LlmService)
      )
  );
  container.registerSingleton(
    tokens.ArtifactsService,
    (c) => new ArtifactsService(c.resolve(tokens.SessionManager))
  );
  container.registerSingleton(
    tokens.TasksService,
    (c) => new TasksService(c.resolve(tokens.WorkspaceRoot), c.resolve(tokens.AgentManager))
  );
  container.registerSingleton(
    tokens.PlanningService,
    (c) => new PlanningService(c.resolve(tokens.PlanningRepository))
  );
  container.registerSingleton(
    tokens.DeveloperService,
    (c) => new DeveloperService(c.resolve(tokens.DeveloperIdentityService))
  );
  container.registerSingleton(
    tokens.FilesService,
    (c) =>
      new FilesService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.ConfigurationStorage),
        c.resolve(tokens.PermissionStorage),
        c.resolve(tokens.FileTreeService),
        new FileTreeService(
          c.resolve(tokens.WorkspaceRoot),
          c.resolve(tokens.AgentManager),
          c.resolve(tokens.ConfigurationStorage),
          c.resolve(tokens.PermissionStorage),
          c.resolve(tokens.FileTreeService)
        )
      )
  );
  container.registerSingleton(
    tokens.IdeService,
    (c) => new IdeService(c.resolve(tokens.WorkspaceRoot), c.resolve(tokens.IdeAdapterFactory))
  );
  container.registerSingleton(
    tokens.SkillsService,
    (c) =>
      new SkillsService(
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.SkillManager),
        c.resolve(tokens.MarkdownSectionService)
      )
  );
  container.registerSingleton(tokens.ToolsService, (c) => {
    const governanceService = new GovernanceService(
      c.resolve(tokens.AgentManager),
      c.resolve(tokens.QuestionService)
    );
    return new ToolsService(
      new AgentToolsService(
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.ToolManager),
        governanceService,
        c.resolve(tokens.McpGateway)
      ),
      governanceService
    );
  });
  container.registerSingleton(
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
  container.registerSingleton(
    tokens.MetaService,
    (c) =>
      new MetaService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.SkillManager),
        c.resolve(tokens.ToolManager),
        c.resolve(tokens.AgentDocumentStorage),
        c.resolve(tokens.McpGateway),
        c.resolve(tokens.PlanningService)
      )
  );
  container.registerSingleton(
    tokens.CommandsService,
    (c) =>
      new CommandsService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.SkillManager),
        c.resolve(tokens.ConfigurationStorage)
      )
  );
  container.registerSingleton(
    tokens.AccessService,
    (c) =>
      new AccessService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.ContextRuntime),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.WorkspaceAccessRuntime)
      )
  );
}
