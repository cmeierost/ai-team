/**
 * Unified command dispatcher — single service-layer entry point for all commands.
 *
 * Both CLI and browser clients call `dispatch()` with a typed `InteractionRequest`.
 * Chat slash commands are also routed through this dispatcher, making every
 * command callable as `{ command, payload }`.
 */

import type {
  CommandAvailability,
  CommandDescriptor,
  CommandResponse,
  ICommandDispatcher,
  InteractionContext,
  InteractionRequest,
} from '@ai-team/api-contracts';
import { isCommandResponse } from '@ai-team/api-contracts';
import type { ICommand, IServiceContainer } from '@ai-team/core';
import {
  COMMAND_DEFINITION_REGISTRY_TOKEN,
  COMMAND_FACTORY_TOKENS,
  isResolverCommandDefinition,
  type AnyCommandDefinition,
  type CommandFactoryContainer,
} from './types.js';
import type { SessionManager } from './session-manager.js';
import { toCommandRegistration } from './command-adapters.js';
import { setServiceContainer } from './service-registry.js';
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

// ── Handler type ──────────────────────────────────────────────────────────────

type CommandHandler = (
  workspaceRoot: string,
  payload: unknown,
  context: InteractionContext
) => Promise<CommandResponse<unknown>>;

type AnyICommand = ICommand<unknown, unknown>;
type CommandPayload<TCommand extends AnyICommand> = Parameters<TCommand['execute']>[0];
type CommandRawResult<TCommand extends AnyICommand> = Awaited<ReturnType<TCommand['execute']>>;
type CommandDataResult<TCommand extends AnyICommand> =
  CommandRawResult<TCommand> extends CommandResponse<infer TData>
    ? TData
    : CommandRawResult<TCommand>;
type TypedCommandResponse<TCommand extends AnyICommand> = CommandResponse<
  CommandDataResult<TCommand>
>;

/**
 * Wrap a raw command handler result in a CommandResponse envelope.
 */
function wrapHandler(
  fn: (workspaceRoot: string, payload: unknown, context?: InteractionContext) => Promise<unknown>
): CommandHandler {
  return async (workspaceRoot, payload, context) => {
    try {
      const result = await fn(workspaceRoot, payload, context);

      // If already a CommandResponse, return as-is
      if (isCommandResponse(result)) {
        return result;
      }

      // Wrap bare results
      return { status: 'ok', message: '', data: result };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Command execution failed',
        error: {
          code: 'COMMAND_EXECUTION_FAILED',
          details: error,
        },
      };
    }
  };
}

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

export type RegisteredCommand<TCommand extends string = string> =
  CommandRegistrationMetadata<TCommand> & {
    handler:
      | CommandHandler
      | ((
          workspaceRoot: string,
          payload: unknown,
          context?: InteractionContext
        ) => Promise<unknown>);
  };

// ── Dispatcher ────────────────────────────────────────────────────────────────

export class CommandDispatcher implements ICommandDispatcher {
  private readonly commands = new Map<string, RegisteredCommand>();
  private readonly aliasOwners = new Map<string, string>();

  constructor(private readonly workspaceRoot: string) {}

  registerCommand<TParams, TResult>(command: ICommand<TParams, TResult>): void {
    this.register(
      toCommandRegistration(command as unknown as ICommand<unknown, unknown>) as RegisteredCommand
    );
  }

  register<TCommand extends string = string>(entry: RegisteredCommand<TCommand>): void {
    if (this.commands.has(entry.key)) {
      throw new Error(`Duplicate command registration for key '${entry.key}'.`);
    }

    if (entry.aliases) {
      for (const alias of entry.aliases) {
        const existingOwner = this.aliasOwners.get(alias);
        if (existingOwner && existingOwner !== entry.key) {
          throw new Error(
            `Duplicate alias '${alias}' registered by '${existingOwner}' and '${entry.key}'.`
          );
        }
      }
    }

    // Always wrap the handler to ensure CommandResponse wrapping
    const rawHandler = entry.handler as any;
    const handler = rawHandler.__wrapped
      ? rawHandler
      : wrapHandler(
          rawHandler as (
            workspaceRoot: string,
            payload: unknown,
            context?: InteractionContext
          ) => Promise<unknown>
        );

    handler.__wrapped = true;

    this.commands.set(entry.key, {
      key: entry.key,
      aliases: entry.aliases,
      description: entry.description,
      usage: entry.usage,
      availableIn: entry.availableIn,
      path: entry.path,
      help: entry.help,
      llm: entry.llm,
      intents: entry.intents,
      intentExamples: entry.intentExamples,
      input: entry.input,
      handler: handler as CommandHandler,
    });

    if (entry.aliases) {
      for (const alias of entry.aliases) {
        this.aliasOwners.set(alias, entry.key);
      }
    }
  }

  async dispatch(
    request: InteractionRequest,
    context?: InteractionContext
  ): Promise<CommandResponse<unknown>>;

  async dispatch<TCommand extends AnyICommand>(
    request: {
      requestId?: string;
      command: string;
      payload: CommandPayload<TCommand>;
    },
    context?: InteractionContext
  ): Promise<TypedCommandResponse<TCommand>>;

  async dispatch(
    request: InteractionRequest,
    context: InteractionContext = {}
  ): Promise<CommandResponse<unknown>> {
    const reg = this.commands.get(request.command);
    if (!reg) {
      return {
        status: 'error',
        message: `Unknown command '${String(request.command)}'`,
        error: {
          code: 'UNKNOWN_COMMAND',
          details: { command: request.command },
        },
      };
    }
    try {
      return await (reg.handler as unknown as CommandHandler)(
        this.workspaceRoot,
        request.payload,
        context
      );
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Command dispatch failed',
        error: {
          code: 'COMMAND_DISPATCH_FAILED',
          details: error,
        },
      };
    }
  }

  async dispatchCommand<TCommand extends AnyICommand>(
    command: TCommand,
    payload: CommandPayload<TCommand>,
    context: InteractionContext = {}
  ): Promise<TypedCommandResponse<TCommand>> {
    return this.dispatch<TCommand>(
      {
        command: command.metadata.key,
        payload,
      },
      context
    );
  }

  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[] {
    const all = [...this.commands.values()];
    if (!filter) return all.map(toDescriptor);

    return all
      .filter((c) => {
        if (filter.cli && !c.availableIn.cli) return false;
        if (filter.chat && !c.availableIn.chat) return false;
        if (filter.cliChat && !c.availableIn.cliChat) return false;
        if (filter.tool && !c.availableIn.tool) return false;
        return true;
      })
      .map(toDescriptor);
  }

  getCommand(key: string): CommandDescriptor | undefined {
    const reg = this.commands.get(key);
    return reg ? toDescriptor(reg) : undefined;
  }
}

function toDescriptor(reg: CommandRegistrationMetadata): CommandDescriptor {
  return {
    key: reg.key,
    aliases: reg.aliases,
    description: reg.description,
    usage: reg.usage,
    availableIn: reg.availableIn,
    path: reg.path,
    help: reg.help,
    llm: reg.llm,
    intents: reg.intents,
    intentExamples: reg.intentExamples,
    input: reg.input,
  };
}

function createCommandFactoryContainer(
  workspaceRoot: string,
  resolver?: IServiceContainer
): CommandFactoryContainer {
  if (!resolver) {
    throw new Error(
      'createCommandDispatcher requires a resolver. Use createContainerWithBootstrap(...).child() and pass it in.'
    );
  }

  const scopedResolver = resolver.child();
  scopedResolver.registerInstance(COMMAND_FACTORY_TOKENS.WorkspaceRoot, workspaceRoot);

  return {
    workspaceRoot,
    resolver: scopedResolver,
    resolve: (token) => scopedResolver.resolve(token),
    registerTransient: (token, factory) => {
      scopedResolver.registerTransient(token, factory);
    },
  };
}

/**
 * Build a fully wired CommandDispatcher with all known command handlers.
 *
 * Lazy-imports are used for command modules to keep startup fast.
 */
export function createCommandDispatcher(
  workspaceRoot: string,
  resolver?: IServiceContainer
): CommandDispatcher {
  const d = new CommandDispatcher(workspaceRoot);
  if (resolver) {
    setServiceContainer(resolver);
  }
  const container = createCommandFactoryContainer(workspaceRoot, resolver);
  const commandDefinitions = resolver?.tryResolve(COMMAND_DEFINITION_REGISTRY_TOKEN)?.list() ?? [];

  const registerDefinition = (definition: AnyCommandDefinition): void => {
    if (isResolverCommandDefinition(definition)) {
      definition.register(container);
      d.register({
        ...definition.registration,
        handler: wrapHandler(
          async (_ws: string, payload: unknown, context?: InteractionContext) => {
            const handler = container.resolve(definition.handlerToken) as (
              payload: unknown,
              context: InteractionContext
            ) => Promise<unknown>;
            return handler(payload, context ?? {});
          }
        ),
      });
      return;
    }

    d.register(definition.factory(container));
  };

  for (const definition of commandDefinitions) {
    registerDefinition(definition);
  }

  container.registerTransient(COMMAND_FACTORY_TOKENS.ContextService, (resolver) => {
    return new MetaService(
      resolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      resolver.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
      resolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
      resolver.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
      resolver.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage)
    );
  });

  // ── Class-based commands ─────────────────────────────────────────────────
  // One registration — CLI, chat, and tool surfaces resolve from the same registry.

  d.register(
    toCommandRegistration(
      new AccessCanCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
      )
    )
  );

  // ── Service commands (CLI + chat + tool) ────────────────────────────────

  d.register(
    toCommandRegistration(
      new TeamListICommand(container.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
    )
  );

  const sessionManager = resolver?.tryResolve<SessionManager>(
    COMMAND_FACTORY_TOKENS.SessionManager
  );
  const setupCommand = new SetupCommand(
    container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
    container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
    container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceStorage),
    container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
    container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
    container.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
    container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
  );
  const onboardCommand = new OnboardCommand(
    container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
    container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
    container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
    container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
    container.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage),
    container.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory),
    container.resolve(COMMAND_FACTORY_TOKENS.LlmService),
    container.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
    container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
    container.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker),
    container.resolve(COMMAND_FACTORY_TOKENS.ContextService),
    container.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
    sessionManager,
    container.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
    resolver
  );

  d.register(
    toCommandRegistration(
      new InitICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
        new InitCommand(
          onboardCommand,
          setupCommand,
          new TestConnectionCommand(
            container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
            container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
            container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
            container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
            container.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
          ),
          new WorkflowRunnerFactory(container.resolver)
        )
      )
    )
  );
  d.register(toCommandRegistration(new SetupICommand(setupCommand)));
  d.register(
    toCommandRegistration(
      new OnboardICommand(
        onboardCommand,
        sessionManager,
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );

  d.register(
    toCommandRegistration(
      new SystemStatusICommand(container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage))
    )
  );

  d.register(
    toCommandRegistration(
      new ProviderConfigureICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );

  d.register(
    toCommandRegistration(
      new ProviderAddICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );

  d.register(
    toCommandRegistration(
      new ProviderSetICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );

  d.register(
    toCommandRegistration(
      new ProviderListICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
    )
  );

  d.register(
    toCommandRegistration(
      new ProviderModelsICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
    )
  );

  d.register(
    toCommandRegistration(
      new ProviderModelsRefreshICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
    )
  );

  // ── Access commands ─────────────────────────────────────────────────────

  d.register(
    toCommandRegistration(
      new AccessOverlapCommand(container.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
    )
  );
  d.register(
    toCommandRegistration(
      new AccessWhoCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
      )
    )
  );

  // ── Search & skills commands ────────────────────────────────────────────

  d.register(
    toCommandRegistration(
      new SearchAgentsICommand(container.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
    )
  );
  d.register(
    toCommandRegistration(
      new ResolveEmployeesICommand(container.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
    )
  );
  d.register(
    toCommandRegistration(
      new SkillsListCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.SkillManager)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new SkillsAddCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new SkillsRemoveCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
      )
    )
  );

  // ── Tools commands ──────────────────────────────────────────────────────────

  const governanceService = new GovernanceService(
    container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
  );

  const toolsService = new AgentToolsService(
    container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    container.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
    governanceService
  );

  d.register(toCommandRegistration(new ToolsListCommand(toolsService)));
  d.register(toCommandRegistration(new ToolsAllowCommand(toolsService)));
  d.register(toCommandRegistration(new ToolsDenyCommand(toolsService)));

  // ── Files commands ──────────────────────────────────────────────────────────

  const fileTreeAccessService = new FileTreeService(
    container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
    container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
    container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
    governanceService,
    container.resolve(COMMAND_FACTORY_TOKENS.FileTreeService),
    container.resolve(COMMAND_FACTORY_TOKENS.FileAnnotationService)
  );

  d.register(toCommandRegistration(new FilesTreeCommand(fileTreeAccessService)));
  d.register(
    toCommandRegistration(
      new FilesAllowCommand(
        fileTreeAccessService,
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
        governanceService
      )
    )
  );
  d.register(
    toCommandRegistration(
      new FilesDenyCommand(
        fileTreeAccessService,
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
        governanceService
      )
    )
  );
  d.register(
    toCommandRegistration(
      new FilesPatternsCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage)
      )
    )
  );

  // ── Files tree & patterns ───────────────────────────────────────────────

  // ── Org commands ────────────────────────────────────────────────────────

  d.register(
    toCommandRegistration(
      new GraphCommand(container.resolve(COMMAND_FACTORY_TOKENS.TeamGraphBuilder))
    )
  );
  d.register(
    toCommandRegistration(
      new OrgCommand(container.resolve(COMMAND_FACTORY_TOKENS.TeamGraphBuilder))
    )
  );
  d.register(
    toCommandRegistration(
      new HireICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new FireICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        new WorkflowRunnerFactory(container.resolver)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new CreateICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new AvatarCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.AvatarManager),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );
  d.register(toCommandRegistration(new HhRefreshCommand()));

  // ── Utility commands ────────────────────────────────────────────────────

  d.register(
    toCommandRegistration(
      new SystemInfoCommand(container.resolve(COMMAND_FACTORY_TOKENS.SystemInfoService))
    )
  );
  d.register(
    toCommandRegistration(
      new TestConnectionICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        container.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new DbMigrateCommand(container.resolve(COMMAND_FACTORY_TOKENS.MessageStorage))
    )
  );
  d.register(
    toCommandRegistration(
      new DbStatusCommand(container.resolve(COMMAND_FACTORY_TOKENS.MessageStorage))
    )
  );
  d.register(
    toCommandRegistration(
      new PatchApplyCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        container.resolve(COMMAND_FACTORY_TOKENS.IdeAdapterFactory),
        container.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new ChatICommand(
        {
          configurationStorage: container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
          environmentStorage: container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
          developerIdentityService: container.resolve(
            COMMAND_FACTORY_TOKENS.DeveloperIdentityService
          ),
          contextService: container.resolve(COMMAND_FACTORY_TOKENS.ContextService),
        },
        {
          agentManager: container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          agentDocumentStorage: container.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage),
          markdownSectionService: container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
          skillManager: container.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        },
        {
          sessionManager: container.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
          llmService: container.resolve(COMMAND_FACTORY_TOKENS.LlmService),
          proposalStoreFactory: container.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory),
        },
        {
          pathPermissionChecker: container.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker),
          serviceContainer: container.resolver,
        },
        new ChatInfoService(),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );

  d.register(
    toCommandRegistration(
      new HelpChatCommand(() =>
        d.getCommands({ chat: true }).map((entry) => ({
          key: entry.key,
          usage: entry.usage,
          description: entry.description,
          availableIn: entry.availableIn,
          path: entry.path,
        }))
      )
    )
  );

  d.register(
    toCommandRegistration(
      new CodeEditListCommand(container.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager))
    )
  );
  d.register(
    toCommandRegistration(
      new CodeEditApproveCommand(container.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager))
    )
  );
  d.register(
    toCommandRegistration(
      new CodeEditRejectCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new CodeEditApplyCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        container.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
    )
  );

  return d;
}
