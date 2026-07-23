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
import { CORE_SERVICE_TOKENS } from '../types.js';
import {
  resolveCommandArgs,
  parseArgsIntelligently,
  getPathValue,
  setPathValue,
} from './command-adapters.js';
import { CommandRegistry } from './command-registry.js';
import { CommandParameterCompletionService } from './command-parameter-completion-service.js';
import { DynamicSlashCommandFactory, type DynamicSlashEntry } from './dynamic-slash/catalog.js';
import { registerBuiltInCommands, registerHelpCommand } from './register-builtin-commands.js';
import { ZodSchemaTools } from '../utils/zod-schema.js';

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
  private readonly parameterCompletionService: CommandParameterCompletionService;
  private readonly schemaTools = new ZodSchemaTools();

  constructor(
    private readonly registry: ICommandRegistry,
    private readonly resolver: IServiceContainer
  ) {
    this.parameterCompletionService = new CommandParameterCompletionService(resolver);
  }

  private resolveWorkspaceRoot(): string {
    try {
      return this.resolver.resolve(CORE_SERVICE_TOKENS.WorkspaceRoot);
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
      const payloadWithContextDefaults = this.applyContextDefaultsFromSchema(
        command.metadata,
        payload,
        minimalCtx
      ) as TIn;

      const resolvedParams = resolveCommandArgs(
        command as ICommand<unknown, unknown>,
        payloadWithContextDefaults,
        minimalCtx
      ) as TIn;
      const result = await command.execute(resolvedParams, minimalCtx);
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

    const descriptor = this.registry.get(key);
    if (!descriptor) {
      return this.unknownCommandResponse(key);
    }

    const cmd = this.registry.resolve(key, this.resolver);
    if (!cmd) {
      return this.unknownCommandResponse(key);
    }

    try {
      const parsed =
        typeof payload === 'string'
          ? parseArgsIntelligently(payload, descriptor.parameters, descriptor.input)
          : payload;
      const withContextDefaults = this.applyContextDefaultsFromSchema(
        descriptor,
        parsed,
        executionContext
      );
      const withRuntimeDefaults = this.applyRuntimeBindingsFromMetadata(
        cmd,
        withContextDefaults,
        executionContext
      );

      const completed = await this.parameterCompletionService.complete(
        descriptor,
        withRuntimeDefaults,
        executionContext
      );

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

  private applyContextDefaultsFromSchema(
    descriptor: { parameters?: unknown },
    payload: unknown,
    ctx: ExecutionContext
  ): unknown {
    if (!descriptor.parameters) {
      return payload;
    }

    const schema = this.schemaTools.toJsonSchema(descriptor.parameters);
    if (!schema || typeof schema !== 'object') {
      return payload;
    }

    const properties = (schema as { properties?: unknown }).properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      return payload;
    }

    const propertyNames = Object.keys(properties as Record<string, unknown>);
    const fromContext: Record<string, unknown> = {};

    for (const propertyName of propertyNames) {
      const contextValue = (ctx as unknown as Record<string, unknown>)[propertyName];
      if (contextValue !== undefined) {
        fromContext[propertyName] = contextValue;
      }
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return fromContext;
    }

    const merged = {
      ...fromContext,
      ...(payload as Record<string, unknown>),
    };

    // "payload overrides context" only when payload value is defined.
    // If payload carries `undefined`, keep the context-derived value.
    for (const propertyName of propertyNames) {
      if ((payload as Record<string, unknown>)[propertyName] === undefined) {
        if (fromContext[propertyName] !== undefined) {
          merged[propertyName] = fromContext[propertyName];
        }
      }
    }

    return merged;
  }

  private applyRuntimeBindingsFromMetadata(
    cmd: ICommand<unknown, unknown>,
    payload: unknown,
    ctx: ExecutionContext
  ): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }

    const resolved = { ...(payload as Record<string, unknown>) };

    for (const contextParam of cmd.metadata.input?.contextParameters ?? []) {
      if (getPathValue(resolved, contextParam) !== undefined) continue;
      const contextValue = getPathValue(ctx, contextParam);
      if (contextValue !== undefined) {
        setPathValue(resolved, contextParam, contextValue);
      }
    }

    for (const [targetPath, binding] of Object.entries(cmd.metadata.workflowInputBindings ?? {})) {
      if (getPathValue(resolved, targetPath) !== undefined) continue;
      if (binding.fromLastResult && ctx.workflowLastResult !== undefined) {
        const value = getPathValue(ctx.workflowLastResult, binding.fromLastResult);
        if (value !== undefined) {
          setPathValue(resolved, targetPath, value);
        }
      }
      if (
        binding.fromWorkflowData &&
        ctx.workflowState !== undefined &&
        getPathValue(resolved, targetPath) === undefined
      ) {
        const value = getPathValue(ctx.workflowState, binding.fromWorkflowData);
        if (value !== undefined) {
          setPathValue(resolved, targetPath, value);
        }
      }
    }

    return resolved;
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
      const parsed =
        typeof params === 'string'
          ? parseArgsIntelligently(params, descriptor.parameters, descriptor.input)
          : params;
      const cmd = this.registry.resolve(key, this.resolver);
      if (!cmd) {
        return this.unknownCommandResponse(key);
      }
      const withContextDefaults = this.applyContextDefaultsFromSchema(
        descriptor,
        parsed,
        executionContext
      );
      const withRuntimeDefaults = this.applyRuntimeBindingsFromMetadata(
        cmd,
        withContextDefaults,
        executionContext
      );

      const completed = await this.parameterCompletionService.complete(
        descriptor,
        withRuntimeDefaults,
        executionContext
      );

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

  const dispatcher = new CommandDispatcher(registry, scopedResolver);
  registerHelpCommand(registry);

  return dispatcher;
}
