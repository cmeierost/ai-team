import type {
  IChatSkillService,
  IChatRuntime,
  ILlmInvokeService,
  ISendTurnStepService,
  IToolDispatchService,
  ExecutionContext,
  IServiceContainer,
  IServiceContainerRegistrar,
} from '@ai-team/core';
import { CORE_SERVICE_TOKENS, Token } from '@ai-team/core';
import { CONTRACT_SERVICE_TOKENS } from '@ai-team/api-contracts';
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
import { TitleGenerator } from '../sessions/title-generator.js';
import { ThreadManager } from '../sessions/thread-manager.js';
import { NotesManager } from '../sessions/notes-manager.js';
import { ToolManager } from '../tooling/manager/tool-manager.js';
import { CommandRegistry } from '../command-dispatcher/command-registry.js';
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
import { WhoHasAccessTool, WhoHasAccessToolMetadata } from '../commands/fs/who-has-access.tool.js';
import {
  DoIHaveAccessTool,
  DoIHaveAccessToolMetadata,
} from '../commands/fs/do-i-have-access.tool.js';
import {
  AnalyzePermissionOverlapTool,
  AnalyzePermissionOverlapToolMetadata,
} from '../commands/fs/analyze-permission-overlap.tool.js';
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
import { ChatSkillService } from '../workflow/chat/chat-skill-service.js';
import { ToolDispatcher } from '../workflow/runtime/tools/tool-dispatch.js';
import { SendTurnStepService } from '../workflow/chat/send-turn-step-service.js';
import { LlmInvokeService } from '../llm/llm-invoke.js';
import { createCommandDispatcher } from '../command-dispatcher/command-dispatcher.js';
import {
  InteractionService,
} from '../interaction/interaction-service.js';
import type { ChatOptions, IInteractionService, WorkflowCallbacks } from '@ai-team/api-contracts';
import { WorkflowRunnerFactory } from '../workflow/index.js';
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

/**
 * Tokens that are truly local to the service layer (not in core or contracts).
 */
const LOCAL_SERVICE_TOKENS = {
  ApiBaseUrl: new Token<string>('ApiBaseUrl'),
  InteractionService: new Token<IInteractionService>('IInteractionService'),
  ContextRuntime: new Token<any>('ContextRuntime'),
} as const;

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
  const dispatcher = c.resolve(CORE_SERVICE_TOKENS.CommandDispatcher);

  const runChat = async (
    _wr: string,
    agentId: string | undefined,
    options: ChatOptions,
    _callbacks: WorkflowCallbacks,
    ctx: ExecutionContext
  ) => {
    const response = await dispatcher.dispatch(
      'chat-chat',
      {
        agentId,
        message: options?.message,
        sessionId: options?.sessionId,
        createNewSession: options?.createNewSession,
      },
      ctx
    );

    if (response.status === 'error') {
      throw new Error(response.message || 'chat dispatch failed');
    }
  };

  return new InteractionService(workspaceRoot, runChat);
}

export function registerServiceLayerServices(
  container: IServiceContainerRegistrar,
  cfg: ServiceLayerRegistrationConfig
): void {
  // ── Session managers (dependency order: TitleGenerator → SessionManager → ThreadManager) ──
  container.registerSingleton(
    CORE_SERVICE_TOKENS.TitleGenerator,
    (c) =>
      new TitleGenerator(
        c.resolve(CORE_SERVICE_TOKENS.MessagesRepository),
        c.resolve(CORE_SERVICE_TOKENS.SessionsRepository)
      )
  );

  container.registerSingleton(
    CORE_SERVICE_TOKENS.SessionManager,
    (c) =>
      new SessionManager(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.MessagesRepository),
        c.resolve(CORE_SERVICE_TOKENS.SessionsRepository),
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.TitleGenerator)
      )
  );

  container.registerSingleton(
    CORE_SERVICE_TOKENS.ThreadManager,
    (c) =>
      new ThreadManager(
        c.resolve(CORE_SERVICE_TOKENS.SessionManager),
        c.resolve(CORE_SERVICE_TOKENS.SessionsRepository),
        c.resolve(CORE_SERVICE_TOKENS.NotesRepository)
      )
  );

  container.registerSingleton(
    CORE_SERVICE_TOKENS.NotesManager,
    (c) =>
      new NotesManager(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.NotesRepository),
        c.resolve(CORE_SERVICE_TOKENS.NoteAttachmentReader),
        c.resolve(CORE_SERVICE_TOKENS.LlmService)
      )
  );

  container.registerScoped(
    CORE_SERVICE_TOKENS.WorkflowRunnerFactory,
    (_c) => new WorkflowRunnerFactory(_c.child())
  );

  container.registerScoped(CORE_SERVICE_TOKENS.CommandDispatcher, (c) =>
    createCommandDispatcher(c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot), c)
  );

  container.registerScoped(
    CORE_SERVICE_TOKENS.ChatRuntime,
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
  container.registerSingleton(CORE_SERVICE_TOKENS.CommandRegistry, (_c) => {
    const registry = new CommandRegistry();
    // File system tools
    registry.register(
      FsReadFileToolMetadata,
      (r) =>
        new FsReadFileTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory)
        )
    );
    registry.register(
      FsReadLinesToolMetadata,
      (r) =>
        new FsReadLinesTool(
          new FsReadFileTool(
            r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
            r.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory)
          )
        )
    );
    registry.register(
      FsWriteFileToolMetadata,
      () => new FsWriteFileTool(_c.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory))
    );
    registry.register(
      FsCreateFileToolMetadata,
      () => new FsCreateFileTool(_c.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory))
    );
    registry.register(
      FsDeletePathToolMetadata,
      () => new FsDeletePathTool(_c.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory))
    );
    registry.register(
      FsMkdirToolMetadata,
      () => new FsMkdirTool(_c.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory))
    );
    registry.register(
      FsExistsToolMetadata,
      () => new FsExistsTool(_c.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory))
    );
    registry.register(
      FsInfoToolMetadata,
      () => new FsInfoTool(_c.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory))
    );
    registry.register(
      FsListToolMetadata,
      () => new FsListTool(_c.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory))
    );
    registry.register(
      FsTreeToolMetadata,
      () => new FsTreeTool(_c.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory))
    );
    registry.register(
      FsSearchContentToolMetadata,
      (r) =>
        new FsSearchContentTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory)
        )
    );
    registry.register(
      FsSearchMetadataToolMetadata,
      (r) =>
        new FsSearchMetadataTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceFsFactory)
        )
    );
    // File system access tools
    registry.register(
      WhoHasAccessToolMetadata,
      (r) =>
        new WhoHasAccessTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.AgentManager),
          r.resolve(CORE_SERVICE_TOKENS.PathPermissionChecker)
        )
    );
    registry.register(
      DoIHaveAccessToolMetadata,
      (r) =>
        new DoIHaveAccessTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.AgentManager),
          r.resolve(CORE_SERVICE_TOKENS.PathPermissionChecker)
        )
    );
    registry.register(
      AnalyzePermissionOverlapToolMetadata,
      (r) => new AnalyzePermissionOverlapTool(r.resolve(CORE_SERVICE_TOKENS.AgentManager))
    );
    // Code analysis and editing tools
    registry.register(
      FindSymbolToolMetadata,
      (r) =>
        new FindSymbolTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
        )
    );
    registry.register(
      FindReferencesToolMetadata,
      (r) =>
        new FindReferencesTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
        )
    );
    registry.register(
      LspToolMetadata,
      (r) =>
        new LspTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
        )
    );
    registry.register(
      GrepCodeToolMetadata,
      (r) => new GrepCodeTool(r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot))
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
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.PathPermissionChecker),
          r.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
        )
    );
    registry.register(
      ApplyPatchToolMetadata,
      (r) =>
        new ApplyPatchTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.PathPermissionChecker),
          r.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
        )
    );
    registry.register(
      MultiEditToolMetadata,
      (r) =>
        new MultiEditTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          new FsEditTool(
            r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
            r.resolve(CORE_SERVICE_TOKENS.PathPermissionChecker),
            r.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
          ),
          r.resolve(CORE_SERVICE_TOKENS.PathPermissionChecker),
          r.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
        )
    );
    registry.register(DelegateToAgentToolMetadata, (_r) => new DelegateToAgentCommand());
    registry.register(
      UpdateEmployeeLlmToolMetadata,
      (r) =>
        new UpdateEmployeeLlmTool(
          r.resolve(CORE_SERVICE_TOKENS.AgentManager),
          r.resolve(CORE_SERVICE_TOKENS.AgentDocumentStorage)
        )
    );
    registry.register(
      RegisterCliToolMetadata,
      (r) =>
        new RegisterCliTool(
          r.resolve(CORE_SERVICE_TOKENS.ConfigurationStorage),
          r.resolve(CORE_SERVICE_TOKENS.AgentManager),
          r.resolve(CORE_SERVICE_TOKENS.AgentDocumentStorage)
        )
    );
    registry.register(
      SemanticSearchToolMetadata,
      (r) =>
        new SemanticSearchTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.FileAnnotationService)
        )
    );
    registry.register(
      GetErrorsToolMetadata,
      (r) =>
        new GetErrorsTool(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
        )
    );
    // AskUserCommand is registered here so each invocation resolves the
    // current per-connection QuestionService via the container passed at
    // tool-resolution time (the scoped ToolManager's per-connection container).
    registry.register(
      AskUserCommandMetadata,
      (r) => new AskUserCommand(r.resolve(CORE_SERVICE_TOKENS.QuestionService))
    );
    registry.register(
      LlmCallCommandMetadata,
      (r) => new LlmCallCommand(r.resolve(CORE_SERVICE_TOKENS.LlmService))
    );
    registry.register(
      BootstrapFilesCommandMetadata,
      (r) => new BootstrapFilesCommand(r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot))
    );
    registry.register(
      PrepareOnboardingCommandMetadata,
      (r) =>
        new PrepareOnboardingCommand(
          r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
          r.resolve(CORE_SERVICE_TOKENS.DeveloperIdentityService)
        )
    );
    registry.register(
      SaveTranscriptCommandMetadata,
      (r) => new SaveTranscriptCommand(r.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot))
    );
    registry.register(
      SetPermissionsCommandMetadata,
      (r) => new SetPermissionsCommand(r.resolve(CORE_SERVICE_TOKENS.PermissionStorage))
    );
    registry.register(
      NameSuggestionsCommandMetadata,
      (r) => new NameSuggestionsCommand(r.resolve(CORE_SERVICE_TOKENS.LlmService))
    );

    // Workflow tools registered as explicit native commands.
    registry.register(
      HireWorkflowMetadata,
      (r) => new HireWorkflowCommand(r.resolve(CORE_SERVICE_TOKENS.WorkflowRunnerFactory))
    );
    registry.register(
      OnboardingWorkflowMetadata,
      (r) =>
        new OnboardingWorkflowCommand(
          r.resolve(CORE_SERVICE_TOKENS.CommandDispatcher),
          r.resolve(CORE_SERVICE_TOKENS.WorkflowRunnerFactory)
        )
    );
    return registry;
  });

  // Register ToolManager with pure DI — resolves from registry and container.
  // registerScoped ensures each WebSocket connection gets its own ToolManager
  // instance bound to the per-connection child container, so tool factories
  // (e.g. AskUserCommand) resolve the live WsQuestionService rather than the
  // root-container no-op fallback.
  container.registerScoped(CORE_SERVICE_TOKENS.ToolManager, (c) => {
    const pathPermissionChecker = c.resolve(CORE_SERVICE_TOKENS.PathPermissionChecker);
    const registry = c.resolve(CORE_SERVICE_TOKENS.CommandRegistry);

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
  container.registerSingleton(
    CORE_SERVICE_TOKENS.ContextCompressor,
    () => new RecentTurnsContextCompressor()
  );
  container.registerSingleton(
    CORE_SERVICE_TOKENS.ContextBuilder,
    () => new DefaultContextBuilder()
  );
  container.registerSingleton(
    CORE_SERVICE_TOKENS.ToolSerializationService,
    () => new ToolSerializationService()
  );
  container.registerSingleton(
    CORE_SERVICE_TOKENS.ToolDispatchSupportService,
    (c) =>
      new ToolDispatchSupportService(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.ToolSerializationService),
        c.resolve(CORE_SERVICE_TOKENS.LlmService),
        c.resolve(CORE_SERVICE_TOKENS.ProposalStoreFactory)
      )
  );
  container.registerSingleton(CORE_SERVICE_TOKENS.ContextEnrichers, (c) => [
    new WorkspaceOverviewEnricher(c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot)),
    new TeamRosterEnricher(c.resolve(CORE_SERVICE_TOKENS.AgentManager)),
  ]);
  container.registerSingleton(
    CORE_SERVICE_TOKENS.ToolSchemaService,
    (c) => new ToolSchemaService(c.resolve(CORE_SERVICE_TOKENS.ToolManager))
  );
  container.registerScoped(
    CORE_SERVICE_TOKENS.ChatSkillService,
    (c): IChatSkillService =>
      new ChatSkillService({
        skillManager: c.resolve(CORE_SERVICE_TOKENS.SkillManager),
        sessionManager: c.resolve(CORE_SERVICE_TOKENS.SessionManager),
        emitService: c.resolve(CORE_SERVICE_TOKENS.EmitService),
        workspaceRoot: c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
      })
  );
  container.registerScoped(
    CORE_SERVICE_TOKENS.ToolDispatcher,
    (c): IToolDispatchService =>
      new ToolDispatcher(
        c.resolve(CORE_SERVICE_TOKENS.ToolManager),
        c.resolve(CORE_SERVICE_TOKENS.SessionManager),
        c.resolve(CORE_SERVICE_TOKENS.ToolDispatchSupportService),
        c.resolve(CORE_SERVICE_TOKENS.QuestionService),
        c.resolve(CORE_SERVICE_TOKENS.EmitService)
      )
  );
  container.registerScoped(
    CORE_SERVICE_TOKENS.LlmInvokeService,
    (c): ILlmInvokeService =>
      new LlmInvokeService(
        c.resolve(CORE_SERVICE_TOKENS.LlmService),
        c.resolve(CORE_SERVICE_TOKENS.EmitService),
        c.resolve(CORE_SERVICE_TOKENS.ToolDispatcher)
      )
  );
  container.registerScoped(
    CORE_SERVICE_TOKENS.SendTurnStepService,
    (c): ISendTurnStepService =>
      new SendTurnStepService(
        c.resolve(CORE_SERVICE_TOKENS.SessionManager),
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.ChatSkillService),
        c.resolve(CORE_SERVICE_TOKENS.LlmService),
        c.resolve(CORE_SERVICE_TOKENS.LlmInvokeService),
        c.resolve(CORE_SERVICE_TOKENS.ToolDispatcher),
        c.resolve(CORE_SERVICE_TOKENS.ToolSchemaService),
        {},
        c.resolve(CORE_SERVICE_TOKENS.EmitService)
      )
  );
  container.registerSingleton(
    CORE_SERVICE_TOKENS.RagProvider,
    (c) =>
      new SearchHintRagProvider(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.FileAnnotationService)
      )
  );
  container.registerSingleton(
    CORE_SERVICE_TOKENS.ToolResolver,
    (c) => new DefaultToolResolver(c.resolve(CORE_SERVICE_TOKENS.ToolManager))
  );
  container.registerSingleton(
    CORE_SERVICE_TOKENS.McpGateway,
    (c) => new RegistryMcpGateway(c.resolve(CORE_SERVICE_TOKENS.CommandRegistry), c)
  );
  container.registerSingleton(
    CORE_SERVICE_TOKENS.LlmSelector,
    (c) => new DefaultLlmSelector(c.resolve(CORE_SERVICE_TOKENS.LlmService))
  );
  container.registerSingleton(
    CORE_SERVICE_TOKENS.OutputHandler,
    (c) => new DefaultOutputHandler(c.resolve(CORE_SERVICE_TOKENS.EmitService))
  );
  container.registerSingleton(CORE_SERVICE_TOKENS.TurnResultParsers, (c) =>
    buildDefaultTurnResultParsers(c.resolve(CORE_SERVICE_TOKENS.AgentManager))
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.SystemService,
    (c) =>
      new SystemService(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(LOCAL_SERVICE_TOKENS.ApiBaseUrl),
        c.resolve(CORE_SERVICE_TOKENS.SystemInfoService)
      )
  );
  container.registerSingleton(CONTRACT_SERVICE_TOKENS.AgentsService, (c) => {
    const configStorage = c.resolve(CORE_SERVICE_TOKENS.ConfigurationStorage);
    return new AgentsService(
      c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
      c.resolve(CORE_SERVICE_TOKENS.AgentManager),
      configStorage.get(),
      c.resolve(CORE_SERVICE_TOKENS.PermissionStorage),
      c.resolve(CORE_SERVICE_TOKENS.MarkdownSectionService),
      c.resolve(CORE_SERVICE_TOKENS.FileAnnotationService)
    );
  });
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.TeamService,
    (c) => new TeamService(c.resolve(CORE_SERVICE_TOKENS.TeamGraphBuilder))
  );

  // InteractionService is registered as SCOPED (not singleton) to support child containers.
  // - CLI: resolves once from root container → console EmitService
  // - API: each WebSocket connection creates a child container with connection-scoped
  //   EmitService, and resolves InteractionService from that child → WebSocket EmitService
  // This ensures streaming events go to the correct destination (terminal or WebSocket).
  container.registerScoped(LOCAL_SERVICE_TOKENS.InteractionService, (c) =>
    buildInteractionService(c, cfg.workspaceRoot)
  );

  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.ChatService,
    (c) =>
      new ChatService(
        c.resolve(LOCAL_SERVICE_TOKENS.InteractionService),
        c.resolve(CORE_SERVICE_TOKENS.SessionManager),
        c.resolve(CORE_SERVICE_TOKENS.TitleGenerator),
        c.resolve(CORE_SERVICE_TOKENS.ChatManager),
        c.resolve(CORE_SERVICE_TOKENS.ChatStorage),
        c.resolve(CORE_SERVICE_TOKENS.LlmService)
      )
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.SessionsService,
    (c) =>
      new SessionsService(
        c.resolve(CORE_SERVICE_TOKENS.SessionManager),
        c.resolve(CORE_SERVICE_TOKENS.ThreadManager),
        c.resolve(CORE_SERVICE_TOKENS.NotesManager),
        c.resolve(CORE_SERVICE_TOKENS.TitleGenerator),
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.LlmService)
      )
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.ArtifactsService,
    (c) => new ArtifactsService(c.resolve(CORE_SERVICE_TOKENS.SessionManager))
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.TasksService,
    (c) =>
      new TasksService(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.AgentManager)
      )
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.PlanningService,
    (c) => new PlanningService(c.resolve(CORE_SERVICE_TOKENS.PlanningRepository))
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.DeveloperService,
    (c) => new DeveloperService(c.resolve(CORE_SERVICE_TOKENS.DeveloperIdentityService))
  );
  container.registerSingleton(CONTRACT_SERVICE_TOKENS.FilesService, (c) => {
    const configStorage = c.resolve(CORE_SERVICE_TOKENS.ConfigurationStorage);
    const fileTree = configStorage.get('fileTree') ?? {};
    return new FilesService(
      c.resolve(CORE_SERVICE_TOKENS.AgentManager),
      fileTree,
      c.resolve(CORE_SERVICE_TOKENS.PermissionStorage),
      new FileTreeService(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.ConfigurationStorage),
        c.resolve(CORE_SERVICE_TOKENS.PermissionStorage),
        new GovernanceService(
          c.resolve(CORE_SERVICE_TOKENS.AgentManager),
          c.resolve(CORE_SERVICE_TOKENS.QuestionService)
        ),
        c.resolve(CORE_SERVICE_TOKENS.FileTreeService),
        c.resolve(CORE_SERVICE_TOKENS.FileAnnotationService)
      )
    );
  });
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.IdeService,
    (c) =>
      new IdeService(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.IdeAdapterFactory)
      )
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.SkillsService,
    (c) =>
      new SkillsService(
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.SkillManager),
        c.resolve(CORE_SERVICE_TOKENS.MarkdownSectionService)
      )
  );
  container.registerSingleton(CONTRACT_SERVICE_TOKENS.ToolsService, (c) => {
    const governanceService = new GovernanceService(
      c.resolve(CORE_SERVICE_TOKENS.AgentManager),
      c.resolve(CORE_SERVICE_TOKENS.QuestionService)
    );
    return new ToolsService(
      new AgentToolsService(
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.ToolManager),
        governanceService,
        c.resolve(CORE_SERVICE_TOKENS.McpGateway)
      ),
      governanceService
    );
  });
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.ConfigService,
    (c) =>
      new ConfigService(
        cfg.workspaceRoot,
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.ConfigurationStorage)
      )
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.MetaService,
    (c) =>
      new MetaService(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.SessionManager),
        c.resolve(CORE_SERVICE_TOKENS.NotesManager),
        c.resolve(CORE_SERVICE_TOKENS.SkillManager),
        c.resolve(CORE_SERVICE_TOKENS.ToolManager),
        c.resolve(CORE_SERVICE_TOKENS.AgentDocumentStorage),
        c.resolve(CORE_SERVICE_TOKENS.McpGateway),
        c.resolve(CONTRACT_SERVICE_TOKENS.PlanningService)
      )
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.CommandsService,
    (c) =>
      new CommandsService(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(CORE_SERVICE_TOKENS.CommandRegistry),
        c.resolve(CORE_SERVICE_TOKENS.SkillManager),
        c.resolve(CORE_SERVICE_TOKENS.ConfigurationStorage),
        c.resolve(CORE_SERVICE_TOKENS.EmitService),
        c.resolve(CORE_SERVICE_TOKENS.SessionManager),
        c.resolve(CORE_SERVICE_TOKENS.ToolManager)
      )
  );
  container.registerSingleton(
    CONTRACT_SERVICE_TOKENS.AccessService,
    (c) =>
      new AccessService(
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot),
        c.resolve(LOCAL_SERVICE_TOKENS.ContextRuntime),
        c.resolve(CORE_SERVICE_TOKENS.AgentManager),
        c.resolve(CORE_SERVICE_TOKENS.WorkspaceAccessRuntime)
      )
  );
}
