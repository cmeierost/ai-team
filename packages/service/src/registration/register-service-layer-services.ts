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
  ICommandDescriptor,
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
import { type IInteractionService as IQuestionService } from '../questions/question-service.js';
import { WsQuestionService } from '../questions/ws-question-service.js';
import { AskUserCommand, AskUserCommandMetadata } from '../commands/com/ask.command.js';
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
  FindSymbolToolMetadata,
  FindReferencesToolMetadata,
  LspToolMetadata,
  GrepCodeToolMetadata,
} from '../commands/edit/code-tools.js';
import { HttpFetchCommand, HttpFetchCommandMetadata } from '../commands/http/http-fetch.command.js';
import { HttpCrawlCommand, HttpCrawlCommandMetadata } from '../commands/http/http-crawl.command.js';
import { CodeSearchTool, CodeSearchToolMetadata } from '../commands/edit/codesearch-tool.js';
import { ApplyPatchTool, MultiEditTool, FsEditTool } from '../commands/fs/edit-tools.js';
import { FsReadFileToolMetadata } from '../commands/fs/fs-read-file.tool.js';
import { FsReadLinesToolMetadata } from '../commands/fs/fs-read-lines.tool.js';
import { FsWriteFileToolMetadata } from '../commands/fs/fs-write-file.tool.js';
import { FsCreateFileToolMetadata } from '../commands/fs/fs-create-file.tool.js';
import { FsDeletePathToolMetadata } from '../commands/fs/fs-delete-path.tool.js';
import { FsMkdirToolMetadata } from '../commands/fs/fs-mkdir.tool.js';
import { FsExistsToolMetadata } from '../commands/fs/fs-exists.tool.js';
import { FsInfoToolMetadata } from '../commands/fs/fs-info.tool.js';
import { FsListToolMetadata } from '../commands/fs/fs-list.tool.js';
import { FsTreeToolMetadata } from '../commands/fs/fs-tree.tool.js';
import { FsSearchContentToolMetadata } from '../commands/fs/fs-search-content.tool.js';
import { FsSearchMetadataToolMetadata } from '../commands/fs/fs-search-metadata.tool.js';
import { WhoHasAccessToolMetadata } from '../commands/fs/who-has-access.tool.js';
import { DoIHaveAccessToolMetadata } from '../commands/fs/do-i-have-access.tool.js';
import { AnalyzePermissionOverlapToolMetadata } from '../commands/fs/analyze-permission-overlap.tool.js';
import { FsEditToolMetadata } from '../commands/fs/fs-edit.tool.js';
import { ApplyPatchToolMetadata } from '../commands/fs/apply-patch.tool.js';
import { MultiEditToolMetadata } from '../commands/fs/multi-edit.tool.js';
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
import { WorkflowRunnerFactory } from '../workflow/runner.js';
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

  container.registerScoped(
    COMMAND_FACTORY_TOKENS.WorkflowRunnerFactory,
    (c) => new WorkflowRunnerFactory(c.child())
  );

  // Register CommandRegistry with all built-in tools
  container.registerSingleton(COMMAND_FACTORY_TOKENS.CommandRegistry, (c) => {
    const registry = new CommandRegistry();
    // File system tools
    registry.register(
      FsReadFileToolMetadata,
      (r) =>
        new FsReadFileTool(r.resolve(tokens.WorkspaceRoot), r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsReadLinesToolMetadata,
      (r) =>
        new FsReadLinesTool(
          new FsReadFileTool(r.resolve(tokens.WorkspaceRoot), r.resolve(tokens.WorkspaceFsFactory))
        )
    );
    registry.register(
      FsWriteFileToolMetadata,
      (r) => new FsWriteFileTool(r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsCreateFileToolMetadata,
      (r) => new FsCreateFileTool(r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsDeletePathToolMetadata,
      (r) => new FsDeletePathTool(r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsMkdirToolMetadata,
      (r) => new FsMkdirTool(r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsExistsToolMetadata,
      (r) => new FsExistsTool(r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsInfoToolMetadata,
      (r) => new FsInfoTool(r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsListToolMetadata,
      (r) => new FsListTool(r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsTreeToolMetadata,
      (r) => new FsTreeTool(r.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsSearchContentToolMetadata,
      (r) =>
        new FsSearchContentTool(
          r.resolve(tokens.WorkspaceRoot),
          r.resolve(tokens.WorkspaceFsFactory)
        )
    );
    registry.register(
      FsSearchMetadataToolMetadata,
      (r) =>
        new FsSearchMetadataTool(
          r.resolve(tokens.WorkspaceRoot),
          r.resolve(tokens.WorkspaceFsFactory)
        )
    );
    // File system access tools
    registry.register(
      WhoHasAccessToolMetadata,
      (r) =>
        new WhoHasAccessTool(
          r.resolve(tokens.WorkspaceRoot),
          r.resolve(tokens.AgentManager),
          r.resolve(tokens.PathPermissionChecker)
        )
    );
    registry.register(
      DoIHaveAccessToolMetadata,
      (r) =>
        new DoIHaveAccessTool(
          r.resolve(tokens.WorkspaceRoot),
          r.resolve(tokens.AgentManager),
          r.resolve(tokens.PathPermissionChecker)
        )
    );
    registry.register(
      AnalyzePermissionOverlapToolMetadata,
      (r) => new AnalyzePermissionOverlapTool(r.resolve(tokens.AgentManager))
    );
    // Code analysis and editing tools
    registry.register(
      FindSymbolToolMetadata,
      (r) =>
        new FindSymbolTool(r.resolve(tokens.WorkspaceRoot), r.resolve(tokens.IdeAdapterFactory))
    );
    registry.register(
      FindReferencesToolMetadata,
      (r) =>
        new FindReferencesTool(r.resolve(tokens.WorkspaceRoot), r.resolve(tokens.IdeAdapterFactory))
    );
    registry.register(
      LspToolMetadata,
      (r) => new LspTool(r.resolve(tokens.WorkspaceRoot), r.resolve(tokens.IdeAdapterFactory))
    );
    registry.register(GrepCodeToolMetadata, (r) => new GrepCodeTool());
    // HTTP tools
    registry.register(HttpFetchCommandMetadata, (r) => new HttpFetchCommand());
    registry.register(HttpCrawlCommandMetadata, (r) => new HttpCrawlCommand());
    // Additional editing tools
    registry.register(CodeSearchToolMetadata, (r) => new CodeSearchTool());
    registry.register(
      FsEditToolMetadata,
      (r) =>
        new FsEditTool(
          r.resolve(tokens.WorkspaceRoot),
          r.resolve(tokens.PathPermissionChecker),
          r.resolve(tokens.IdeAdapterFactory)
        )
    );
    registry.register(
      ApplyPatchToolMetadata,
      (r) =>
        new ApplyPatchTool(
          r.resolve(tokens.WorkspaceRoot),
          r.resolve(tokens.PathPermissionChecker),
          r.resolve(tokens.IdeAdapterFactory)
        )
    );
    registry.register(
      MultiEditToolMetadata,
      (r) =>
        new MultiEditTool(
          r.resolve(tokens.WorkspaceRoot),
          new FsEditTool(
            r.resolve(tokens.WorkspaceRoot),
            r.resolve(tokens.PathPermissionChecker),
            r.resolve(tokens.IdeAdapterFactory)
          ),
          r.resolve(tokens.PathPermissionChecker),
          r.resolve(tokens.IdeAdapterFactory)
        )
    );
    return registry;
  });

  // QuestionService: scoped WebSocket-backed implementation. Overridden per connection
  // in the WebSocket handler via registerInstance before InteractionService is resolved.
  container.registerScoped(tokens.QuestionService, () => new WsQuestionService());

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
        const meta = registry.get(`workflow_${workflowId}`);
        if (!meta?.availableIn?.tool) {
          throw new Error(`Workflow definition '${workflowId}' is not available.`);
        }
        const tool = registry.resolve(`workflow_${workflowId}`, c) as
          | { getDefinition?: () => unknown }
          | undefined;
        if (!tool?.getDefinition) {
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
      registry.register(tool.metadata, (_r) => tool);
    }

    // AskUserCommand is registered lazily so each invocation resolves the
    // current per-connection QuestionService (set via registerInstance in the
    // WebSocket handler) rather than a service baked in at startup.
    registry.register(
      AskUserCommandMetadata,
      (r) => new AskUserCommand(r.resolve(COMMAND_FACTORY_TOKENS.QuestionService))
    );

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
          new GovernanceService(c.resolve(tokens.AgentManager), c.resolve(tokens.QuestionService)),
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
