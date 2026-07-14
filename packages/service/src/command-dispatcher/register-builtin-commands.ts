import type { ICommandRegistry, IServiceContainer, TeamConfig } from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import { EmitService } from '../interaction/emit-service.js';
import {
  AccessCanCommand,
  AccessCanCommandMetadata,
} from '../commands/access/access-can.command.js';
import {
  AccessOverlapCommand,
  AccessOverlapCommandMetadata,
} from '../commands/access/access-overlap.command.js';
import {
  AccessWhoCommand,
  AccessWhoCommandMetadata,
} from '../commands/access/access-who.command.js';
import { AvatarCommand, AvatarCommandMetadata } from '../commands/hr/avatar.command.js';
import { CreateICommand, CreateICommandMetadata } from '../commands/hr/create.command.js';
import {
  CodeEditApplyCommand,
  CodeEditApplyCommandMetadata,
} from '../commands/edit/edit-apply.command.js';
import {
  CodeEditApproveCommand,
  CodeEditApproveCommandMetadata,
} from '../commands/edit/edit-approve.command.js';
import {
  CodeEditListCommand,
  CodeEditListCommandMetadata,
} from '../commands/edit/edit-list.command.js';
import {
  CodeEditRejectCommand,
  CodeEditRejectCommandMetadata,
} from '../commands/edit/edit-reject.command.js';
import { DbMigrateCommand, DbMigrateCommandMetadata } from '../commands/db/db-migrate.command.js';
import { DbStatusCommand, DbStatusCommandMetadata } from '../commands/db/db-status.command.js';
import {
  FilesAllowCommand,
  FilesAllowCommandMetadata,
} from '../commands/fs/files-allow.command.js';
import { FilesDenyCommand, FilesDenyCommandMetadata } from '../commands/fs/files-deny.command.js';
import {
  FilesPatternsCommand,
  FilesPatternsCommandMetadata,
} from '../commands/fs/files-patterns.command.js';
import { FileTreeService } from '../commands/fs/file-tree.js';
import { FireICommand, FireICommandMetadata } from '../commands/hr/fire.command.js';
import { GraphCommand, GraphCommandMetadata } from '../commands/team/team-graph.command.js';
import { HhRefreshCommand, HhRefreshCommandMetadata } from '../commands/hr/hr-refresh.command.js';
import { HireICommand, HireICommandMetadata } from '../commands/hr/hire.command.js';
import { OrgCommand, OrgCommandMetadata } from '../commands/team/team-org.command.js';
import {
  PatchApplyCommand,
  PatchApplyCommandMetadata,
} from '../commands/edit/edit-patch.command.js';
import {
  ResolveEmployeesICommand,
  ResolveEmployeesICommandMetadata,
} from '../commands/team/team-resolve.command.js';
import {
  SearchAgentsICommand,
  SearchAgentsICommandMetadata,
} from '../commands/team/team-search.command.js';
import { TeamListICommand, TeamListICommandMetadata } from '../commands/team/team-list.command.js';
import {
  SkillsAddCommand,
  SkillsAddCommandMetadata,
} from '../commands/skills/skills-add.command.js';
import {
  SkillsListCommand,
  SkillsListCommandMetadata,
} from '../commands/skills/skills-list.command.js';
import {
  SkillsRemoveCommand,
  SkillsRemoveCommandMetadata,
} from '../commands/skills/skills-remove.command.js';
import { InitICommand, InitICommandMetadata } from '../commands/init/init.command.js';
import { SetupICommand, SetupICommandMetadata } from '../commands/setup/setup.command.js';
import { OnboardICommand, OnboardICommandMetadata } from '../commands/hr/onboard.js';
import { SetupCommand } from '../commands/setup/setup.js';
import {
  ProviderICommand,
  ProviderCommandMetadata,
} from '../commands/setup/setup-provider.command.js';
import {
  ProviderListICommand,
  ProviderListICommandMetadata,
  ProviderModelsICommand,
  ProviderModelsICommandMetadata,
  ProviderModelsRefreshICommand,
  ProviderModelsRefreshICommandMetadata,
} from '../commands/setup/setup-models.command.js';
import {
  SystemInfoCommand,
  SystemInfoCommandMetadata,
} from '../commands/system/system-info.command.js';
import { ExitChatCommand, ExitChatCommandMetadata } from '../commands/system/exit.command.js';
import {
  SystemStatusICommand,
  SystemStatusICommandMetadata,
} from '../commands/setup/system-status.js';
import {
  TestConnectionICommand,
  TestConnectionICommandMetadata,
} from '../commands/setup/setup-test.command.js';
import { TestConnectionCommand } from '../commands/setup/test-connection.js';
import {
  ToolsAllowCommand,
  ToolsAllowCommandMetadata,
} from '../commands/tools/tools-allow.command.js';
import {
  ToolsDenyCommand,
  ToolsDenyCommandMetadata,
} from '../commands/tools/tools-deny.command.js';
import {
  ToolsListCommand,
  ToolsListCommandMetadata,
} from '../commands/tools/tools-list.command.js';
import { AgentToolsService } from '../commands/tools/tools-service.js';
import { GovernanceService } from '../governance/governance-service.js';
import { ChatCommand } from '../commands/chat/chat.command.js';
import { ChatStartupCommand } from '../commands/chat/chat-startup.command.js';
import { ChatTurnCommand } from '../commands/chat/chat-turn.command.js';
import { IntroductionCommand } from '../commands/chat/introduction.command.js';
import { ResolveChatSessionCommand } from '../commands/chat/resolve-chat-session.command.js';
import { LoadSessionMessagesCommand } from '../commands/chat/load-session-messages.command.js';
import { ChatInfoService } from '../commands/chat/chat-info-service.js';
import { HelpChatCommand } from '../commands/help/help.command.js';
import { MetaService } from '../routers/meta-service.js';
import { InfoChatCommand, InfoChatCommandMetadata } from '../commands/agents/info.command.js';
import {
  TeamListChatCommand,
  TeamListChatCommandMetadata,
} from '../commands/agents/team-list.command.js';
import {
  OverviewChatCommand,
  OverviewChatCommandMetadata,
} from '../commands/help/overview.command.js';
import {
  SwitchChatCommand,
  SwitchChatCommandMetadata,
} from '../commands/session/switch-chat.command.js';
import {
  HandoffChatCommand,
  HandoffChatCommandMetadata,
} from '../commands/chat/handoff.command.js';
import {
  NewSessionChatCommand,
  NewSessionChatCommandMetadata,
} from '../commands/session/new-session-chat.command.js';
import { BackChatCommand, BackChatCommandMetadata } from '../commands/session/back.command.js';
import {
  HistoryChatCommand,
  HistoryChatCommandMetadata,
} from '../commands/session/history-chat.command.js';
import {
  InspectChatCommand,
  InspectChatCommandMetadata,
} from '../commands/session/inspect-chat.command.js';
import {
  ContextAddChatCommand,
  ContextAddChatCommandMetadata,
} from '../commands/session/context-add.command.js';
import {
  ContextRemoveChatCommand,
  ContextRemoveChatCommandMetadata,
} from '../commands/session/context-remove.command.js';
import {
  ContextListChatCommand,
  ContextListChatCommandMetadata,
} from '../commands/session/context-list.command.js';
import {
  ContextSummarizeChatCommand,
  ContextSummarizeChatCommandMetadata,
} from '../commands/session/context-summarize.command.js';
import {
  SessionInfoChatCommand,
  SessionInfoChatCommandMetadata,
} from '../commands/session/session-info.command.js';
import {
  SessionMessagesChatCommand,
  SessionMessagesChatCommandMetadata,
} from '../commands/session/session-messages.command.js';
import {
  SessionGraphChatCommand,
  SessionGraphChatCommandMetadata,
} from '../commands/session/session-graph.command.js';
import {
  SessionContextChatCommand,
  SessionContextChatCommandMetadata,
} from '../commands/session/session-context.command.js';
import {
  HttpFetchChatCommand,
  HttpFetchChatCommandMetadata,
} from '../commands/http/http-fetch-chat.command.js';
import {
  HttpCrawlChatCommand,
  HttpCrawlChatCommandMetadata,
} from '../commands/http/http-crawl-chat.command.js';
import { RunShellChatCommand, RunShellChatCommandMetadata } from '../commands/cli/run.command.js';
import {
  ListWorkflowsOrchestrationCommand,
  ListWorkflowsOrchestrationCommandMetadata,
} from '../commands/workflow/workflow-tools.command.js';
import { listWorkflowToolIds } from '../commands/workflow/workflow-catalog.js';

export function registerBuiltInCommands(
  registry: ICommandRegistry,
  scopedResolver: IServiceContainer
): void {
  scopedResolver.registerTransient(COMMAND_FACTORY_TOKENS.ContextService, (r) => {
    return new MetaService(
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
      r.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
      r.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
      r.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage)
    );
  });

  registry.register(
    AccessCanCommandMetadata,
    (r) =>
      new AccessCanCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
      )
  );

  registry.register(
    AccessOverlapCommandMetadata,
    (r) => new AccessOverlapCommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(
    AccessWhoCommandMetadata,
    (r) =>
      new AccessWhoCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
      )
  );

  registry.register(
    TeamListICommandMetadata,
    (r) => new TeamListICommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(InitICommandMetadata, (r) => {
    const setupCmd = new SetupCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceStorage),
      r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
      r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
      r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
    );
    const onboardCmd = new OnboardICommand(
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
      r
    );
    return new InitICommand(
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
      onboardCmd,
      setupCmd,
      new TestConnectionCommand(
        null as any,
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        r.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
      ),
      r.resolve(COMMAND_FACTORY_TOKENS.WorkflowRunnerFactory)
    );
  });

  registry.register(
    SetupICommandMetadata,
    (r) =>
      new SetupICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        new SetupCommand(
          r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
          r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceStorage),
          r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
          r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
          r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
          r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
          r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
        )
      )
  );

  registry.register(
    OnboardICommandMetadata,
    (r) =>
      new OnboardICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
        r
      )
  );

  registry.register(SystemStatusICommandMetadata, (r) => {
    const configStorage = r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage);
    return new SystemStatusICommand(
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      configStorage.get() as TeamConfig
    );
  });

  registry.register(ProviderCommandMetadata, (r) => {
    return new ProviderICommand(
      r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
      r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      r.resolve(COMMAND_FACTORY_TOKENS.ProviderConfigurationService)
    );
  });

  registry.register(
    ProviderListICommandMetadata,
    (r) =>
      new ProviderListICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
  );

  registry.register(
    ProviderModelsICommandMetadata,
    (r) =>
      new ProviderModelsICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
  );

  registry.register(
    ProviderModelsRefreshICommandMetadata,
    (r) =>
      new ProviderModelsRefreshICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
  );

  registry.register(
    SearchAgentsICommandMetadata,
    (r) => new SearchAgentsICommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(
    ResolveEmployeesICommandMetadata,
    (r) => new ResolveEmployeesICommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(
    SkillsListCommandMetadata,
    (r) =>
      new SkillsListCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SkillManager)
      )
  );

  registry.register(
    SkillsAddCommandMetadata,
    (r) =>
      new SkillsAddCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        r.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
      )
  );

  registry.register(
    SkillsRemoveCommandMetadata,
    (r) =>
      new SkillsRemoveCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        r.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
      )
  );

  registry.register(
    ToolsListCommandMetadata,
    (r) =>
      new ToolsListCommand(
        new AgentToolsService(
          r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          r.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
          new GovernanceService(
            r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
            r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
          )
        )
      )
  );

  registry.register(
    ToolsAllowCommandMetadata,
    (r) =>
      new ToolsAllowCommand(
        new AgentToolsService(
          r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          r.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
          new GovernanceService(
            r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
            r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
          )
        )
      )
  );

  registry.register(
    ToolsDenyCommandMetadata,
    (r) =>
      new ToolsDenyCommand(
        new AgentToolsService(
          r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          r.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
          new GovernanceService(
            r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
            r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
          )
        )
      )
  );

  registry.register(FilesAllowCommandMetadata, (r) => {
    const governance = new GovernanceService(
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    );
    return new FilesAllowCommand(
      new FileTreeService(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        governance,
        r.resolve(COMMAND_FACTORY_TOKENS.FileTreeService),
        r.resolve(COMMAND_FACTORY_TOKENS.FileAnnotationService)
      ),
      governance
    );
  });

  registry.register(FilesDenyCommandMetadata, (r) => {
    const governance = new GovernanceService(
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    );
    return new FilesDenyCommand(
      new FileTreeService(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        governance,
        r.resolve(COMMAND_FACTORY_TOKENS.FileTreeService),
        r.resolve(COMMAND_FACTORY_TOKENS.FileAnnotationService)
      ),
      governance
    );
  });

  registry.register(FilesPatternsCommandMetadata, (r) => {
    const configStorage = r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage);
    const fileTree = configStorage.get('fileTree') ?? {};
    return new FilesPatternsCommand(
      fileTree,
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage)
    );
  });

  registry.register(
    GraphCommandMetadata,
    (r) => new GraphCommand(r.resolve(COMMAND_FACTORY_TOKENS.TeamGraphBuilder))
  );

  registry.register(
    OrgCommandMetadata,
    (r) => new OrgCommand(r.resolve(COMMAND_FACTORY_TOKENS.TeamGraphBuilder))
  );

  registry.register(
    HireICommandMetadata,
    (r) =>
      new HireICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
      )
  );

  registry.register(
    FireICommandMetadata,
    (r) =>
      new FireICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
        r.resolve(COMMAND_FACTORY_TOKENS.WorkflowRunnerFactory)
      )
  );

  registry.register(
    CreateICommandMetadata,
    (r) =>
      new CreateICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
      )
  );

  registry.register(AvatarCommandMetadata, (r) => {
    const configStorage = r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage);
    return new AvatarCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      configStorage.get(),
      r.resolve(COMMAND_FACTORY_TOKENS.AvatarManager),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
    );
  });

  registry.register(
    HhRefreshCommandMetadata,
    (r) => new HhRefreshCommand(r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot))
  );

  registry.register(
    SystemInfoCommandMetadata,
    (r) =>
      new SystemInfoCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.SystemInfoService)
      )
  );

  registry.register(ExitChatCommandMetadata, (_r) => new ExitChatCommand());

  registry.register(
    TestConnectionICommandMetadata,
    (r) =>
      new TestConnectionICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        r.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
      )
  );

  registry.register(
    DbMigrateCommandMetadata,
    (r) => new DbMigrateCommand(r.resolve(COMMAND_FACTORY_TOKENS.MessageStorage))
  );

  registry.register(
    DbStatusCommandMetadata,
    (r) =>
      new DbStatusCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.MessageStorage)
      )
  );

  registry.register(
    PatchApplyCommandMetadata,
    (r) =>
      new PatchApplyCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        r.resolve(COMMAND_FACTORY_TOKENS.IdeAdapterFactory),
        r.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory)
      )
  );

  registry.register(
    ChatCommand.metadata,
    (r) =>
      new ChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.ChatRuntime),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
  );

  registry.register(ChatStartupCommand.metadata, (r) => {
    const resolveChatSessionCommand = new ResolveChatSessionCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
      r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService)
    );
    const loadSessionMessagesCommand = new LoadSessionMessagesCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
      r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      r.resolve(COMMAND_FACTORY_TOKENS.BackendLogService)
    );
    const introductionCommand = new IntroductionCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
      r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
    );

    return new ChatStartupCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      resolveChatSessionCommand,
      loadSessionMessagesCommand,
      introductionCommand,
      new ChatInfoService(r.resolve(COMMAND_FACTORY_TOKENS.EmitService)),
      r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService)
    );
  });

  registry.register(
    ChatTurnCommand.metadata,
    (r) => new ChatTurnCommand(r.resolve(COMMAND_FACTORY_TOKENS.ChatRuntime))
  );

  registry.register(
    CodeEditListCommandMetadata,
    (r) => new CodeEditListCommand(r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager))
  );

  registry.register(
    CodeEditApproveCommandMetadata,
    (r) => new CodeEditApproveCommand(r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager))
  );

  registry.register(
    CodeEditRejectCommandMetadata,
    (r) =>
      new CodeEditRejectCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
  );

  registry.register(
    CodeEditApplyCommandMetadata,
    (r) =>
      new CodeEditApplyCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
  );

  registry.register(
    InfoChatCommandMetadata,
    (r) =>
      new InfoChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmService)
      )
  );

  const sharedEmitter = EmitService.noop();

  registry.register(
    TeamListChatCommandMetadata,
    (r) =>
      new TeamListChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.ToolManager) as any, sharedEmitter)
  );

  registry.register(
    OverviewChatCommandMetadata,
    (r) =>
      new OverviewChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        sharedEmitter
      )
  );

  registry.register(
    SwitchChatCommandMetadata,
    (r) =>
      new SwitchChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager)
      )
  );

  registry.register(
    HandoffChatCommandMetadata,
    (r) =>
      new HandoffChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmService),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
      )
  );

  registry.register(
    NewSessionChatCommandMetadata,
    (r) =>
      new NewSessionChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        EmitService.noop()
      )
  );

  registry.register(
    BackChatCommandMetadata,
    (r) => new BackChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(HistoryChatCommandMetadata, (_r) => new HistoryChatCommand());

  registry.register(
    InspectChatCommandMetadata,
    (r) => new InspectChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.QuestionService))
  );

  registry.register(
    ContextAddChatCommandMetadata,
    (r) =>
      new ContextAddChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmService)
      )
  );

  registry.register(
    ContextRemoveChatCommandMetadata,
    (r) => new ContextRemoveChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.SessionManager))
  );

  registry.register(
    ContextListChatCommandMetadata,
    (r) => new ContextListChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.SessionManager))
  );

  registry.register(
    ContextSummarizeChatCommandMetadata,
    (r) =>
      new ContextSummarizeChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmService)
      )
  );

  registry.register(
    SessionInfoChatCommandMetadata,
    (r) => new SessionInfoChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.SessionManager))
  );

  registry.register(SessionMessagesChatCommandMetadata, (_r) => new SessionMessagesChatCommand());

  registry.register(
    SessionGraphChatCommandMetadata,
    (r) => new SessionGraphChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.SessionManager))
  );

  registry.register(SessionContextChatCommandMetadata, (r) => {
    const configStorage = r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage);
    return new SessionContextChatCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.ContextService),
      r.resolve(COMMAND_FACTORY_TOKENS.LlmService),
      configStorage.get() as TeamConfig
    );
  });

  registry.register(
    HttpFetchChatCommandMetadata,
    (r) => new HttpFetchChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.ToolManager) as any)
  );

  registry.register(
    HttpCrawlChatCommandMetadata,
    (r) => new HttpCrawlChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.ToolManager) as any)
  );

  registry.register(
    RunShellChatCommandMetadata,
    (r) => new RunShellChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot), sharedEmitter)
  );

  registry.register(ListWorkflowsOrchestrationCommandMetadata, (r) => {
    const serviceCommandRegistry = r.resolve(COMMAND_FACTORY_TOKENS.CommandRegistry) as
      | ICommandRegistry
      | undefined;

    const workflowCatalog = {
      listWorkflowIds(): string[] {
        return serviceCommandRegistry ? listWorkflowToolIds(serviceCommandRegistry) : [];
      },
    };
    return new ListWorkflowsOrchestrationCommand(workflowCatalog as any);
  });
}

export function registerHelpCommand(registry: ICommandRegistry): void {
  const helpCmd = new HelpChatCommand(() =>
    registry.getAll({ availableIn: { chat: true } }).map((entry) => ({
      key: entry.key,
      group: entry.group,
      usage: entry.usage,
      description: entry.description,
      aliases: entry.aliases,
      availableIn: entry.availableIn,
      path: entry.path,
      parameters: entry.parameters,
    }))
  );
  registry.register(helpCmd.metadata, () => helpCmd);
}
