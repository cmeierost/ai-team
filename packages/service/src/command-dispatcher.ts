/**
 * Unified command dispatcher — single service-layer entry point for all commands.
 *
 * Dispatches by command key against an ICommandRegistry. The caller provides
 * a fully-constructed ExecutionContext — no interaction hooks or context
 * conversion happens here. CLI creates a fresh context from request parameters;
 * slash commands inherit the running workflow/chat context.
 */

import type {
  CommandAvailability,
  CommandDescriptor,
  CommandResponse,
  ICommandDispatcher,
} from '@ai-team/api-contracts';
import { isCommandResponse } from '@ai-team/api-contracts';
import type {
  ICommand,
  ICommandRegistry,
  IServiceContainer,
  ExecutionContext,
} from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from './types.js';
import type { SessionManager } from './session-manager.js';
import { resolveCommandArgs } from './command-adapters.js';
import { setServiceContainer } from './service-registry.js';
import { CommandRegistry } from './command-registry-impl.js';
import { AccessCanCommand } from './commands/access/access-can.command.js';
import { AccessOverlapCommand } from './commands/access/access-overlap.command.js';
import { AccessWhoCommand } from './commands/access/access-who.command.js';
import { AvatarCommand } from './commands/hr/avatar.command.js';
import { CreateICommand } from './commands/hr/create.command.js';
import { CodeEditApplyCommand } from './commands/edit/code-edit-apply.command.js';
import { CodeEditApproveCommand } from './commands/edit/code-edit-approve.command.js';
import { CodeEditListCommand } from './commands/edit/code-edit-list.command.js';
import { CodeEditRejectCommand } from './commands/edit/code-edit-reject.command.js';
import { DbMigrateCommand } from './commands/db/db-migrate.command.js';
import { DbStatusCommand } from './commands/db/db-status.command.js';
import { FilesAllowCommand } from './commands/fs/files-allow.command.js';
import { FilesDenyCommand } from './commands/fs/files-deny.command.js';
import { FilesPatternsCommand } from './commands/fs/files-patterns.command.js';
import { FilesTreeCommand } from './commands/fs/files-tree.command.js';
import { FileTreeService } from './commands/fs/file-tree.js';
import { FireICommand } from './commands/hr/fire.command.js';
import { GraphCommand } from './commands/team/graph.command.js';
import { HhRefreshCommand } from './commands/hr/hh-refresh.command.js';
import { HireICommand } from './commands/hr/hire.command.js';
import { OrgCommand } from './commands/team/org.command.js';
import { PatchApplyCommand } from './commands/edit/patch-apply.command.js';
import { ResolveEmployeesICommand } from './commands/team/resolve-employees.command.js';
import { SearchAgentsICommand } from './commands/team/search-agents.command.js';
import { TeamListICommand } from './commands/team/team-list.command.js';
import { SkillsAddCommand } from './commands/skills/skills-add.command.js';
import { SkillsListCommand } from './commands/skills/skills-list.command.js';
import { SkillsRemoveCommand } from './commands/skills/skills-remove.command.js';
import { InitICommand } from './commands/init/init.command.js';
import { InitCommand } from './commands/init/init.js';
import { SetupICommand } from './commands/setup/setup.command.js';
import { OnboardCommand, OnboardICommand } from './commands/hr/onboard.js';
import { SetupCommand } from './commands/setup/setup.js';
import {
  ProviderAddICommand,
  ProviderConfigureICommand,
  ProviderSetICommand,
} from './commands/setup/provider.command.js';
import {
  ProviderListICommand,
  ProviderModelsICommand,
  ProviderModelsRefreshICommand,
} from './commands/setup/models.command.js';
import { SystemInfoCommand } from './commands/system/system-info.command.js';
import { SystemStatusICommand } from './commands/setup/system-status.js';
import { TestConnectionICommand } from './commands/setup/test-connection.command.js';
import { TestConnectionCommand } from './commands/setup/test-connection.js';
import { WorkflowRunnerFactory } from './workflow/runner.js';
import { ToolsAllowCommand } from './commands/tools/tools-allow.command.js';
import { ToolsDenyCommand } from './commands/tools/tools-deny.command.js';
import { ToolsListCommand } from './commands/tools/tools-list.command.js';
import { AgentToolsService } from './commands/tools/tools-service.js';
import { GovernanceService } from './commands/agents/governance.js';
import { ChatICommand } from './commands/chat/chat-i.command.js';
import { HelpChatCommand } from './commands/help/help.command.js';
import { ChatInfoService } from './orchestrator/chat-info-service.js';
import { MetaService } from './routers/meta-service.js';

// ── Kept for backward compat with types.ts legacy definition infrastructure ──

/** @deprecated Use ICommandDescriptor from @ai-team/core instead. */
export interface CommandRegistrationMetadata<TCommand extends string = string> {
  key: TCommand;
  aliases?: string[];
  description: string;
  usage?: string;
  availableIn: CommandAvailability;
  path?: string[];
  help?: {
    description?: string;
    hints?: string[];
    examples?: Array<{
      value: string;
      surfaces?: Array<'cli' | 'chat' | 'tool' | 'workflow'>;
      description?: string;
    }>;
  };
  llm?: {
    description?: string;
    hints?: string[];
    examples?: string[];
    hiddenParameters?: string[];
  };
  intents?: string[];
  intentExamples?: string[];
  input?: {
    mode?: 'structured' | 'raw-tail' | 'hybrid';
    jsonSignature?: boolean;
    contextParameters?: string[];
    contextOverrideAllowlist?: string[];
  };
}

/** @deprecated Will be removed once legacy CommandDefinitionRegistry is cleaned up. */
// eslint-disable-next-line @typescript-eslint/no-deprecated
export type RegisteredCommand<TCommand extends string = string> =
  CommandRegistrationMetadata<TCommand> & {
    handler: (...args: unknown[]) => Promise<unknown>;
  };

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Resolves commands from an ICommandRegistry and executes them with a
 * caller-provided ExecutionContext. No context conversion happens here.
 */
export class CommandDispatcher implements ICommandDispatcher {
  constructor(
    private readonly registry: ICommandRegistry,
    private readonly resolver: IServiceContainer
  ) {}

  async dispatch(
    key: string,
    params: unknown,
    ctx: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const cmd = this.registry.resolve(key, this.resolver);
    if (!cmd) {
      return {
        status: 'error',
        message: `Unknown command '${key}'`,
        error: { code: 'UNKNOWN_COMMAND', details: { key } },
      };
    }
    try {
      const resolvedParams = resolveCommandArgs(cmd, params, ctx);
      const result = await cmd.execute(resolvedParams, ctx);
      if (isCommandResponse(result)) {
        return { ...result, message: result.message ?? '' };
      }
      return { status: 'ok', message: '', data: result };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Command dispatch failed',
        error: { code: 'COMMAND_DISPATCH_FAILED', details: error },
      };
    }
  }

  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[] {
    return this.registry.getAll({ availableIn: filter });
  }

  getCommand(key: string): CommandDescriptor | undefined {
    return this.registry.get(key);
  }
}

/**
 * Build a fully wired CommandDispatcher with all known command handlers.
 */
export function createCommandDispatcher(
  workspaceRoot: string,
  resolver?: IServiceContainer
): CommandDispatcher {
  if (!resolver) {
    throw new Error(
      'createCommandDispatcher requires a resolver. Use createContainerWithBootstrap(...).child() and pass it in.'
    );
  }

  setServiceContainer(resolver);

  const scopedResolver = resolver.child();
  scopedResolver.registerInstance(COMMAND_FACTORY_TOKENS.WorkspaceRoot, workspaceRoot);

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

  const registry = new CommandRegistry();
  const reg = (cmd: ICommand<unknown, unknown>) => registry.register(cmd.metadata, () => cmd);

  // ── Access commands ────────────────────────────────────────────────────

  reg(
    new AccessCanCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
    )
  );

  // ── Service commands ───────────────────────────────────────────────────

  reg(new TeamListICommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager)));

  const sessionManager = resolver.tryResolve<SessionManager>(COMMAND_FACTORY_TOKENS.SessionManager);
  const setupCommand = new SetupCommand(
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceStorage),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
  );
  const onboardCommand = new OnboardCommand(
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.LlmService),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ContextService),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
    sessionManager,
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
    scopedResolver
  );

  reg(
    new InitICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      new InitCommand(
        onboardCommand,
        setupCommand,
        new TestConnectionCommand(
          scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
          scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
          scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          scopedResolver.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
          scopedResolver.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
        ),
        new WorkflowRunnerFactory(scopedResolver)
      )
    )
  );
  reg(new SetupICommand(setupCommand));
  reg(
    new OnboardICommand(
      onboardCommand,
      sessionManager,
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );

  reg(
    new SystemStatusICommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage))
  );

  reg(
    new ProviderConfigureICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );
  reg(
    new ProviderAddICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );
  reg(
    new ProviderSetICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );
  reg(
    new ProviderListICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
    )
  );
  reg(
    new ProviderModelsICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
    )
  );
  reg(
    new ProviderModelsRefreshICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
    )
  );

  // ── Access commands (continued) ────────────────────────────────────────

  reg(new AccessOverlapCommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager)));
  reg(
    new AccessWhoCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
    )
  );

  // ── Search & skills commands ───────────────────────────────────────────

  reg(new SearchAgentsICommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager)));
  reg(new ResolveEmployeesICommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager)));
  reg(
    new SkillsListCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager)
    )
  );
  reg(
    new SkillsAddCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
    )
  );
  reg(
    new SkillsRemoveCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
    )
  );

  // ── Tools commands ─────────────────────────────────────────────────────

  const governanceService = new GovernanceService(
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
  );
  const toolsService = new AgentToolsService(
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
    governanceService
  );

  reg(new ToolsListCommand(toolsService));
  reg(new ToolsAllowCommand(toolsService));
  reg(new ToolsDenyCommand(toolsService));

  // ── Files commands ─────────────────────────────────────────────────────

  const fileTreeAccessService = new FileTreeService(
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
    governanceService,
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.FileTreeService),
    scopedResolver.resolve(COMMAND_FACTORY_TOKENS.FileAnnotationService)
  );

  reg(new FilesTreeCommand(fileTreeAccessService));
  reg(
    new FilesAllowCommand(
      fileTreeAccessService,
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      governanceService
    )
  );
  reg(
    new FilesDenyCommand(
      fileTreeAccessService,
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      governanceService
    )
  );
  reg(
    new FilesPatternsCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage)
    )
  );

  // ── Org commands ───────────────────────────────────────────────────────

  reg(new GraphCommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.TeamGraphBuilder)));
  reg(new OrgCommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.TeamGraphBuilder)));
  reg(
    new HireICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
    )
  );
  reg(
    new FireICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      new WorkflowRunnerFactory(scopedResolver)
    )
  );
  reg(
    new CreateICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );
  reg(
    new AvatarCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AvatarManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );
  reg(new HhRefreshCommand());

  // ── Utility commands ───────────────────────────────────────────────────

  reg(new SystemInfoCommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.SystemInfoService)));
  reg(
    new TestConnectionICommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
    )
  );
  reg(new DbMigrateCommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.MessageStorage)));
  reg(new DbStatusCommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.MessageStorage)));
  reg(
    new PatchApplyCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.IdeAdapterFactory),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory)
    )
  );
  reg(
    new ChatICommand(
      {
        configurationStorage: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        environmentStorage: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        developerIdentityService: scopedResolver.resolve(
          COMMAND_FACTORY_TOKENS.DeveloperIdentityService
        ),
        contextService: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ContextService),
      },
      {
        agentManager: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        agentDocumentStorage: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage),
        markdownSectionService: scopedResolver.resolve(
          COMMAND_FACTORY_TOKENS.MarkdownSectionService
        ),
        skillManager: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
      },
      {
        sessionManager: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        llmService: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.LlmService),
        proposalStoreFactory: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory),
      },
      {
        pathPermissionChecker: scopedResolver.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker),
        serviceContainer: scopedResolver,
      },
      new ChatInfoService(),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );

  reg(new CodeEditListCommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager)));
  reg(new CodeEditApproveCommand(scopedResolver.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager)));
  reg(
    new CodeEditRejectCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );
  reg(
    new CodeEditApplyCommand(
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
      scopedResolver.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    )
  );

  // ── Dispatcher — must be created before HelpChatCommand ───────────────

  const dispatcher = new CommandDispatcher(registry, scopedResolver);

  // HelpChatCommand lazily calls dispatcher.getCommands(); register after dispatcher is created
  const helpCmd = new HelpChatCommand(() =>
    dispatcher.getCommands({ chat: true }).map((entry) => ({
      key: entry.key,
      usage: entry.usage,
      description: entry.description,
      availableIn: entry.availableIn,
      path: entry.path,
    }))
  );
  registry.register(helpCmd.metadata, () => helpCmd);

  return dispatcher;
}
