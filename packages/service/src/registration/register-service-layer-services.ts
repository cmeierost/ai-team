import type {
  IContainerToken,
  IServiceContainer,
  IServiceContainerRegistrar,
  ILlmService,
  IChatManager,
} from '@ai-team/core';
import { createToolManager } from '../tools/create-tool-manager.js';
import { SessionManager } from '../session-manager.js';
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
import { buildDefaultSlashCommands } from '../orchestrator/slash-commands.js';
import {
  COMMAND_DEFINITION_REGISTRY_TOKEN,
  createCommandDefinitionRegistry,
} from '../types.js';
import {
  InfoChatCommand,
  ChatCommand,
  ChatInfoService,
  ChatPreflightService,
} from '../commands/chat/index.js';
import { InteractionService } from '../interaction-service.js';
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

export interface ServiceLayerRegistrationTokens {
  WorkspaceRoot: IContainerToken<any>;
  MessagesRepository: IContainerToken<any>;
  SessionsRepository: IContainerToken<any>;
  NotesRepository: IContainerToken<any>;
  AgentManager: IContainerToken<any>;
  NoteAttachmentReader: IContainerToken<any>;
  SessionManager: IContainerToken<any>;
  ToolManager: IContainerToken<any>;
  PathPermissionChecker: IContainerToken<any>;
  ChatStorage: IContainerToken<any>;
  ChatManager: IContainerToken<any>;

  ContextCompressor: IContainerToken<any>;
  ContextBuilder: IContainerToken<any>;
  ContextEnrichers: IContainerToken<any>;
  RagProvider: IContainerToken<any>;
  ToolResolver: IContainerToken<any>;
  McpGateway: IContainerToken<any>;
  LlmSelector: IContainerToken<any>;
  OutputHandler: IContainerToken<any>;
  SlashCommands: IContainerToken<any>;
  TurnResultParsers: IContainerToken<any>;
  HookPlugins: IContainerToken<any>;

  ApiBaseUrl: IContainerToken<any>;
  SystemInfoService: IContainerToken<any>;
  SystemService: IContainerToken<any>;
  AgentsService: IContainerToken<any>;
  TeamGraphBuilder: IContainerToken<any>;
  TeamService: IContainerToken<any>;
  InteractionService: IContainerToken<any>;
  ChatService: IContainerToken<any>;
  SessionsService: IContainerToken<any>;
  ArtifactsService: IContainerToken<any>;
  TasksService: IContainerToken<any>;
  PlanningService: IContainerToken<any>;
  DeveloperService: IContainerToken<any>;
  FilesService: IContainerToken<any>;
  IdeService: IContainerToken<any>;
  SkillsService: IContainerToken<any>;
  ToolsService: IContainerToken<any>;
  ConfigService: IContainerToken<any>;
  MetaService: IContainerToken<any>;
  CommandsService: IContainerToken<any>;
  ContextRuntime: IContainerToken<any>;
  AccessService: IContainerToken<any>;

  ConfigurationStorage: IContainerToken<any>;
  EnvironmentStorage: IContainerToken<any>;
  AgentDocumentStorage: IContainerToken<any>;
  LlmService: IContainerToken<any>;
  SkillManager: IContainerToken<any>;
  MarkdownSectionService: IContainerToken<any>;
  ProposalStoreFactory: IContainerToken<any>;
  ContextService: IContainerToken<any>;
  DeveloperIdentityService: IContainerToken<any>;

  ToolManagerForAgents?: IContainerToken<any>;
  PermissionStorage: IContainerToken<any>;
  FileAnnotationService: IContainerToken<any>;
  LlmProviderTester: IContainerToken<any>;
  FileTreeService: IContainerToken<any>;
  IdeAdapterFactory: IContainerToken<any>;
  WorkspaceAccessRuntime: IContainerToken<any>;
  PlanningRepository: IContainerToken<any>;
}

export interface ServiceLayerRegistrationConfig {
  workspaceRoot: string;
  apiBaseUrl?: string;
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

  container.registerSingleton(tokens.ToolManager, (c) => {
    const workspaceRoot = c.resolve(tokens.WorkspaceRoot) as string;
    return createToolManager(workspaceRoot, {
      pathPermissionChecker: c.resolve(tokens.PathPermissionChecker),
      container: c as unknown as IServiceContainer,
    });
  });
  container.registerSingleton(tokens.ContextCompressor, () => new NoOpCompressor());
  container.registerSingleton(tokens.ContextBuilder, () => new DefaultContextBuilder());
  container.registerSingleton(tokens.ContextEnrichers, (c) => [
    new WorkspaceOverviewEnricher(),
    new TeamRosterEnricher(c.resolve(tokens.AgentManager)),
  ]);
  container.registerSingleton(tokens.RagProvider, () => new NoOpRagProvider());
  container.registerSingleton(
    tokens.ToolResolver,
    (c) => new DefaultToolResolver(c.resolve(tokens.ToolManager))
  );
  container.registerSingleton(tokens.McpGateway, () => new NoOpMcpGateway());
  container.registerSingleton(tokens.LlmSelector, (c) => new DefaultLlmSelector(c.resolve(tokens.LlmService)));
  container.registerSingleton(tokens.OutputHandler, () => new DefaultOutputHandler());
  container.registerSingleton(tokens.SlashCommands, (c) =>
    buildDefaultSlashCommands(c.resolve(tokens.ToolManager) as any)
  );
  container.registerSingleton(tokens.TurnResultParsers, (c) => buildDefaultTurnResultParsers(c.resolve(tokens.AgentManager)));
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
  container.registerSingleton(tokens.InteractionService, (c) => {
    const cmd = new ChatCommand(
      {
        configurationStorage: c.resolve(tokens.ConfigurationStorage),
        environmentStorage: c.resolve(tokens.EnvironmentStorage),
        developerIdentityService: c.resolve(tokens.DeveloperIdentityService),
        ...(null as any), contextService: c.resolve(tokens.MetaService),
      },
      {
        agentManager: c.resolve(tokens.AgentManager),
        agentDocumentStorage: c.resolve(tokens.AgentDocumentStorage),
        markdownSectionService: c.resolve(tokens.MarkdownSectionService),
        skillManager: c.resolve(tokens.SkillManager),
      },
      {
        sessionManager: c.resolve(tokens.SessionManager),
        llmService: c.resolve(tokens.LlmService) as unknown as ILlmService,
        proposalStoreFactory: c.resolve(tokens.ProposalStoreFactory),
      },
      {
        pathPermissionChecker: c.resolve(tokens.PathPermissionChecker),
        serviceContainer: c as unknown as IServiceContainer,
      },
      new ChatInfoService(),
      new ChatPreflightService(
        c.resolve(tokens.ConfigurationStorage),
        c.resolve(tokens.EnvironmentStorage),
        c.resolve(tokens.DeveloperIdentityService)
      ),
      new InfoChatCommand(c.resolve(tokens.AgentManager))
    );

    const runChat = (
      workspaceRoot: string,
      agentId: string | undefined,
      options: unknown,
      hooks: unknown
    ) => cmd.execute(workspaceRoot, agentId, options as never, hooks as never);

    return new InteractionService(cfg.workspaceRoot, runChat);
  });

  container.registerSingleton(
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
  container.registerSingleton(
    tokens.SessionsService,
    (c) =>
      new SessionsService(
        c.resolve(tokens.SessionManager),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.LlmService) as unknown as ILlmService
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
        c.resolve(tokens.FileTreeService)
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
  container.registerSingleton(
    tokens.ToolsService,
    (c) =>
      new ToolsService(
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.ToolManager),
        c.resolve(tokens.McpGateway)
      )
  );
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
        c.resolve(tokens.ContextRuntime),
        c.resolve(tokens.AgentManager),
        c.resolve(tokens.WorkspaceAccessRuntime)
      )
  );
}
