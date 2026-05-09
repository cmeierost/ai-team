/**
 * Surface adapters for ICommand.
 *
 * A single ICommand definition is the source of truth.
 * These functions derive what each surface needs — CLI metadata, LLM tool
 * definition, slash command, and command registration — without any
 * duplication in the command file itself.
 *
 *   ICommand
 *     ├── toCliMetadata()       → CliCommandMetadata  (Commander options from Zod schema)
 *     ├── toCommandRegistration() → CommandRegistration (dispatcher handler)
 *     ├── toSlashCommand()      → ICommand            (chat /key args)
 *     └── toLlmToolDefinition() → ILlmToolDefinition  (already in CommandRegistry)
 */

import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { CommandResponse } from '@ai-team/core';
import type { CliCommandMetadata, CommandOptionMetadata } from '@ai-team/core';
import type {
  InteractionContext,
} from '@ai-team/api-contracts';
import type { ILlmToolDefinition } from '@ai-team/core';
import type { CommandRegistration } from './command-dispatcher.js';
import type { SessionSnapshot } from '@ai-team/core';

// ── Zod → Commander options ───────────────────────────────────────────────────

/**
 * Walk a Zod object schema and produce Commander-compatible option descriptors.
 * Covers the most common Zod types used in command parameters.
 */
export function zodToCliOptions(schema: unknown): CommandOptionMetadata[] {
  if (!schema || typeof schema !== 'object') return [];

  const shape = (schema as any)._def?.shape?.() ?? (schema as any).shape;
  if (!shape) return [];

  return Object.entries(shape).map(([name, field]: [string, any]): CommandOptionMetadata => {
    const isOptional =
      field._def?.typeName === 'ZodOptional' ||
      field._def?.typeName === 'ZodDefault' ||
      field._def?.defaultValue !== undefined;

    const inner = field._def?.innerType ?? field._def?.type ?? field;
    const typeName: string = inner._def?.typeName ?? '';
    const description: string = field.description ?? field._def?.description ?? name;
    const defaultValue = field._def?.defaultValue?.();

    const isBoolean = typeName === 'ZodBoolean';
    const flagValue = isBoolean || isOptional ? `[${name}]` : `<${name}>`;
    const flags = `--${name} ${isBoolean ? '' : flagValue}`.trimEnd();

    return defaultValue !== undefined
      ? { flags, description, defaultValue }
      : { flags, description };
  });
}

// ── ICommand → CliCommandMetadata ────────────────────────────────────────────

export function toCliMetadata<TParams, TContext, TResult>(
  cmd: ICommand<TParams, TContext, TResult>
): CliCommandMetadata {
  if (!cmd.cli) {
    throw new Error(`ICommand '${cmd.key}' has no cli routing info (missing cmd.cli)`);
  }
  return {
    key: cmd.key,
    command: cmd.cli.command,
    parentKey: cmd.cli.parentKey,
    description: cmd.help?.description ?? cmd.description,
    llmCallable: Boolean(cmd.availableIn.tool),
    directCli: Boolean(cmd.availableIn.cli),
    aliases: cmd.aliases,
    options: cmd.parameters ? zodToCliOptions(cmd.parameters) : undefined,
    hints: cmd.help?.hints,
    examples: cmd.help?.examples?.map((example: { value: string }) => example.value),
    jsonSignature: cmd.input?.jsonSignature,
  };
}

// ── ICommand → CommandRegistration ───────────────────────────────────────────

/**
 * Wrap an ICommand as a CommandRegistration for the CommandDispatcher.
 * The ICommand.execute signature is adapted to the dispatcher's
 * (workspaceRoot, payload, context) handler shape.
 * 
 * Command results are automatically wrapped in CommandResponse envelopes.
 */
export function toCommandRegistration<TCommand extends string = string>(
  cmd: ICommand<unknown, void, unknown>
): CommandRegistration<TCommand> {
  return {
    key: cmd.key as TCommand,
    aliases: cmd.aliases,
    description: cmd.description,
    usage: cmd.cli?.command,
    availableIn: cmd.availableIn,
    path: cmd.path,
    help: cmd.help,
    llm: cmd.llm,
    intents: cmd.intents,
    intentExamples: cmd.intentExamples,
    input: cmd.input,
    handler: async (workspaceRoot: string, payload: unknown, context: InteractionContext) => {
      const runtime = interactionContextToRuntime(workspaceRoot, context);
      const resolvedPayload = resolveCommandArgs(cmd, payload, runtime);
      const result = await cmd.execute(resolvedPayload, undefined as void, runtime);
      
      // Wrap bare command results in CommandResponse envelope
      if (result && typeof result === 'object' && 'status' in result) {
        return result as CommandResponse<unknown>;
      }
      return { status: 'ok' as const, message: '', data: result } as CommandResponse<unknown>;
    },
  };
}

// ── ICommand → Slash ICommand ────────────────────────────────────────────────

/**
 * Wrap an ICommand as a chat slash command.
 * Raw string args are parsed via the command's Zod schema when present,
 * or passed through as-is for commands that accept a raw string payload.
 * 
 * Parameters can specify context overrides (agentId, sessionId, etc.) which
 * are merged into the command's execution context.
 * 
 * Parsing strategy:
 * 1. Try JSON.parse first (user passed JSON literal like /hire {"name": "alice"})
 * 2. Fall back to key=value syntax (user passed /hire --name alice)
 */
export function toSlashCommand<TContext extends SessionSnapshot>(
  cmd: ICommand<unknown, TContext, unknown>
): ICommand<string, TContext, CommandResponse | void> {
  return {
    key: cmd.key,
    aliases: cmd.aliases,
    description: cmd.description,
    usage: cmd.usage,
    availableIn: {
      chat: true,
      tool: Boolean(cmd.availableIn.tool),
      cli: false,
    },
    execute: async (rawArgs: string, ctx: TContext) => {
      const runtime = sessionSnapshotToRuntime(ctx);
      const parsed = cmd.parameters
        ? parseArgsIntelligently(rawArgs, cmd.parameters)
        : rawArgs;
      
      // Extract context overrides from parsed params and merge with base context
      const parsedObj = typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      const contextOverrides = mapParamsToContext(
        parsedObj,
        cmd.input?.contextOverrideAllowlist,
        runtime.calledByHuman
      );
      const mergedCtx = { ...ctx, ...contextOverrides } as TContext;
      const resolvedPayload = resolveCommandArgs(cmd, parsed, runtime);
      
      const result = await cmd.execute(resolvedPayload, mergedCtx, runtime);
      return toCommandResponse(result);
    },
  };
}

// ── ICommand → ILlmToolDefinition ────────────────────────────────────────────

export function toLlmToolDefinition(cmd: ICommand<unknown, unknown, unknown>): ILlmToolDefinition {
  const rawSchema = cmd.parameters ? zodSchemaToJsonSchema(cmd.parameters) : undefined;
  const defaultHidden = cmd.input?.contextParameters ?? [];
  const explicitHidden = cmd.llm?.hiddenParameters ?? [];
  const schema = stripHiddenParameters(rawSchema, [...defaultHidden, ...explicitHidden]);
  return {
    name: cmd.key,
    description: cmd.llm?.description ?? cmd.summary ?? cmd.description,
    parameters: schema as Record<string, unknown> | undefined,
    group: cmd.group,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract context from parsed command parameters.
 * 
 * Supports optional context overrides in params:
 *   { agentId?: string, sessionId?: string, workspaceRoot?: string, workflowId?: string, ... }
 * 
 * Returns a partial context object that can be merged with orchestrator context.
 */
function mapParamsToContext(
  params: Record<string, unknown>,
  allowlist: string[] | undefined,
  calledByHuman: boolean | undefined
): Record<string, unknown> {
  if (!calledByHuman) {
    return {};
  }

  const ctx: Record<string, unknown> = {};
  const allowed = allowlist && allowlist.length > 0 ? new Set(allowlist) : undefined;

  const isAllowed = (key: string): boolean => {
    return !allowed || allowed.has(key);
  };

  // Extract standard context fields from params if present
  if (isAllowed('agentId') && 'agentId' in params && typeof params.agentId === 'string') {
    ctx.agent = { id: params.agentId } as any;
  }
  if (isAllowed('sessionId') && 'sessionId' in params && typeof params.sessionId === 'string') {
    ctx.sessionId = params.sessionId as string;
  }
  if (isAllowed('workspaceRoot') && 'workspaceRoot' in params && typeof params.workspaceRoot === 'string') {
    ctx.workspaceRoot = params.workspaceRoot as string;
  }
  if (isAllowed('workflowId') && 'workflowId' in params) {
    if (!ctx.workflowState) {
      ctx.workflowState = {} as any;
    }
    (ctx.workflowState as any).workflowId = params.workflowId;
  }
  if (isAllowed('workflowInstanceId') && 'workflowInstanceId' in params) {
    if (!ctx.workflowState) {
      ctx.workflowState = {} as any;
    }
    (ctx.workflowState as any).instanceId = params.workflowInstanceId;
  }

  const continuationToken = getPathValue(params, 'workflow.continuationToken');
  if (isAllowed('workflow.continuationToken') && typeof continuationToken === 'string') {
    if (!ctx.workflowState) {
      ctx.workflowState = {} as any;
    }
    (ctx.workflowState as any).continuationToken = continuationToken;
  }

  return ctx;
}

function resolveCommandArgs(
  cmd: ICommand<unknown, unknown, unknown>,
  payload: unknown,
  runtime: CommandRuntime
): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const resolved = { ...(payload as Record<string, unknown>) };

  for (const contextParam of cmd.input?.contextParameters ?? []) {
    if (getPathValue(resolved, contextParam) !== undefined) continue;
    const contextValue = getRuntimeContextValue(runtime, contextParam);
    if (contextValue !== undefined) {
      setPathValue(resolved, contextParam, contextValue);
    }
  }

  const bindings = cmd.workflowInputBindings ?? {};
  for (const [paramName, binding] of Object.entries(bindings)) {
    if (getPathValue(resolved, paramName) !== undefined) continue;

    const fromLastResult = binding.fromLastResult
      ? getPathValue(runtime.workflowLastResult, binding.fromLastResult)
      : undefined;
    if (fromLastResult !== undefined) {
      setPathValue(resolved, paramName, fromLastResult);
      continue;
    }

    const fromWorkflowData = binding.fromWorkflowData
      ? getPathValue(runtime.workflowData, binding.fromWorkflowData)
      : undefined;
    if (fromWorkflowData !== undefined) {
      setPathValue(resolved, paramName, fromWorkflowData);
    }
  }

  const missingRequired = (cmd.input?.requiredAtRuntime ?? []).filter(
    (path) => getPathValue(resolved, path) === undefined
  );
  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required parameter(s) after runtime resolution: ${missingRequired.join(', ')}`
    );
  }

  if (cmd.parameters && typeof (cmd.parameters as any).parse === 'function') {
    return (cmd.parameters as any).parse(resolved);
  }

  return resolved;
}

function getRuntimeContextValue(runtime: CommandRuntime, key: string): unknown {
  const direct = (runtime as unknown as Record<string, unknown>)[key];
  if (direct !== undefined) return direct;

  if (key.startsWith('workflow.')) {
    const workflowKey = key.slice('workflow.'.length);
    if (workflowKey === 'continuationToken') {
      return runtime.workflowState?.continuationToken;
    }
  }

  return getPathValue(runtime as unknown as Record<string, unknown>, key);
}

function getPathValue(source: unknown, path: string): unknown {
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

function setPathValue(target: Record<string, unknown>, path: string, value: unknown): void {
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
  current[parts[parts.length - 1]] = value;
}

function interactionContextToRuntime(
  workspaceRoot: string,
  ctx: InteractionContext
): CommandRuntime {
  const invocationSurface = (ctx as any).invocationSurface ?? 'api';
  const calledByHuman =
    (ctx as any).calledByHuman ??
    (invocationSurface === 'cli' || invocationSurface === 'slash');
  return {
    invocationSurface,
    calledByHuman,
    callerType: calledByHuman ? 'human' : (ctx as any).callerType,
    workspaceRoot,
    agentId: (ctx as any).agentId,
    sessionId: (ctx as any).sessionId,
    workflowId: (ctx as any).workflowId,
    workflowLastResult: (ctx as any).workflowLastResult,
    workflowData: (ctx as any).workflowData,
    signal: ctx.signal,
    emit: ctx.emit as ((event: unknown) => void) | undefined,
    questionInput: ctx.questionInput,
    questionConfirm: ctx.questionConfirm,
    questionSelect: ctx.questionSelect,
    questionPassword: ctx.questionPassword,
    questionChecklist: ctx.questionChecklist,
    workflowState: ctx.workflowState as CommandRuntime['workflowState'],
    onWorkflowFrame: ctx.onWorkflowFrame as CommandRuntime['onWorkflowFrame'],
  };
}

function sessionSnapshotToRuntime(ctx: SessionSnapshot): CommandRuntime {
  return {
    invocationSurface: 'slash',
    calledByHuman: true,
    callerType: 'human',
    workspaceRoot: '',
    agentId: ctx.agent?.id,
    sessionId: ctx.sessionId,
  };
}

function stripHiddenParameters(
  schema: unknown,
  hiddenParameters: string[] | undefined
): unknown {
  if (!schema || !hiddenParameters || hiddenParameters.length === 0) {
    return schema;
  }

  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  const next = { ...(schema as Record<string, unknown>) };
  const properties = (next.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(next.required)
    ? (next.required as string[])
    : undefined;

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

/**
 * Reconstruct nested objects from flat dot-notation keys.
 * 
 * Example:
 *   { "agent.id": "michael", "user.profile.name": "alice" }
 * Becomes:
 *   { agent: { id: "michael" }, user: { profile: { name: "alice" } } }
 */
function reconstructNestedObject(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let current = result;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    
    current[parts[parts.length - 1]] = value;
  }
  
  return result;
}

/**
 * Intelligently parse command arguments from a raw string.
 * 
 * Strategy:
 * 1. Try JSON.parse first (user passed JSON literal)
 * 2. Fall back to parseRawArgs with schema (user passed --key value syntax)
 * 3. If both fail, return empty object
 * 
 * Returns parsed parameters as an object ready for command execution.
 */
export function parseArgsIntelligently(
  rawArgs: string | unknown,
  schema?: unknown
): unknown {
  // If already an object, return as-is
  if (typeof rawArgs !== 'string') {
    return rawArgs;
  }

  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return schema && typeof (schema as any).parse === 'function'
      ? (schema as any).parse({})
      : {};
  }

  // Try JSON parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      // Validate with schema if available
      if (schema && typeof (schema as any).parse === 'function') {
        return (schema as any).parse(parsed);
      }
      return parsed;
    }
  } catch {
    // Not valid JSON, continue to parseRawArgs
  }

  // Fall back to key=value parsing
  return parseRawArgs(trimmed, schema);
}

/** Minimal raw-arg parser: maps slash strings into a structured object with support for nested params via dot notation. */
function parseRawArgs(rawArgs: string, schema: unknown): unknown {
  if (!rawArgs.trim()) {
    return schema && typeof (schema as any).parse === 'function' ? (schema as any).parse({}) : {};
  }

  const flat: Record<string, unknown> = {};
  const positionals: string[] = [];
  const tokens = tokenizeRawArgs(rawArgs);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const eqIndex = token.indexOf('=');
      const key = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
      const inlineValue = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined;

      if (!key) {
        continue;
      }

      if (inlineValue !== undefined) {
        flat[key] = coerceArgValue(inlineValue);
        continue;
      }

      const next = tokens[i + 1];
      if (!next || next.startsWith('--')) {
        flat[key] = true;
      } else {
        flat[key] = coerceArgValue(next);
        i += 1;
      }
      continue;
    }

    positionals.push(token);
  }

  if (positionals.length > 0) {
    flat._ = positionals;
  }

  // Reconstruct nested objects from dot notation (e.g., "agent.id" → { agent: { id: ... } })
  const result = reconstructNestedObject(flat);

  return schema && typeof (schema as any).parse === 'function'
    ? (schema as any).parse(result)
    : result;
}

function tokenizeRawArgs(rawArgs: string): string[] {
  const tokens: string[] = [];
  const tokenRegex = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g;

  for (const match of rawArgs.matchAll(tokenRegex)) {
    const token = match[0] ?? '';
    tokens.push(unquoteToken(token));
  }

  return tokens;
}

function unquoteToken(token: string): string {
  if (token.length < 2) {
    return token;
  }

  const quote = token[0];
  if ((quote !== '"' && quote !== "'") || token[token.length - 1] !== quote) {
    return token;
  }

  const inner = token.slice(1, -1);
  return inner.replace(/\\(["'\\])/g, '$1');
}

function coerceArgValue(value: string): string | number | boolean {
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

function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && typeof (schema as any).toJSONSchema === 'function') {
    return (schema as any).toJSONSchema() as Record<string, unknown>;
  }
  return { type: 'object', properties: {} };
}

function toCommandResponse(result: unknown): CommandResponse | void {
  if (result === undefined) return undefined;
  if (isCommandResponseLike(result)) {
    return result;
  }

  return {
    status: 'ok',
    message: typeof result === 'string' ? result : 'Command executed successfully.',
    data: result,
    saveable: result,
  };
}

function isCommandResponseLike(value: unknown): value is CommandResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CommandResponse>;
  return (
    (candidate.status === 'ok' || candidate.status === 'error') &&
    typeof candidate.message === 'string'
  );
}
