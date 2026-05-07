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
import type { IServiceContainer } from '@ai-team/core';
import {
  COMMAND_DEFINITION_REGISTRY_TOKEN,
  COMMAND_FACTORY_TOKENS,
  isResolverCommandDefinition,
  type AnyCommandDefinition,
  type CommandFactoryContainer,
} from './commands/definitions/types.js';
import type { SessionManager } from './session-manager.js';
import { toCommandRegistration } from './command-adapters.js';
import { AvatarService } from './commands/hr/avatar.js';
import { AccessCanCommand } from './commands/access/access-can.command.js';
import { AccessOverlapCommand } from './commands/access/access-overlap.command.js';
import { AccessService as AccessCommandService } from './commands/access/access-service.js';
import { AccessWhoCommand } from './commands/access/access-who.command.js';
import { AvatarCommand } from './commands/hr/avatar.command.js';
import { CreateICommand } from './commands/hr/create.command.js';
import { CodeEditService } from './commands/edit/code-edit.js';
import {
  CodeEditApplyCommand,
  CodeEditApproveCommand,
  CodeEditListCommand,
  CodeEditRejectCommand,
} from './commands/edit/code-edit.command.js';
import { DbMigrateCommand } from './commands/db/db-migrate.command.js';
import { DbStatusCommand } from './commands/db/db-status.command.js';
import { FilesAllowCommand } from './commands/fs/files-allow.command.js';
import { FilesDenyCommand } from './commands/fs/files-deny.command.js';
import { FilesPatternsCommand } from './commands/fs/files-patterns.command.js';
import { FilesTreeCommand } from './commands/fs/files-tree.command.js';
import { FireICommand } from './commands/hr/fire.command.js';
import { GraphCommand } from './commands/agents/graph.command.js';
import { HhRefreshCommand } from './commands/hr/hh-refresh.command.js';
import { HireICommand } from './commands/hr/hire.command.js';
import { OrgCommand } from './commands/agents/org.command.js';
import { PatchApplyCommand } from './commands/edit/patch-apply.command.js';
import { ResolveEmployeesICommand } from './commands/agents/resolve-employees.command.js';
import { SearchAgentsICommand } from './commands/agents/search-agents.command.js';
import { SkillsAddCommand } from './commands/skills/skills-add.command.js';
import { SkillsListCommand } from './commands/skills/skills-list.command.js';
import { SkillsRemoveCommand } from './commands/skills/skills-remove.command.js';
import { SystemInfoCommand } from './commands/definitions/system-info.command.js';
import { TestConnectionICommand } from './commands/setup/test-connection.command.js';
import { ToolsAllowCommand } from './commands/tools/tools-allow.command.js';
import { ToolsDenyCommand } from './commands/tools/tools-deny.command.js';
import { ToolsListCommand } from './commands/tools/tools-list.command.js';
import { ChatICommand } from './commands/chat/chat.command.js';
import { MetaService } from './routers/meta-service.js';

// ── Handler type ──────────────────────────────────────────────────────────────

type CommandHandler<TCommand extends string = string> = (
  workspaceRoot: string,
  payload: unknown,
  context: InteractionContext
) => Promise<CommandResponse<unknown>>;

/**
 * Wrap a raw command handler result in a CommandResponse envelope.
 */
function wrapHandler(
  fn: (workspaceRoot: string, payload: unknown, context?: InteractionContext) => Promise<unknown>
): CommandHandler {
  return async (workspaceRoot, payload, context) => {
    const result = await fn(workspaceRoot, payload, context);
    
    // If already a CommandResponse, return as-is
    if (result && typeof result === 'object' && 'status' in result) {
      return result as CommandResponse<unknown>;
    }
    
    // Wrap bare results
    return { status: 'ok' as const, message: '', data: result } as CommandResponse<unknown>;
  };
}

export interface CommandRegistration<TCommand extends string = string> {
  key: TCommand;
  aliases?: string[];
  description: string;
  usage?: string;
  availableIn: CommandAvailability;
  handler: CommandHandler<TCommand> | ((workspaceRoot: string, payload: unknown, context?: InteractionContext) => Promise<unknown>);
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export class CommandDispatcher implements ICommandDispatcher {
  private readonly commands = new Map<string, { key: string; aliases?: string[]; description: string; usage?: string; availableIn: CommandAvailability; handler: CommandHandler }>();

  constructor(private readonly workspaceRoot: string) {}

  register<TCommand extends string = string>(entry: CommandRegistration<TCommand>): void {
    // Always wrap the handler to ensure CommandResponse wrapping
    const rawHandler = entry.handler as any;
    const handler = (rawHandler.__wrapped) 
      ? rawHandler 
      : wrapHandler(rawHandler as (workspaceRoot: string, payload: unknown, context?: InteractionContext) => Promise<unknown>);
    
    (handler as any).__wrapped = true;
    
    this.commands.set(entry.key, {
      key: entry.key,
      aliases: entry.aliases,
      description: entry.description,
      usage: entry.usage,
      availableIn: entry.availableIn,
      handler: handler as CommandHandler,
    });
  }

  async dispatch(
    request: InteractionRequest,
    context: InteractionContext = {}
  ): Promise<CommandResponse<unknown>> {
    const reg = this.commands.get(request.command);
    if (!reg) {
      throw new Error(`Unknown command '${String(request.command)}'`);
    }
    return (reg.handler as unknown as CommandHandler)(
      this.workspaceRoot,
      request.payload,
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

function toDescriptor(reg: CommandRegistration): CommandDescriptor {
  return {
    key: reg.key,
    aliases: reg.aliases,
    description: reg.description,
    usage: reg.usage,
    availableIn: reg.availableIn,
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
  const container = createCommandFactoryContainer(workspaceRoot, resolver);
  const commandDefinitions = resolver?.tryResolve(COMMAND_DEFINITION_REGISTRY_TOKEN)?.list() ?? [];

  const registerDefinition = (definition: AnyCommandDefinition): void => {
    if (isResolverCommandDefinition(definition)) {
      definition.register(container);
      d.register({
        ...definition.registration,
        handler: async (_ws: string, payload: unknown, context: InteractionContext) =>
          (
            container.resolve(definition.handlerToken) as (
              payload: unknown,
              context: InteractionContext
            ) => Promise<unknown>
          )(payload, context),
      } as unknown as CommandRegistration);
      return;
    }

    d.register(definition.factory(container) as unknown as CommandRegistration);
  };

  for (const definition of commandDefinitions) {
    registerDefinition(definition);
  }

  container.registerTransient(COMMAND_FACTORY_TOKENS.AvatarService, (resolver) => {
    return new AvatarService(
      resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      resolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      resolver.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
      resolver.resolve(COMMAND_FACTORY_TOKENS.AvatarManager)
    );
  });
  container.registerTransient(COMMAND_FACTORY_TOKENS.CodeEditService, (resolver) => {
    return new CodeEditService(resolver.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager));
  });
  container.registerTransient(COMMAND_FACTORY_TOKENS.AccessCommandService, (resolver) => {
    return new AccessCommandService(
      resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      resolver.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
    );
  });
  container.registerTransient(COMMAND_FACTORY_TOKENS.ContextService, (resolver) => {
    return new MetaService(
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
      new AccessCanCommand(container.resolve(COMMAND_FACTORY_TOKENS.AccessCommandService))
    )
  );

  // ── Service commands (CLI + chat + tool) ────────────────────────────────

  d.register({
    key: 'listEmployees',
    description: 'List all team members',
    availableIn: { cli: true, chat: true, tool: true },
    handler: async (_ws: string, payload: unknown) => {
      const { listEmployees } = await import('./commands/agents/list.js');
      return listEmployees(container.resolve(COMMAND_FACTORY_TOKENS.AgentManager), payload);
    },
  });

  d.register({
    key: 'init',
    description: 'Initialize AI Team in current workspace',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { InitCommand } = await import('./commands/init/init.js');
      const { OnboardCommand } = await import('./commands/hr/onboard.js');
      const { SetupCommand } = await import('./commands/setup/setup.js');
      const { TestConnectionCommand } = await import('./commands/setup/test-connection.js');
      const sessionManager = resolver?.tryResolve<SessionManager>(
        COMMAND_FACTORY_TOKENS.SessionManager
      );
      const onboard = new OnboardCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmService),
        container.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
        container.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker),
        container.resolve(COMMAND_FACTORY_TOKENS.ContextService),
        sessionManager
      );
      const setup = new SetupCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester)
      );
      const testConnection = new TestConnectionCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        container.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
      );
      const cmd = new InitCommand(onboard, setup, testConnection);
      return cmd.execute(
        {
          workspaceRoot: ws,
          options: payload.options,
          injected: sessionManager ? { sessionManager } : undefined,
        },
        {
          signal: context.signal,
          emit: context.emit,
          questionInput: context.questionInput,
          questionConfirm: context.questionConfirm,
          questionSelect: context.questionSelect,
          questionPassword: context.questionPassword,
          questionChecklist: context.questionChecklist,
          workflowState: context.workflowState,
          onWorkflowFrame: context.onWorkflowFrame,
        }
      );
    },
  });

  d.register({
    key: 'setup',
    description: 'Configure LLM provider connection',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { SetupCommand } = await import('./commands/setup/setup.js');
      const cmd = new SetupCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.WorkspaceStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester)
      );
      return cmd.execute(
        { workspaceRoot: ws, options: payload.options },
        {
          signal: context.signal,
          emit: context.emit,
          questionInput: context.questionInput,
          questionConfirm: context.questionConfirm,
          questionSelect: context.questionSelect,
          questionPassword: context.questionPassword,
          questionChecklist: context.questionChecklist,
          workflowState: context.workflowState,
          onWorkflowFrame: context.onWorkflowFrame,
        }
      );
    },
  });

  d.register({
    key: 'onboard',
    description: 'Run team onboarding (CEO + HR + hiring)',
    availableIn: { cli: true, chat: true },
    handler: async (_ws, payload, context) => {
      const { OnboardCommand } = await import('./commands/hr/onboard.js');
      const sessionManager = resolver?.tryResolve<SessionManager>(
        COMMAND_FACTORY_TOKENS.SessionManager
      );
      const cmd = new OnboardCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmService),
        container.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
        container.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker),
        container.resolve(COMMAND_FACTORY_TOKENS.ContextService),
        sessionManager
      );
      return cmd.execute(
        {
          options: payload.options,
          injected: sessionManager ? { sessionManager } : undefined,
        },
        {
          signal: context.signal,
          emit: context.emit,
          questionInput: context.questionInput,
          questionConfirm: context.questionConfirm,
          questionSelect: context.questionSelect,
          questionPassword: context.questionPassword,
          questionChecklist: context.questionChecklist,
          workflowState: context.workflowState,
          onWorkflowFrame: context.onWorkflowFrame,
        }
      );
    },
  });

  d.register({
    key: 'systemStatus',
    description: 'Check system initialization status',
    availableIn: { cli: true, chat: true, tool: true },
    handler: async (ws) => {
      const { SystemStatusCommand } = await import('./commands/setup/system-status.js');
      const cmd = new SystemStatusCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage)
      );
      return cmd.executeAsync(ws);
    },
  });

  d.register({
    key: 'providerConfigure',
    description: 'Configure default LLM provider',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { ProviderCommand } = await import('./commands/setup/provider.js');
      const cmd = new ProviderCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      );
      return cmd.configureAsync(ws, payload.options, context);
    },
  });

  d.register({
    key: 'providerAdd',
    description: 'Add a provider profile',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { ProviderCommand } = await import('./commands/setup/provider.js');
      const cmd = new ProviderCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      );
      return cmd.addAsync(ws, payload.options ?? {}, context);
    },
  });

  d.register({
    key: 'providerSet',
    description: 'Configure default LLM provider',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { ProviderCommand } = await import('./commands/setup/provider.js');
      const cmd = new ProviderCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      );
      return cmd.setAsync(ws, payload.options ?? {}, context);
    },
  });

  d.register({
    key: 'providerList',
    description: 'List configured provider profiles',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload) => {
      const { ModelsCommand } = await import('./commands/setup/models.js');
      const cmd = new ModelsCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      );
      return cmd.providerListAsync(ws, payload.options ?? {});
    },
  });

  d.register({
    key: 'providerModels',
    description: 'List model key dictionaries',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload) => {
      const { ModelsCommand } = await import('./commands/setup/models.js');
      const cmd = new ModelsCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      );
      return cmd.providerModelsAsync(ws, payload.options);
    },
  });

  d.register({
    key: 'providerModelsRefresh',
    description: 'Refresh model dictionary from provider endpoint',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload) => {
      const { ModelsCommand } = await import('./commands/setup/models.js');
      const cmd = new ModelsCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      );
      return cmd.providerModelsRefreshAsync(ws, payload.options);
    },
  });

  // ── Access commands ─────────────────────────────────────────────────────

  d.register(
    toCommandRegistration(new AccessOverlapCommand(container.resolve(COMMAND_FACTORY_TOKENS.AgentManager)))
  );
  d.register(
    toCommandRegistration(
      new AccessWhoCommand(container.resolve(COMMAND_FACTORY_TOKENS.AccessCommandService))
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

  d.register(
    toCommandRegistration(
      new ToolsListCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.ToolManager)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new ToolsAllowCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.ToolManager)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new ToolsDenyCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.ToolManager)
      )
    )
  );

  // ── Files commands ──────────────────────────────────────────────────────────

  d.register(
    toCommandRegistration(
      new FilesTreeCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.FileTreeService),
        container.resolve(COMMAND_FACTORY_TOKENS.FileAnnotationService)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new FilesAllowCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new FilesDenyCommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage)
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
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
      )
    )
  );
  d.register(
    toCommandRegistration(new FireICommand(container.resolve(COMMAND_FACTORY_TOKENS.AgentManager)))
  );
  d.register(
    toCommandRegistration(
      new CreateICommand(
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.SkillManager)
      )
    )
  );
  d.register(
    toCommandRegistration(
      new AvatarCommand(container.resolve(COMMAND_FACTORY_TOKENS.AvatarService))
    )
  );
  d.register(toCommandRegistration(new HhRefreshCommand()));

  // ── Utility commands ────────────────────────────────────────────────────

  d.register(toCommandRegistration(new SystemInfoCommand()));
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
        container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.EnvironmentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage),
        container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        container.resolve(COMMAND_FACTORY_TOKENS.LlmService) as unknown as import('@ai-team/core').ILlmService,
        container.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
        container.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker),
        container.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory),
        container.resolve(COMMAND_FACTORY_TOKENS.ContextService),
        container.resolve(COMMAND_FACTORY_TOKENS.SessionManager)
      )
    )
  );

  d.register(
    toCommandRegistration(
      new CodeEditListCommand(container.resolve(COMMAND_FACTORY_TOKENS.CodeEditService))
    )
  );
  d.register(
    toCommandRegistration(
      new CodeEditApproveCommand(container.resolve(COMMAND_FACTORY_TOKENS.CodeEditService))
    )
  );
  d.register(
    toCommandRegistration(
      new CodeEditRejectCommand(container.resolve(COMMAND_FACTORY_TOKENS.CodeEditService))
    )
  );
  d.register(
    toCommandRegistration(
      new CodeEditApplyCommand(container.resolve(COMMAND_FACTORY_TOKENS.CodeEditService))
    )
  );

  return d;
}
