import { randomUUID } from 'node:crypto';
import type {
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IServiceContainer,
  PreparedCommandInvocation,
} from '@ai-team/core';
import {
  getPathValue,
  parseArgsIntelligently,
  resolveCommandArgs,
  setPathValue,
} from './command-adapters.js';
import { CommandParameterCompletionService } from './command-parameter-completion-service.js';
import { ZodSchemaTools } from '../utils/zod-schema.js';

/**
 * Shared parameter, context-binding, and completion seam used before invoking
 * an ICommand from any service-owned caller.
 */
export class CommandInvocationPreparer {
  private readonly parameterCompletionService: CommandParameterCompletionService;
  private readonly schemaTools = new ZodSchemaTools();

  constructor(private readonly resolver: IServiceContainer) {
    this.parameterCompletionService = new CommandParameterCompletionService(resolver);
  }

  async prepare(
    command: ICommand<unknown, unknown>,
    descriptor: ICommandDescriptor,
    payload: unknown,
    context: ExecutionContext
  ): Promise<PreparedCommandInvocation> {
    const parsed =
      typeof payload === 'string'
        ? parseArgsIntelligently(payload, descriptor.parameters, descriptor.input)
        : payload;
    const withContextDefaults = this.applyContextDefaultsFromSchema(descriptor, parsed, context);
    const withRuntimeDefaults = this.applyRuntimeBindingsFromMetadata(
      command,
      withContextDefaults,
      context
    );
    const completed = await this.parameterCompletionService.complete(
      descriptor,
      withRuntimeDefaults,
      context
    );

    return {
      commandKey: command.metadata.key,
      params: resolveCommandArgs(command, completed, context),
      context,
      idempotencyKey: this.getIdempotencyKey(command.metadata.key, context),
    };
  }

  private getIdempotencyKey(commandKey: string, context: ExecutionContext): string {
    if (context.workflowInstanceId) {
      return `${context.workflowInstanceId}:${context.stepId ?? commandKey}:${commandKey}`;
    }
    return context.commandInvocation?.callId ?? `${commandKey}:${randomUUID()}`;
  }

  private applyContextDefaultsFromSchema(
    descriptor: { parameters?: unknown },
    payload: unknown,
    ctx: ExecutionContext
  ): unknown {
    if (!descriptor.parameters) return payload;

    const schema = this.schemaTools.toJsonSchema(descriptor.parameters);
    if (!schema || typeof schema !== 'object') return payload;

    const properties = (schema as { properties?: unknown }).properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return payload;

    const propertyNames = Object.keys(properties as Record<string, unknown>);
    const fromContext: Record<string, unknown> = {};
    for (const propertyName of propertyNames) {
      const contextValue = (ctx as unknown as Record<string, unknown>)[propertyName];
      if (contextValue !== undefined) fromContext[propertyName] = contextValue;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fromContext;

    const merged = { ...fromContext, ...(payload as Record<string, unknown>) };
    for (const propertyName of propertyNames) {
      if ((payload as Record<string, unknown>)[propertyName] === undefined && fromContext[propertyName] !== undefined) {
        merged[propertyName] = fromContext[propertyName];
      }
    }
    return merged;
  }

  private applyRuntimeBindingsFromMetadata(
    command: ICommand<unknown, unknown>,
    payload: unknown,
    ctx: ExecutionContext
  ): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;

    const resolved = { ...(payload as Record<string, unknown>) };
    for (const contextParam of command.metadata.input?.contextParameters ?? []) {
      if (getPathValue(resolved, contextParam) !== undefined) continue;
      const contextValue = getPathValue(ctx, contextParam);
      if (contextValue !== undefined) setPathValue(resolved, contextParam, contextValue);
    }
    for (const [targetPath, binding] of Object.entries(command.metadata.workflowInputBindings ?? {})) {
      if (getPathValue(resolved, targetPath) !== undefined) continue;
      if (binding.fromLastResult && ctx.workflowLastResult !== undefined) {
        const value = getPathValue(ctx.workflowLastResult, binding.fromLastResult);
        if (value !== undefined) setPathValue(resolved, targetPath, value);
      }
      if (binding.fromWorkflowData && ctx.workflowState !== undefined && getPathValue(resolved, targetPath) === undefined) {
        const value = getPathValue(ctx.workflowState, binding.fromWorkflowData);
        if (value !== undefined) setPathValue(resolved, targetPath, value);
      }
    }
    return resolved;
  }
}
