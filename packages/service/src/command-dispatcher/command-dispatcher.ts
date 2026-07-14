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
import { isCommandResponse } from '@ai-team/api-contracts';
import type {
  ICommandRegistry,
  IServiceContainer,
  ExecutionContext,
  ICommand,
  IEmitService,
} from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import { resolveCommandArgs, parseArgsIntelligently } from './command-adapters.js';
import { CommandRegistry } from './command-registry.js';
import { CommandParameterCompletionService } from './command-parameter-completion-service.js';
import { DynamicSlashCommandFactory, type DynamicSlashEntry } from './dynamic-slash/catalog.js';
import { registerBuiltInCommands, registerHelpCommand } from './register-builtin-commands.js';

function createMinimalExecutionContext(): ExecutionContext {
  return {
    history: [],
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
  private readonly parameterCompletionService: CommandParameterCompletionService;

  constructor(
    private readonly registry: ICommandRegistry,
    private readonly resolver: IServiceContainer
  ) {
    this.parameterCompletionService = new CommandParameterCompletionService(resolver);
  }

  private resolveWorkspaceRoot(): string {
    try {
      return this.resolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot);
    } catch {
      return '';
    }
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
    payload: TIn
  ): Promise<CommandResponse<TOut>> {
    const key = command.metadata.key;
    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      const minimalCtx = createMinimalExecutionContext();
      return directHandler('', payload, minimalCtx) as Promise<CommandResponse<TOut>>;
    }

    const minimalCtx = createMinimalExecutionContext();
    try {
      const result = await command.execute(payload, minimalCtx);
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
  dispatch(request: { command: string; payload: unknown }): Promise<CommandResponse>;
  async dispatch(
    keyOrRequest: string | { command: string; payload: unknown },
    params?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    if (typeof keyOrRequest === 'object' && 'command' in keyOrRequest) {
      return this.dispatchFromRequestAsync(keyOrRequest);
    }
    return this.dispatchByKeyAsync(keyOrRequest, params, ctx);
  }

  private async dispatchFromRequestAsync(request: {
    command: string;
    payload: unknown;
  }): Promise<CommandResponse<unknown>> {
    const { command: key, payload } = request;
    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      return directHandler('', payload, createMinimalExecutionContext());
    }

    const descriptor = this.registry.get(key);
    if (!descriptor) {
      return this.unknownCommandResponse(key);
    }

    const cmd = this.registry.resolve(key, this.resolver);
    if (!cmd) {
      return this.unknownCommandResponse(key);
    }

    const result = await cmd.execute(payload, createMinimalExecutionContext());
    if (isCommandResponse(result)) {
      return { ...result, message: result.message ?? '' };
    }
    return { status: 'ok', message: '', data: result };
  }

  private async dispatchByKeyAsync(
    key: string,
    params: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const descriptor = this.registry.get(key);
    if (!descriptor) {
      return this.unknownCommandResponse(key);
    }

    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      const executionContext = ctx ?? createMinimalExecutionContext();
      return directHandler(this.resolveWorkspaceRoot(), params, executionContext);
    }

    try {
      const executionContext = ctx ?? createMinimalExecutionContext();
      const parsed = typeof params === 'string' ? parseArgsIntelligently(params) : params;

      const completed = await this.parameterCompletionService.complete(
        descriptor,
        parsed,
        executionContext
      );

      const cmd = this.registry.resolve(key, this.resolver);
      if (!cmd) {
        return this.unknownCommandResponse(key);
      }

      const resolvedParams = resolveCommandArgs(cmd, completed, executionContext);
      const result = await cmd.execute(resolvedParams, executionContext);
      if (isCommandResponse(result)) {
        return { ...result, message: result.message ?? '' };
      }
      return { status: 'ok', message: '', data: result };
    } catch (error) {
      return this.commandDispatchFailedResponse(error);
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
    const es: IEmitService = emitService;
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
          const workspaceRoot = this.resolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot);
          const toolManager = this.resolver.resolve(COMMAND_FACTORY_TOKENS.ToolManager);
          const commandFactory = new DynamicSlashCommandFactory(es, {
            workspaceRoot,
            toolManager,
          });
          return commandFactory.buildCommand(entry);
        });
      } catch {
        // Built-in command with the same key already registered — skip silently.
      }
    }
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

  const scopedResolver = resolver.child();
  scopedResolver.registerInstance(COMMAND_FACTORY_TOKENS.WorkspaceRoot, workspaceRoot);

  const registry = new CommandRegistry();
  registerBuiltInCommands(registry, scopedResolver);

  const dispatcher = new CommandDispatcher(registry, scopedResolver);
  registerHelpCommand(registry);

  return dispatcher;
}
