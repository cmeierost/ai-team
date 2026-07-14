import type {
  CoreServiceRegistrationTokens,
  IContainerToken,
  IServiceContainer,
  IServiceContainerRegistrar,
  IQuestionService,
} from '@ai-team/core';
import { AskUserCommand, AskUserCommandMetadata } from '../commands/com/ask.command.js';
import { LlmCallCommand, LlmCallCommandMetadata } from '../commands/orchestration/llm-call.tool.js';
import {
  BootstrapFilesCommand,
  BootstrapFilesCommandMetadata,
} from '../commands/orchestration/bootstrap-files.tool.js';
import {
  SaveTranscriptCommand,
  SaveTranscriptCommandMetadata,
} from '../commands/orchestration/save-transcript.tool.js';
import {
  SetPermissionsCommand,
  SetPermissionsCommandMetadata,
} from '../commands/orchestration/set-permissions.tool.js';
import {
  NameSuggestionsCommand,
  NameSuggestionsCommandMetadata,
} from '../commands/orchestration/name-suggestions.tool.js';
import {
  PrepareOnboardingCommand,
  PrepareOnboardingCommandMetadata,
} from '../commands/orchestration/onboarding-prepare.tool.js';
import { HireWorkflowCommand, HireWorkflowMetadata } from '../commands/hr/hire-workflow.js';
import {
  OnboardingWorkflowCommand,
  OnboardingWorkflowMetadata,
} from '../commands/hr/onboarding-workflow.js';
import { SessionManager } from '../sessions/session-manager.js';
import { ToolManager } from '../tooling/manager/tool-manager.js';
import { CommandRegistry } from '../command-dispatcher/command-registry.js';
import { WhoHasAccessTool } from '../commands/fs/who-has-access.tool.js';
import { DoIHaveAccessTool } from '../commands/fs/do-i-have-access.tool.js';
import { AnalyzePermissionOverlapTool } from '../commands/fs/analyze-permission-overlap.tool.js';
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
import { createOrchestrationTools } from '../commands/orchestration/orchestration-tools-bridge.js';
import {
  DelegateToAgentCommand,
  DelegateToAgentToolMetadata,
} from '../commands/agents/delegate-to-agent.command.js';
import {
  UpdateEmployeeLlmTool,
  UpdateEmployeeLlmToolMetadata,
} from '../commands/agents/update-agent-llm.command.js';
import { RegisterCliTool, RegisterCliToolMetadata } from '../commands/cli/register-cli.command.js';
import {
  SemanticSearchTool,
  SemanticSearchToolMetadata,
  GetErrorsTool,
  GetErrorsToolMetadata,
} from '../commands/edit/search-tools.js';
import { listWorkflowToolIds } from '../commands/workflow/workflow-catalog.js';
import { getWorkflowDefinitionResolvers } from '../workflow/definition-catalog.js';
import {
  DefaultContextBuilder,
  DefaultLlmSelector,
  DefaultOutputHandler,
  DefaultToolResolver,
  TeamRosterEnricher,
  WorkspaceOverviewEnricher,
  buildDefaultTurnResultParsers,
} from '../workflow/chat/runtime-defaults.js';
import {
  RecentTurnsContextCompressor,
  RegistryMcpGateway,
  SearchHintRagProvider,
} from '../workflow/chat/runtime-plugin-services.js';
import { ToolSchemaService } from '../workflow/runtime/tools/schema-service.js';
import { ToolDispatchSupportService } from '../workflow/runtime/tools/tool-dispatch-support-service.js';
import { ToolSerializationService } from '../workflow/runtime/tools/tool-serialization-service.js';
import { createCommandDispatcher } from '../command-dispatcher/command-dispatcher.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import { IInteractionService, InteractionService } from '../interaction/interaction-service.js';
import { WorkflowRunnerFactory } from '../workflow/index.js';
import type { IChatRuntime } from '../workflow/chat/chat-runtime.js';
import { GovernanceService } from '../governance/governance-service.js';
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
  ChatOptions,
} from '@ai-team/api-contracts';
import type { WorkflowCallbacks } from '../workflow/runtime/hooks.js';

export interface ServiceLayerRegistrationTokens extends Pick<
  CoreServiceRegistrationTokens,
  | 'WorkspaceRoot'
  | 'MessagesRepository'
  | 'SessionsRepository'
  | 'NotesRepository'
  | 'AgentManager'
  | 'NoteAttachmentReader'
  | 'PathPermissionChecker'
  | 'WorkspaceFsFactory'
  | 'ChatStorage'
  | 'ChatManager'
  | 'ContextCompressor'
  | 'ContextBuilder'
  | 'ContextEnrichers'
  | 'RagProvider'
  | 'ToolResolver'
  | 'McpGateway'
  | 'LlmSelector'
  | 'OutputHandler'
  | 'TurnResultParsers'
  | 'SystemInfoService'
  | 'TeamGraphBuilder'
  | 'ConfigurationStorage'
  | 'BackendLogService'
  | 'AgentDocumentStorage'
  | 'LlmService'
  | 'SkillManager'
  | 'MarkdownSectionService'
  | 'ProposalStoreFactory'
  | 'DeveloperIdentityService'
  | 'PermissionStorage'
  | 'FileAnnotationService'
  | 'LlmProviderTester'
  | 'FileTreeService'
  | 'IdeAdapterFactory'
  | 'WorkspaceAccessRuntime'
  | 'PlanningRepository'
> {
  SessionManager: IContainerToken<SessionManager>;
  ToolManager: IContainerToken<ToolManager>;
  ToolDispatchSupportService: IContainerToken<ToolDispatchSupportService>;
  ToolSerializationService: IContainerToken<ToolSerializationService>;

  ApiBaseUrl: IContainerToken<string>;
  SystemService: IContainerToken<ISystemService>;
  AgentsService: IContainerToken<IAgentsService>;
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

  ContextService: IContainerToken<IContextService>;
  // Keep service-specific specialization for question DTO generics.
  QuestionService: IContainerToken<IQuestionService>;
}

export interface ServiceLayerRegistrationConfig {
  workspaceRoot: string;
  apiBaseUrl?: string;
}

export function buildInteractionService(
  c: IServiceContainer,
  workspaceRoot: string
): InteractionService {
  // Resolve dispatcher from the container passed in (root for CLI, child for WebSocket).
  // This ensures commands get the correctly-scoped EmitService:
  // - CLI: console EmitService from root container
  // - API: connection-scoped EmitService from child container
  const dispatcher = c.resolve(COMMAND_FACTORY_TOKENS.CommandDispatcher);

  const runChat = async (
    _wr: string,
    agentId: string | undefined,
    options: ChatOptions,
    _callbacks: WorkflowCallbacks
  ) => {
    const response = await dispatcher.dispatch(
      'chat-chat',
      {
        agentId,
        message: options?.message,
        sessionId: options?.sessionId,
        createNewSession: options?.createNewSession,
      },
      {
        history: [],
      }
    );

    if (response.status === 'error') {
      throw new Error(response.message || 'chat dispatch failed');
    }
  };

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
    (_c) => new WorkflowRunnerFactory(_c.child())
  );

  container.registerScoped(COMMAND_FACTORY_TOKENS.CommandDispatcher, (c) =>
    createCommandDispatcher(c.resolve(tokens.WorkspaceRoot), c)
  );

  container.registerScoped(
    COMMAND_FACTORY_TOKENS.ChatRuntime,
    (): IChatRuntime => ({
      async runAsync() {
        return {
          status: 'failed',
          text: '',
          hopCount: 0,
          error:
            'ChatRuntime is transport-scoped and must be registered by the CLI adapter container.',
        };
      },
    })
  );

  // Register CommandRegistry with all built-in tools
  container.registerSingleton(COMMAND_FACTORY_TOKENS.CommandRegistry, (_c) => {
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
      () => new FsWriteFileTool(_c.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsCreateFileToolMetadata,
      () => new FsCreateFileTool(_c.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsDeletePathToolMetadata,
      () => new FsDeletePathTool(_c.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsMkdirToolMetadata,
      () => new FsMkdirTool(_c.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsExistsToolMetadata,
      () => new FsExistsTool(_c.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsInfoToolMetadata,
      () => new FsInfoTool(_c.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsListToolMetadata,
      () => new FsListTool(_c.resolve(tokens.WorkspaceFsFactory))
    );
    registry.register(
      FsTreeToolMetadata,
      () => new FsTreeTool(_c.resolve(tokens.WorkspaceFsFactory))
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
    registry.register(
      GrepCodeToolMetadata,
      (r) => new GrepCodeTool(r.resolve(tokens.WorkspaceRoot))
    );
    // HTTP tools
    registry.register(HttpFetchCommandMetadata, () => new HttpFetchCommand());
    registry.register(HttpCrawlCommandMetadata, () => new HttpCrawlCommand());
    // Additional editing tools
    registry.register(CodeSearchToolMetadata, () => new CodeSearchTool());
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
    registry.register(DelegateToAgentToolMetadata, (_r) => new DelegateToAgentCommand());
    registry.register(
      UpdateEmployeeLlmToolMetadata,
      (r) =>
        new UpdateEmployeeLlmTool(
          r.resolve(tokens.AgentManager),
          r.resolve(tokens.AgentDocumentStorage)
        )
    );
    registry.register(
      RegisterCliToolMetadata,
      (r) =>
        new RegisterCliTool(
          r.resolve(tokens.ConfigurationStorage) as any,
          r.resolve(tokens.AgentManager),
          r.resolve(tokens.AgentDocumentStorage)
        )
    );
    registry.register(
      SemanticSearchToolMetadata,
      (r) =>
        new SemanticSearchTool(
          r.resolve(tokens.WorkspaceRoot),
          r.resolve(tokens.FileAnnotationService)
        )
    );
    registry.register(
      GetErrorsToolMetadata,
      (r) =>
        new GetErrorsTool(
          r.resolve(tokens.WorkspaceRoot) as string,
          r.resolve(tokens.IdeAdapterFactory)
        )
    );
    // AskUserCommand is registered here so each invocation resolves the
    // current per-connection QuestionService via the container passed at
    // tool-resolution time (the scoped ToolManager's per-connection container).
    registry.register(
      AskUserCommandMetadata,
      (r) => new AskUserCommand(r.resolve(COMMAND_FACTORY_TOKENS.QuestionService))
    );
    registry.register(
      LlmCallCommandMetadata,
      (r) => new LlmCallCommand(r.resolve(COMMAND_FACTORY_TOKENS.LlmService))
    );
    registry.register(
      BootstrapFilesCommandMetadata,
      (r) => new BootstrapFilesCommand(r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot))
    );
    registry.register(
      PrepareOnboardingCommandMetadata,
      (r) =>
        new PrepareOnboardingCommand(
          r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
          r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService)
        )
    );
    registry.register(
      SaveTranscriptCommandMetadata,
      (r) => new SaveTranscriptCommand(r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot))
    );
    registry.register(
      SetPermissionsCommandMetadata,
      (r) => new SetPermissionsCommand(r.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage))
    );
    registry.register(
      NameSuggestionsCommandMetadata,
      (r) => new NameSuggestionsCommand(r.resolve(COMMAND_FACTORY_TOKENS.LlmService))
    );

    // Workflow tools registered as explicit native commands.
    registry.register(
      HireWorkflowMetadata,
      (r) => new HireWorkflowCommand(r.resolve(COMMAND_FACTORY_TOKENS.WorkflowRunnerFactory))
    );
    registry.register(
      OnboardingWorkflowMetadata,
      (r) =>
        new OnboardingWorkflowCommand(
          r.resolve(COMMAND_FACTORY_TOKENS.CommandDispatcher),
          r.resolve(COMMAND_FACTORY_TOKENS.WorkflowRunnerFactory)
        )
    );
    return registry;
  });

  // Register ToolManager with pure DI — resolves from registry and container.
  // registerScoped ensures each WebSocket connection gets its own ToolManager
  // instance bound to the per-connection child container, so tool factories
  // (e.g. AskUserCommand) resolve the live WsQuestionService rather than the
  // root-container no-op fallback.
  container.registerScoped(tokens.ToolManager, (c) => {
    const pathPermissionChecker = c.resolve(tokens.PathPermissionChecker);
    const registry = c.resolve(COMMAND_FACTORY_TOKENS.CommandRegistry);

    const manager = new ToolManager(pathPermissionChecker, registry, c);

    // Register orchestration tools (factory-constructed)
    const workflowCatalog = {
      listWorkflowIds(): string[] {
        return listWorkflowToolIds(registry);
      },
      async getWorkflowDefinition(workflowId: string) {
        const candidates = [workflowId, `workflow_${workflowId}`];

        for (const candidate of candidates) {
          const meta = registry.get(candidate);
          if (!meta?.availableIn?.tool) continue;

          const tool = registry.resolve(candidate, c) as
            | { getDefinition?: () => unknown }
            | undefined;
          if (tool?.getDefinition) {
            return tool.getDefinition() as import('@ai-team/api-contracts').WorkflowDefinitionApiResponse;
          }
        }

        throw new Error(`Workflow definition '${workflowId}' is not available.`);
      },
    };

    const workflowResolvers = getWorkflowDefinitionResolvers();

    // Register orchestration tools as direct tools on this manager instance
    // (not on the shared CommandRegistry) so that each scoped ToolManager can
    // add them independently without causing "Duplicate command key" errors.
    for (const tool of createOrchestrationTools(c, {
      tools: {
        whoCanExecute: (toolName: string, args: unknown, agents: import('@ai-team/core').Agent[]) =>
          manager.whoCanExecute(toolName, args, agents),
        catalog: (agent: import('@ai-team/core').Agent) => manager.catalog(agent),
      },
      workflows: workflowCatalog,
      workflowResolvers,
    })) {
      manager.register(tool);
    }

    return manager;
  });
  container.registerSingleton(tokens.ContextCompressor, () => new RecentTurnsContextCompressor());
  container.registerSingleton(tokens.ContextBuilder, () => new DefaultContextBuilder());
  container.registerSingleton(
    tokens.ToolSerializationService,
    () => new ToolSerializationService()
  );
  container.registerSingleton(
    tokens.ToolDispatchSupportService,
    (c) =>
      new ToolDispatchSupportService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.ToolSerializationService),
        c.resolve(tokens.LlmService),
        c.resolve(tokens.ProposalStoreFactory)
      )
  );
  container.registerSingleton(tokens.ContextEnrichers, (c) => [
    new WorkspaceOverviewEnricher(c.resolve(tokens.WorkspaceRoot)),
    new TeamRosterEnricher(c.resolve(tokens.AgentManager)),
  ]);
  container.registerSingleton(
    COMMAND_FACTORY_TOKENS.ToolSchemaService,
    (c) => new ToolSchemaService(c.resolve(COMMAND_FACTORY_TOKENS.ToolManager))
  );
  container.registerSingleton(
    tokens.RagProvider,
    (c) =>
      new SearchHintRagProvider(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.FileAnnotationService)
      )
  );
  container.registerSingleton(
    tokens.ToolResolver,
    (c) => new DefaultToolResolver(c.resolve(tokens.ToolManager))
  );
  container.registerSingleton(
    tokens.McpGateway,
    (c) => new RegistryMcpGateway(c.resolve(COMMAND_FACTORY_TOKENS.CommandRegistry), c)
  );
  container.registerSingleton(
    tokens.LlmSelector,
    (c) => new DefaultLlmSelector(c.resolve(tokens.LlmService))
  );
  container.registerSingleton(
    tokens.OutputHandler,
    (c) => new DefaultOutputHandler(c.resolve(COMMAND_FACTORY_TOKENS.EmitService))
  );
  container.registerSingleton(tokens.TurnResultParsers, (c) =>
    buildDefaultTurnResultParsers(c.resolve(tokens.AgentManager))
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
  container.registerSingleton(tokens.AgentsService, (c) => {
    const configStorage = c.resolve(tokens.ConfigurationStorage);
    return new AgentsService(
      c.resolve(tokens.WorkspaceRoot),
      c.resolve(tokens.AgentManager),
      configStorage.get(),
      c.resolve(tokens.PermissionStorage),
      c.resolve(tokens.MarkdownSectionService),
      c.resolve(tokens.FileAnnotationService)
    );
  });
  container.registerSingleton(
    tokens.TeamService,
    (c) => new TeamService(c.resolve(tokens.TeamGraphBuilder))
  );
  // Fallback QuestionService for the root container — satisfies the DI
  // requirement of InfoChatCommand at startup. Per-connection child containers
  // override this with a live WsQuestionService via registerInstance.
  container.registerSingleton(tokens.QuestionService, (): IQuestionService => {
    const noWs = (): never => {
      throw new Error('QuestionService: no active WebSocket connection');
    };
    return { input: noWs, confirm: noWs, select: noWs, password: noWs, checklist: noWs };
  });

  // InteractionService is registered as SCOPED (not singleton) to support child containers.
  // - CLI: resolves once from root container → console EmitService
  // - API: each WebSocket connection creates a child container with connection-scoped
  //   EmitService, and resolves InteractionService from that child → WebSocket EmitService
  // This ensures streaming events go to the correct destination (terminal or WebSocket).
  container.registerScoped(tokens.InteractionService, (c) =>
    buildInteractionService(c, cfg.workspaceRoot)
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
  container.registerSingleton(tokens.FilesService, (c) => {
    const configStorage = c.resolve(tokens.ConfigurationStorage);
    const fileTree = configStorage.get('fileTree') ?? {};
    return new FilesService(
      c.resolve(tokens.AgentManager),
      fileTree,
      c.resolve(tokens.PermissionStorage),
      new FileTreeService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.ConfigurationStorage),
        c.resolve(tokens.PermissionStorage),
        new GovernanceService(c.resolve(tokens.AgentManager), c.resolve(tokens.QuestionService)),
        c.resolve(tokens.FileTreeService)
      )
    );
  });
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
        c.resolve(tokens.ConfigurationStorage)
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
