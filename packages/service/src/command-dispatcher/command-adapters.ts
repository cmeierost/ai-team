/**
 * Surface adapters for ICommand.
 *
 * OOP-oriented adapter service:
 * - ICommand -> command registration handler
 * - ICommand -> LLM tool definition
 * - Runtime argument resolution and parsing helpers
 */

import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ILlmToolDefinition,
  CommandInputMetadata,
} from '@ai-team/core';

import { ZodSchemaTools } from '../utils/zod-schema.js';

export class CommandAdapterService {
  constructor(private readonly zodSchemaTools = new ZodSchemaTools()) {}

  toCommandRegistration(cmd: ICommand<unknown, unknown>): {
    handler: (
      workspaceRoot: string,
      payload: unknown,
      ctx: ExecutionContext
    ) => Promise<CommandResponse>;
  } {
    return {
      handler: async (
        _workspaceRoot: string,
        payload: unknown,
        ctx: ExecutionContext
      ): Promise<CommandResponse> => {
        const resolved = this.resolveCommandArgs(cmd, payload, ctx);
        const result = await cmd.execute(resolved, ctx);
        if (result && typeof result === 'object' && 'status' in result) {
          const r = result as CommandResponse;
          return { ...r, message: r.message ?? '' };
        }
        return { status: 'ok', message: '', data: result };
      },
    };
  }

  toLlmToolDefinition(cmd: ICommand<unknown, unknown>): ILlmToolDefinition {
    const rawSchema = cmd.metadata.parameters
      ? this.zodSchemaTools.toJsonSchema(cmd.metadata.parameters)
      : undefined;

    const defaultHidden = cmd.metadata.input?.contextParameters ?? [];
    const workflowBound = Object.keys(cmd.metadata.workflowInputBindings ?? {});
    const explicitHidden = cmd.metadata.llm?.hiddenParameters ?? [];
    const schema = this.stripHiddenParameters(rawSchema, [
      ...defaultHidden,
      ...workflowBound,
      ...explicitHidden,
    ]);

    return {
      name: cmd.metadata.key,
      description:
        cmd.metadata.llm?.description ?? cmd.metadata.summary ?? cmd.metadata.description,
      parameters: schema as Record<string, unknown> | undefined,
      group: cmd.metadata.group,
    };
  }

  resolveCommandArgs(
    cmd: ICommand<unknown, unknown>,
    payload: unknown,
    ctx: ExecutionContext
  ): unknown {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    const resolved = { ...(payload as Record<string, unknown>) };

    for (const contextParam of cmd.metadata.input?.contextParameters ?? []) {
      if (this.getPathValue(resolved, contextParam) !== undefined) continue;
      const contextValue = this.getContextValue(ctx, contextParam);
      if (contextValue !== undefined) {
        this.setPathValue(resolved, contextParam, contextValue);
      }
    }

    for (const [targetPath, binding] of Object.entries(cmd.metadata.workflowInputBindings ?? {})) {
      if (this.getPathValue(resolved, targetPath) !== undefined) continue;
      if (binding.fromLastResult && ctx.workflowLastResult !== undefined) {
        const value = this.getPathValue(ctx.workflowLastResult, binding.fromLastResult);
        if (value !== undefined) this.setPathValue(resolved, targetPath, value);
      }
      if (
        binding.fromWorkflowData &&
        ctx.workflowState !== undefined &&
        this.getPathValue(resolved, targetPath) === undefined
      ) {
        const value = this.getPathValue(ctx.workflowState, binding.fromWorkflowData);
        if (value !== undefined) this.setPathValue(resolved, targetPath, value);
      }
    }

    const missingRequired = (cmd.metadata.input?.requiredAtRuntime ?? []).filter(
      (path) => this.getPathValue(resolved, path) === undefined
    );

    if (missingRequired.length > 0) {
      throw new Error(
        `Missing required parameter(s) after runtime resolution: ${missingRequired.join(', ')}`
      );
    }

    if (cmd.metadata.parameters && typeof cmd.metadata.parameters.parse === 'function') {
      return cmd.metadata.parameters.parse(resolved);
    }

    return resolved;
  }

  parseArgsIntelligently(
    rawArgs: unknown,
    schema?: unknown,
    input?: CommandInputMetadata
  ): unknown {
    if (typeof rawArgs !== 'string') {
      return rawArgs;
    }

    if (input?.mode === 'raw-tail') {
      return rawArgs;
    }

    // Schema-less commands define their own raw argument grammar.
    if (!schema) {
      return rawArgs;
    }

    const trimmed = rawArgs.trim();
    if (!trimmed) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch (error) {
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON command arguments: ${reason}`);
      }
      // Not JSON, fall through to key=value parsing.
    }

    return this.parseRawArgs(trimmed, schema, input);
  }

  getPathValue(source: unknown, path: string): unknown {
    if (!source || typeof source !== 'object' || !path) {
      return undefined;
    }

    let current: unknown = source;
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  setPathValue(target: Record<string, unknown>, path: string, value: unknown): void {
    if (!path.includes('.')) {
      target[path] = value;
      return;
    }

    const parts = path.split('.');
    let current: Record<string, unknown> = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      const existing = current[part];
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const last = parts.at(-1);
    if (last) {
      current[last] = value;
    }
  }

  private getContextValue(ctx: ExecutionContext, key: string): unknown {
    return this.getPathValue(ctx, key);
  }

  private stripHiddenParameters(schema: unknown, hiddenParameters: string[] | undefined): unknown {
    if (!schema || !hiddenParameters || hiddenParameters.length === 0) {
      return schema;
    }

    if (typeof schema !== 'object' || schema === null) {
      return schema;
    }

    const next = { ...(schema as Record<string, unknown>) };
    const properties = (next.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(next.required) ? (next.required as string[]) : undefined;

    const hidden = new Set(hiddenParameters);
    for (const key of hidden) {
      delete properties[key];
    }

    next.properties = properties;
    if (required) {
      next.required = required.filter((key) => !hidden.has(key));
    }

    return next;
  }

  private reconstructNestedObject(flat: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [path, value] of Object.entries(flat)) {
      const parts = path.split('.');
      let current = result;

      for (let i = 0; i < parts.length - 1; i += 1) {
        const part = parts[i];
        if (!(part in current)) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }

      const last = parts.at(-1);
      if (last) {
        current[last] = value;
      }
    }

    return result;
  }

  private parseRawArgs(
    rawArgs: string,
    schema: unknown,
    input?: CommandInputMetadata
  ): unknown {
    if (!rawArgs.trim()) {
      return {};
    }

    const tokens = this.tokenizeRawArgs(rawArgs);
    if (input?.variadicParameter) {
      return this.parseVariadicArgs(tokens, schema, input.variadicParameter);
    }
    const flat = this.parseTokensToFlat(tokens);
    this.applyPositionalArgsFromSchema(flat, schema);
    const result = this.reconstructNestedObject(flat);

    return result;
  }

  private parseVariadicArgs(tokens: string[], schema: unknown, variadicParameter: string): unknown {
    const jsonSchema = this.zodSchemaTools.toJsonSchema(schema);
    if (!jsonSchema || typeof jsonSchema !== 'object') {
      throw new Error('Variadic command input requires an object parameter schema.');
    }

    const properties = (jsonSchema as { properties?: unknown }).properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      throw new Error('Variadic command input requires an object parameter schema.');
    }

    const propertyEntries = Object.entries(properties as Record<string, unknown>);
    const variadicIndex = propertyEntries.findIndex(([key]) => key === variadicParameter);
    if (variadicIndex < 0) {
      throw new Error(
        `Variadic parameter '${variadicParameter}' is not defined in the command schema.`
      );
    }

    const result: Record<string, unknown> = {};
    for (let index = 0; index < variadicIndex && index < tokens.length; index += 1) {
      const [key] = propertyEntries[index];
      result[key] = this.coerceArgValue(tokens[index]);
    }
    result[variadicParameter] = tokens.slice(variadicIndex);

    return result;
  }

  private applyPositionalArgsFromSchema(flat: Record<string, unknown>, schema: unknown): void {
    const positionals = Array.isArray(flat._)
      ? (flat._ as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];

    if (positionals.length === 0) {
      return;
    }

    if (!schema || typeof schema !== 'object' || typeof (schema as any).safeParse !== 'function') {
      return;
    }

    const jsonSchema = this.zodSchemaTools.toJsonSchema(schema);
    if (!jsonSchema || typeof jsonSchema !== 'object') {
      return;
    }

    const properties = (jsonSchema as { properties?: unknown }).properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      return;
    }

    const required = Array.isArray((jsonSchema as { required?: unknown }).required)
      ? ((jsonSchema as { required: unknown[] }).required.filter(
          (value): value is string => typeof value === 'string'
        ) as string[])
      : [];
    const optional = Object.keys(properties as Record<string, unknown>).filter(
      (key) => !required.includes(key)
    );

    const orderedTargets = [...required, ...optional];
    const unassignedTargets = orderedTargets.filter((key) => flat[key] === undefined);
    if (unassignedTargets.length === 0) {
      return;
    }

    const consumedCount = Math.min(positionals.length, unassignedTargets.length);
    let consumedPositionals = 0;
    for (let i = 0; i < consumedCount; i += 1) {
      const target = unassignedTargets[i];
      const isLastTarget = i === consumedCount - 1;
      const overflowStartsAt = i;
      const shouldFoldRemainder =
        isLastTarget && positionals.length > unassignedTargets.length && typeof positionals[i] === 'string';

      if (shouldFoldRemainder) {
        flat[target] = positionals.slice(overflowStartsAt).join(' ');
        consumedPositionals = positionals.length;
        break;
      }

      flat[target] = this.coerceArgValue(positionals[i]);
      consumedPositionals = i + 1;
    }

    const remaining = positionals.slice(consumedPositionals);
    if (remaining.length > 0) {
      flat._ = remaining;
    } else {
      delete flat._;
    }
  }

  private parseTokensToFlat(tokens: string[]): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    const positionals: string[] = [];

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token.startsWith('--')) {
        positionals.push(token);
        continue;
      }

      const eqIndex = token.indexOf('=');
      const key = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
      const inlineValue = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined;

      if (!key) {
        continue;
      }

      if (inlineValue !== undefined) {
        flat[key] = this.coerceArgValue(inlineValue);
        continue;
      }

      const next = tokens[i + 1];
      if (!next || next.startsWith('--')) {
        flat[key] = true;
        continue;
      }

      flat[key] = this.coerceArgValue(next);
      i += 1;
    }

    if (positionals.length > 0) {
      flat._ = positionals;
    }

    return flat;
  }

  private tokenizeRawArgs(rawArgs: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | undefined;
    let tokenStarted = false;

    for (let index = 0; index < rawArgs.length; index += 1) {
      const char = rawArgs[index];

      if (quote) {
        if (char === quote) {
          quote = undefined;
          tokenStarted = true;
          continue;
        }
        if (char === '\\' && (rawArgs[index + 1] === quote || rawArgs[index + 1] === '\\')) {
          current += rawArgs[index + 1];
          index += 1;
          tokenStarted = true;
          continue;
        }
        current += char;
        tokenStarted = true;
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        tokenStarted = true;
        continue;
      }
      if (/\s/.test(char)) {
        if (tokenStarted) {
          tokens.push(current);
          current = '';
          tokenStarted = false;
        }
        continue;
      }
      current += char;
      tokenStarted = true;
    }

    if (quote) {
      throw new Error(`Unterminated ${quote === '"' ? 'double' : 'single'} quote.`);
    }
    if (tokenStarted) {
      tokens.push(current);
    }

    return tokens;
  }

  private coerceArgValue(value: string): string | number | boolean {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;

    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }

    return value;
  }
}

export const commandAdapterService = new CommandAdapterService();

// Compatibility function API (delegates to the OOP service)
export function toCommandRegistration(cmd: ICommand<unknown, unknown>) {
  return commandAdapterService.toCommandRegistration(cmd);
}

export function toLlmToolDefinition(cmd: ICommand<unknown, unknown>): ILlmToolDefinition {
  return commandAdapterService.toLlmToolDefinition(cmd);
}

export function resolveCommandArgs(
  cmd: ICommand<unknown, unknown>,
  payload: unknown,
  ctx: ExecutionContext
): unknown {
  return commandAdapterService.resolveCommandArgs(cmd, payload, ctx);
}

export function parseArgsIntelligently(
  rawArgs: unknown,
  schema?: unknown,
  input?: CommandInputMetadata
): unknown {
  return commandAdapterService.parseArgsIntelligently(rawArgs, schema, input);
}

export function getPathValue(source: unknown, path: string): unknown {
  return commandAdapterService.getPathValue(source, path);
}

export function setPathValue(target: Record<string, unknown>, path: string, value: unknown): void {
  commandAdapterService.setPathValue(target, path, value);
}
