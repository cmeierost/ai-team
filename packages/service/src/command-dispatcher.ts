/**
 * Unified command dispatcher — single service-layer entry point for all commands.
 *
 * Both CLI and browser clients call `dispatch()` with a typed `InteractionRequest`.
 * Chat slash commands are also routed through this dispatcher, making every
 * command callable as `{ command, payload }`.
 */

import type {
  AiTeamCommandName,
  AiTeamCommandPayloadMap,
  AiTeamCommandResponseMap,
  CommandAvailability,
  CommandDescriptor,
  ICommandDispatcher,
  InteractionContext,
  InteractionRequest,
} from '@ai-team/api-client';
import type { IServiceContainer } from '@ai-team/core';
import {
  COMMAND_DEFINITION_REGISTRY_TOKEN,
  COMMAND_FACTORY_TOKENS,
  isResolverCommandDefinition,
  type AnyCommandDefinition,
  type CommandFactoryContainer,
} from './commands/definitions/types.js';

// ── Handler type ──────────────────────────────────────────────────────────────

type CommandHandler<TCommand extends AiTeamCommandName> = (
  workspaceRoot: string,
  payload: AiTeamCommandPayloadMap[TCommand],
  context: InteractionContext
) => Promise<AiTeamCommandResponseMap[TCommand]>;

export interface CommandRegistration<TCommand extends AiTeamCommandName = AiTeamCommandName> {
  key: TCommand;
  aliases?: string[];
  description: string;
  usage?: string;
  availableIn: CommandAvailability;
  handler: CommandHandler<TCommand>;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export class CommandDispatcher implements ICommandDispatcher {
  private readonly commands = new Map<AiTeamCommandName, CommandRegistration>();

  constructor(private readonly workspaceRoot: string) {}

  register<TCommand extends AiTeamCommandName>(entry: CommandRegistration<TCommand>): void {
    this.commands.set(entry.key, entry as unknown as CommandRegistration);
  }

  async dispatch<TCommand extends AiTeamCommandName>(
    request: InteractionRequest<TCommand>,
    context: InteractionContext = {}
  ): Promise<AiTeamCommandResponseMap[TCommand]> {
    const reg = this.commands.get(request.command);
    if (!reg) {
      throw new Error(`Unknown command '${String(request.command)}'`);
    }
    return (reg.handler as unknown as CommandHandler<TCommand>)(
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

  getCommand(key: AiTeamCommandName): CommandDescriptor | undefined {
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

class LocalServiceContainer implements IServiceContainer {
  private readonly singletons = new Map<string, unknown>();
  private readonly transients = new Map<string, (container: IServiceContainer) => unknown>();

  constructor(private readonly parent?: IServiceContainer) {}

  register<T>(token: { id: string }, factory: (container: IServiceContainer) => T): this {
    return this.registerSingleton(token, factory);
  }

  registerSingleton<T>(token: { id: string }, factory: (container: IServiceContainer) => T): this {
    let created = false;
    let value: T;
    this.transients.set(token.id, (container) => {
      if (!created) {
        value = factory(container);
        created = true;
      }
      return value;
    });
    this.singletons.delete(token.id);
    return this;
  }

  registerTransient<T>(token: { id: string }, factory: (container: IServiceContainer) => T): this {
    this.transients.set(token.id, factory as (container: IServiceContainer) => unknown);
    this.singletons.delete(token.id);
    return this;
  }

  registerInstance<T>(token: { id: string }, instance: T): this {
    this.singletons.set(token.id, instance);
    this.transients.delete(token.id);
    return this;
  }

  resolve<T>(token: { id: string }): T {
    if (this.singletons.has(token.id)) {
      return this.singletons.get(token.id) as T;
    }

    const factory = this.transients.get(token.id);
    if (factory) {
      return factory(this) as T;
    }

    if (this.parent?.has(token)) {
      return this.parent.resolve(token) as T;
    }

    throw new Error(`ServiceContainer: no registration for ${token.id}`);
  }

  tryResolve<T>(token: { id: string }): T | undefined {
    try {
      return this.resolve(token);
    } catch {
      return undefined;
    }
  }

  has(token: { id: string }): boolean {
    return (
      this.singletons.has(token.id) ||
      this.transients.has(token.id) ||
      (this.parent?.has(token) ?? false)
    );
  }

  child(): IServiceContainer {
    return new LocalServiceContainer(this);
  }
}

function createCommandFactoryContainer(
  workspaceRoot: string,
  resolver?: IServiceContainer
): CommandFactoryContainer {
  const scopedResolver = resolver?.child() ?? new LocalServiceContainer();
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

  // ── Service commands (CLI + chat + tool) ────────────────────────────────

  d.register({
    key: 'listEmployees',
    description: 'List all team members',
    availableIn: { cli: true, chat: true, tool: true },
    handler: async (ws, payload) => {
      const { listEmployeesCommand } = await import('./commands/list.js');
      return listEmployeesCommand(ws, payload);
    },
  });

  d.register({
    key: 'init',
    description: 'Initialize AI Team in current workspace',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { initCommand } = await import('./commands/init.js');
      return initCommand(ws, payload.options, {
        signal: context.signal,
        emit: context.emit,
        questionInput: context.questionInput,
        questionConfirm: context.questionConfirm,
        questionSelect: context.questionSelect,
        questionPassword: context.questionPassword,
        questionChecklist: context.questionChecklist,
        workflowState: context.workflowState,
        onWorkflowFrame: context.onWorkflowFrame,
      });
    },
  });

  d.register({
    key: 'setup',
    description: 'Configure LLM provider connection',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { setupCommand } = await import('./commands/setup.js');
      return setupCommand(ws, payload.options, {
        signal: context.signal,
        emit: context.emit,
        questionInput: context.questionInput,
        questionConfirm: context.questionConfirm,
        questionSelect: context.questionSelect,
        questionPassword: context.questionPassword,
        questionChecklist: context.questionChecklist,
        workflowState: context.workflowState,
        onWorkflowFrame: context.onWorkflowFrame,
      });
    },
  });

  d.register({
    key: 'onboard',
    description: 'Run team onboarding (CEO + HR + hiring)',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { onboardCommand } = await import('./commands/onboard.js');
      return onboardCommand(ws, payload.options, {
        signal: context.signal,
        emit: context.emit,
        questionInput: context.questionInput,
        questionConfirm: context.questionConfirm,
        questionSelect: context.questionSelect,
        questionPassword: context.questionPassword,
        questionChecklist: context.questionChecklist,
        workflowState: context.workflowState,
        onWorkflowFrame: context.onWorkflowFrame,
      });
    },
  });

  d.register({
    key: 'systemStatus',
    description: 'Check system initialization status',
    availableIn: { cli: true, chat: true, tool: true },
    handler: async (ws) => {
      const { getSystemStatusAsync } = await import('./commands/system-status.js');
      return getSystemStatusAsync(ws);
    },
  });

  d.register({
    key: 'providerConfigure',
    description: 'Configure default LLM provider',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { providerConfigureCommand } = await import('./commands/provider.js');
      return providerConfigureCommand(ws, payload.options, context);
    },
  });

  d.register({
    key: 'providerAdd',
    description: 'Add a provider profile',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { providerAddCommand } = await import('./commands/provider.js');
      return providerAddCommand(ws, payload.options ?? {}, context);
    },
  });

  d.register({
    key: 'providerSet',
    description: 'Configure default LLM provider',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload, context) => {
      const { providerSetCommand } = await import('./commands/provider.js');
      return providerSetCommand(ws, payload.options ?? {}, context);
    },
  });

  d.register({
    key: 'providerList',
    description: 'List configured provider profiles',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload) => {
      const { providerListCommand } = await import('./commands/models.js');
      return providerListCommand(ws, payload.options ?? {});
    },
  });

  d.register({
    key: 'providerModels',
    description: 'List model key dictionaries',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload) => {
      const { providerModelsCommand } = await import('./commands/models.js');
      return providerModelsCommand(ws, payload.options);
    },
  });

  d.register({
    key: 'providerModelsRefresh',
    description: 'Refresh model dictionary from provider endpoint',
    availableIn: { cli: true, chat: true },
    handler: async (ws, payload) => {
      const { providerModelsRefreshCommand } = await import('./commands/models.js');
      return providerModelsRefreshCommand(ws, payload.options);
    },
  });

  // ── Access commands ─────────────────────────────────────────────────────

  // ── Search & skills commands ────────────────────────────────────────────
  // ── Tools commands ──────────────────────────────────────────────────────────
  // ── Files commands ──────────────────────────────────────────────────────────
  // ── Files tree & patterns ───────────────────────────────────────────────
  // ── Utility commands ────────────────────────────────────────────────────

  d.register({
    key: 'codeEditList',
    description: 'List code edit proposals',
    availableIn: { cli: true, chat: true, tool: true },
    handler: async (ws, payload) => {
      const { codeEditListCommandAsync } = await import('./commands/code-edit.js');
      return codeEditListCommandAsync(ws, payload);
    },
  });

  d.register({
    key: 'codeEditApprove',
    description: 'Approve a code edit proposal',
    availableIn: { cli: true, chat: true, tool: true },
    handler: async (ws, payload) => {
      const { codeEditApproveCommandAsync } = await import('./commands/code-edit.js');
      return codeEditApproveCommandAsync(ws, payload);
    },
  });

  d.register({
    key: 'codeEditReject',
    description: 'Reject a code edit proposal',
    availableIn: { cli: true, chat: true, tool: true },
    handler: async (ws, payload, context) => {
      const { codeEditRejectCommandAsync } = await import('./commands/code-edit.js');
      return codeEditRejectCommandAsync(ws, payload, context);
    },
  });

  d.register({
    key: 'codeEditApply',
    description: 'Apply an approved code edit proposal',
    availableIn: { cli: true, chat: true, tool: true },
    handler: async (ws, payload, context) => {
      const { codeEditApplyCommandAsync } = await import('./commands/code-edit.js');
      return codeEditApplyCommandAsync(ws, payload, context);
    },
  });

  return d;
}
