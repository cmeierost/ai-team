/**
 * Unified command dispatcher — single service-layer entry point for all commands.
 *
 * Dispatches by command key against an ICommandRegistry. The caller provides
 * a fully-constructed ExecutionContext — no interaction hooks or context
 * conversion happens here. CLI creates a fresh context from request parameters.
 */

import type {
  CommandAvailability,
  CommandDescriptor,
  CommandResponse,
  ICommandDispatcher,
} from '@ai-team/api-contracts';
import type {
  ICommandRegistry,
  ICommandDescriptor,
  IServiceContainer,
  ExecutionContext,
  ICommand,
  IEmitService,
} from '@ai-team/core';
import { CORE_SERVICE_TOKENS } from '../types.js';
import { CommandRegistry } from './command-registry.js';
import { CommandInvocationPreparer } from './command-invocation-preparer.js';
import { DynamicSlashCommandFactory, type DynamicSlashEntry } from './dynamic-slash/catalog.js';
import { registerBuiltInCommands, registerHelpCommand } from './register-builtin-commands.js';

function createMinimalExecutionContext(ctx?: Partial<ExecutionContext>): ExecutionContext {
  return {
    ...ctx,
    history: ctx?.history ?? [],
  };
}

/**
 * Resolves commands from an ICommandRegistry and executes them with a
 * caller-provided ExecutionContext. No context conversion happens here.
 */
export class CommandDispatcher implements ICommandDispatcher {
  private readonly _directHandlers: Map<
    string,
    (workspaceRoot: string, payload: unknown, ctx: ExecutionContext) => Promise<CommandResponse>
  > = new Map();
  private readonly _directCommands: Map<string, ICommand<unknown, unknown>> = new Map();
  private readonly invocationPreparer: CommandInvocationPreparer;

  constructor(
    private readonly registry: ICommandRegistry,
    private readonly resolver: IServiceContainer
  ) {
    this.invocationPreparer = new CommandInvocationPreparer(resolver);
  }

  private resolveWorkspaceRoot(): string {
    try {
      return this.resolver.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot);
    } catch {
      return '';
    }
  }

  private findRegistryEntry(key: string): {
    registry: ICommandRegistry;
    descriptor: ICommandDescriptor;
  } | undefined {
    const localDescriptor = this.registry.get(key);
    if (localDescriptor) return { registry: this.registry, descriptor: localDescriptor };

    const sharedRegistry = this.resolver.tryResolve(
      CORE_SERVICE_TOKENS.CommandRegistry
    ) as ICommandRegistry | undefined;
    if (!sharedRegistry || sharedRegistry === this.registry) return undefined;

    const sharedDescriptor = sharedRegistry.get(key);
    return sharedDescriptor
      ? { registry: sharedRegistry, descriptor: sharedDescriptor }
      : undefined;
  }

  register(entry: {
    key: string;
    description: string;
    availableIn: CommandAvailability;
    handler: (
      workspaceRoot: string,
      payload: unknown,
      ctx: ExecutionContext
    ) => Promise<CommandResponse>;
  }): void {
    this._directHandlers.set(entry.key, entry.handler);
    try {
      this.registry.register(
        { key: entry.key, description: entry.description, availableIn: entry.availableIn },
        () =>
          ({
            metadata: {
              key: entry.key,
              description: entry.description,
              availableIn: entry.availableIn,
            },
            execute: async (params: unknown, ctx: ExecutionContext) =>
              entry.handler(this.resolveWorkspaceRoot(), params, ctx),
          }) as unknown as ICommand<unknown, unknown>
      );
    } catch {
      // duplicate key — already registered
    }
  }

  registerCommand<TIn, TOut>(cmd: ICommand<TIn, TOut>): void {
    this._directCommands.set(cmd.metadata.key, cmd);
  }

  async dispatchCommand<TIn, TOut>(
    command: ICommand<TIn, TOut>,
    payload: TIn,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<TOut>> {
    const key = command.metadata.key;
    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      const minimalCtx = createMinimalExecutionContext(ctx);
      return directHandler('', payload, minimalCtx) as Promise<CommandResponse<TOut>>;
    }

    const minimalCtx = createMinimalExecutionContext(ctx);
    try {
      const prepared = await this.invocationPreparer.prepare(
        command as ICommand<unknown, unknown>,
        command.metadata,
        payload,
        minimalCtx
      );
      const result = await command.execute(prepared.params as TIn, prepared.context);
      if (result && typeof result === 'object' && 'status' in result) {
        const r = result as CommandResponse<TOut>;
        return { ...r, message: r.message ?? '' };
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

  dispatch(key: string, params: unknown, ctx: ExecutionContext): Promise<CommandResponse<unknown>>;
  dispatch(
    request: { command: string; payload: unknown },
    ctx?: ExecutionContext
  ): Promise<CommandResponse>;
  async dispatch(
    keyOrRequest: string | { command: string; payload: unknown },
    params?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    if (typeof keyOrRequest === 'object' && 'command' in keyOrRequest) {
      const requestCtx = (ctx ?? (params as ExecutionContext | undefined)) as
        | ExecutionContext
        | undefined;
      return this.dispatchFromRequestAsync(keyOrRequest, requestCtx);
    }
    return this.dispatchByKeyAsync(keyOrRequest, params, ctx);
  }

  private async dispatchFromRequestAsync(
    request: {
      command: string;
      payload: unknown;
    },
    ctx?: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const executionContext = createMinimalExecutionContext(ctx);
    const { command: key, payload } = request;
    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      return directHandler('', payload, executionContext);
    }

    const registryEntry = this.findRegistryEntry(key);
    if (!registryEntry) {
      return this.unknownCommandResponse(key);
    }
    const { registry, descriptor } = registryEntry;

    const cmd = registry.resolve(key, this.resolver);
    if (!cmd) {
      return this.unknownCommandResponse(key);
    }

    try {
      const prepared = await this.invocationPreparer.prepare(cmd, descriptor, payload, executionContext);
      const result = await cmd.execute(prepared.params, prepared.context);
      if (isCommandExecutionResponse(result)) {
        return this.formatHumanCommandResponse(result, cmd, executionContext);
      }
      return { status: 'ok', message: '', data: result };
    } catch (error) {
      return this.commandDispatchFailedResponse(error);
    }
  }

  private async dispatchByKeyAsync(
    key: string,
    params: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const registryEntry = this.findRegistryEntry(key);
    if (!registryEntry) {
      return this.unknownCommandResponse(key);
    }
    const { registry, descriptor } = registryEntry;

    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      const executionContext = ctx ?? createMinimalExecutionContext();
      return directHandler(this.resolveWorkspaceRoot(), params, executionContext);
    }

    try {
      const executionContext = ctx ?? createMinimalExecutionContext();
      const cmd = registry.resolve(key, this.resolver);
      if (!cmd) {
        return this.unknownCommandResponse(key);
      }
      const prepared = await this.invocationPreparer.prepare(cmd, descriptor, params, executionContext);
      const result = await cmd.execute(prepared.params, prepared.context);
      if (isCommandExecutionResponse(result)) {
        return { ...result, message: result.message ?? '' };
      }
      return { status: 'ok', message: '', data: result };
    } catch (error) {
      return this.commandDispatchFailedResponse(error);
    }
  }

  private formatHumanCommandResponse(
    response: CommandResponse<unknown>,
    command: ICommand<unknown, unknown>,
    context: ExecutionContext
  ): CommandResponse<unknown> {
    if (response.status !== 'ok' || context.invocationSurface !== 'slash') {
      return { ...response, message: response.message ?? '' };
    }

    const formatter = command.formatForLlm;
    if (!formatter || response.data === undefined) {
      return { ...response, message: response.message ?? '' };
    }

    try {
      const formatted = formatter.call(command, response.data);
      const message = typeof formatted === 'string'
        ? formatted
        : formatted === undefined
          ? response.message ?? ''
          : JSON.stringify(formatted, null, 2);
      return { ...response, message };
    } catch {
      // Formatting must never turn a successful command into a failed one.
      return { ...response, message: response.message ?? '' };
    }
  }

  private unknownCommandResponse(key: string): CommandResponse<unknown> {
    return {
      status: 'error',
      message: `Unknown command '${key}'`,
      error: { code: 'UNKNOWN_COMMAND', details: { key } },
    };
  }

  private commandDispatchFailedResponse(error: unknown): CommandResponse<unknown> {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Command dispatch failed',
      error: { code: 'COMMAND_DISPATCH_FAILED', details: error },
    };
  }

  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[] {
    return this.registry.getAll({ availableIn: filter });
  }

  getCommand(key: string): CommandDescriptor | undefined {
    return this.registry.get(key);
  }

  /**
   * Register dynamic slash commands (loaded from workspace skills/prompts/workflows)
   * after initial construction. Registers the descriptor from entry metadata and a
   * typed factory based on the entry source. Built-in commands always win — duplicate
   * keys are silently skipped, not overwritten.
   */
  registerDynamic(entries: DynamicSlashEntry[], emitService: IEmitService): void {
    for (const entry of entries) {
      try {
        const descriptor = {
          key: entry.key,
          usage: entry.usage,
          description: entry.description,
          availableIn: { chat: true, tool: false, cli: false } as const,
          group: 'chat',
          path: ['dynamic', entry.source],
        };
        this.registry.register(descriptor, () => {
          const workspaceRoot = this.resolver.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot);
          const sessionManager = this.resolver.resolve(CORE_SERVICE_TOKENS.SessionManager);
          const toolManager = this.resolver.resolve(CORE_SERVICE_TOKENS.ToolManager);
          const commandFactory = new DynamicSlashCommandFactory(
            workspaceRoot,
            emitService,
            sessionManager,
            toolManager
          );
          return commandFactory.buildCommand(entry);
        });
      } catch {
        // Built-in command with the same key already registered — skip silently.
      }
    }
  }
}

function isCommandExecutionResponse(value: unknown): value is CommandResponse<unknown> {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return status === 'ok' || status === 'error' || status === 'cancelled';
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

  const scopedResolver = resolver.child();
  scopedResolver.registerInstance(CORE_SERVICE_TOKENS.WorkspaceRoot, workspaceRoot);

  const registry = new CommandRegistry();
  registerBuiltInCommands(registry, scopedResolver);

  // Filesystem tools live in the service-layer registry because they require
  // workspace-scoped dependencies. Mirror the human-readable filesystem
  // commands into the dispatcher registry so their `chat` availability also
  // makes them resolvable as slash commands.
  const serviceRegistry = scopedResolver.resolve(CORE_SERVICE_TOKENS.CommandRegistry);
  for (const key of ['fs-read', 'fs-search', 'fs-tree', 'fs-write']) {
    const descriptor = serviceRegistry.get(key);
    if (!descriptor?.availableIn?.chat) continue;
    registry.register(descriptor, (resolver) => {
      const command = serviceRegistry.resolve(key, resolver);
      if (!command) throw new Error(`Unable to resolve filesystem command '${key}'.`);
      return command;
    });
  }

  const dispatcher = new CommandDispatcher(registry, scopedResolver);
  registerHelpCommand(registry);

  return dispatcher;
}
