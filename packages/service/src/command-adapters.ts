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

import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  CliCommandMetadata,
  CommandOptionMetadata,
  ILlmToolDefinition,
} from '@ai-team/core';

import { ZodSchemaTools } from './utils/zod-schema.js';

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

    return defaultValue === undefined
      ? { flags, description }
      : { flags, description, defaultValue };
  });
}

// ── ICommand → CliCommandMetadata ────────────────────────────────────────────

export function toCliMetadata<TParams, TResult>(
  cmd: ICommand<TParams, TResult>
): CliCommandMetadata {
  if (!cmd.metadata.cli) {
    throw new Error(`ICommand '${cmd.metadata.key}' has no cli routing info (missing cmd.cli)`);
  }
  return {
    key: cmd.metadata.key,
    command: cmd.metadata.cli.command,
    parentKey: cmd.metadata.cli.parentKey,
    description: cmd.metadata.help?.description ?? cmd.metadata.description,
    llmCallable: Boolean(cmd.metadata.availableIn.tool),
    directCli: Boolean(cmd.metadata.availableIn.cli),
    aliases: cmd.metadata.aliases,
    options: cmd.metadata.parameters ? zodToCliOptions(cmd.metadata.parameters) : undefined,
    hints: cmd.metadata.help?.hints,
    examples: cmd.metadata.help?.examples?.map((example: { value: string }) => example.value),
    jsonSignature: cmd.metadata.input?.jsonSignature,
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
export function toSlashCommand(cmd: ICommand<unknown, unknown>): ICommand<string, unknown> {
  return {
    metadata: {
      key: cmd.metadata.key,
      aliases: cmd.metadata.aliases,
      description: cmd.metadata.description,
      usage: cmd.metadata.usage,
      availableIn: {
        chat: true,
        cliChat: Boolean(cmd.metadata.availableIn.cliChat),
        tool: Boolean(cmd.metadata.availableIn.tool),
        cli: false,
      },
    },
    execute: async (rawArgs: string, ctx: ExecutionContext) => {
      const parsed = cmd.metadata.parameters
        ? parseArgsIntelligently(rawArgs, cmd.metadata.parameters)
        : rawArgs;

      // Extract context overrides from parsed params and merge with base context
      const parsedObj = typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      const contextOverrides = mapParamsToContext(
        parsedObj,
        cmd.metadata.input?.contextOverrideAllowlist,
        ctx.calledByHuman ?? true
      );
      const mergedCtx: ExecutionContext = { ...ctx, ...contextOverrides };
      const resolvedPayload = resolveCommandArgs(cmd, parsed, mergedCtx);

      const result = await cmd.execute(resolvedPayload, mergedCtx);
      return toCommandResponse(result) ?? { status: 'ok' };
    },
  };
}

// ── ICommand → ILlmToolDefinition ────────────────────────────────────────────

export function toLlmToolDefinition(cmd: ICommand<unknown, unknown>): ILlmToolDefinition {
  const rawSchema = cmd.metadata.parameters
    ? new ZodSchemaTools().toJsonSchema(cmd.metadata.parameters)
    : undefined;
  const defaultHidden = cmd.metadata.input?.contextParameters ?? [];
  const explicitHidden = cmd.metadata.llm?.hiddenParameters ?? [];
  const schema = stripHiddenParameters(rawSchema, [...defaultHidden, ...explicitHidden]);
  return {
    name: cmd.metadata.key,
    description: cmd.metadata.llm?.description ?? cmd.metadata.summary ?? cmd.metadata.description,
    parameters: schema as Record<string, unknown> | undefined,
    group: cmd.metadata.group,
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
): Partial<ExecutionContext> {
  if (!calledByHuman) {
    return {};
  }

  const overrides: Partial<ExecutionContext> = {};
  const allowed = allowlist && allowlist.length > 0 ? new Set(allowlist) : undefined;

  const isAllowed = (key: string): boolean => !allowed || allowed.has(key);

  if (isAllowed('agentId') && 'agentId' in params && typeof params.agentId === 'string') {
    overrides.agentId = params.agentId;
  }
  if (isAllowed('sessionId') && 'sessionId' in params && typeof params.sessionId === 'string') {
    overrides.sessionId = params.sessionId;
  }
  if (
    isAllowed('workspaceRoot') &&
    'workspaceRoot' in params &&
    typeof params.workspaceRoot === 'string'
  ) {
    overrides.workspaceRoot = params.workspaceRoot;
  }
  if (isAllowed('workflowId') && 'workflowId' in params && typeof params.workflowId === 'string') {
    overrides.workflowId = params.workflowId;
  }
  if (
    isAllowed('workflowInstanceId') &&
    'workflowInstanceId' in params &&
    typeof params.workflowInstanceId === 'string'
  ) {
    overrides.workflowInstanceId = params.workflowInstanceId;
  }

  return overrides;
}

export function resolveCommandArgs(
  cmd: ICommand<unknown, unknown>,
  payload: unknown,
  ctx: ExecutionContext
): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const resolved = { ...(payload as Record<string, unknown>) };

  for (const contextParam of cmd.metadata.input?.contextParameters ?? []) {
    if (getPathValue(resolved, contextParam) !== undefined) continue;
    const contextValue = getContextValue(ctx, contextParam);
    if (contextValue !== undefined) {
      setPathValue(resolved, contextParam, contextValue);
    }
  }

  for (const [targetPath, binding] of Object.entries(cmd.metadata.workflowInputBindings ?? {})) {
    if (getPathValue(resolved, targetPath) !== undefined) continue;
    if (binding.fromLastResult && ctx.workflowLastResult !== undefined) {
      const value = getPathValue(ctx.workflowLastResult, binding.fromLastResult);
      if (value !== undefined) setPathValue(resolved, targetPath, value);
    }
  }

  const missingRequired = (cmd.metadata.input?.requiredAtRuntime ?? []).filter(
    (path) => getPathValue(resolved, path) === undefined
  );
  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required parameter(s) after runtime resolution: ${missingRequired.join(', ')}`
    );
  }

  if (cmd.metadata.parameters && typeof (cmd.metadata.parameters as any).parse === 'function') {
    return (cmd.metadata.parameters as any).parse(resolved);
  }

  return resolved;
}

function getContextValue(ctx: ExecutionContext, key: string): unknown {
  return getPathValue(ctx, key);
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
  const last = parts.at(-1);
  if (last) {
    current[last] = value;
  }
}

function stripHiddenParameters(schema: unknown, hiddenParameters: string[] | undefined): unknown {
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

    const last = parts.at(-1);
    if (last) {
      current[last] = value;
    }
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
export function parseArgsIntelligently(rawArgs: unknown, schema?: unknown): unknown {
  // If already an object, return as-is
  if (typeof rawArgs !== 'string') {
    return rawArgs;
  }

  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return schema && typeof (schema as any).parse === 'function' ? (schema as any).parse({}) : {};
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

  const tokens = tokenizeRawArgs(rawArgs);
  const flat = parseTokensToFlat(tokens);
  const result = reconstructNestedObject(flat);

  return schema && typeof (schema as any).parse === 'function'
    ? (schema as any).parse(result)
    : result;
}

function parseTokensToFlat(tokens: string[]): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
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
      flat[key] = coerceArgValue(inlineValue);
      continue;
    }

    const next = tokens[i + 1];
    if (!next || next.startsWith('--')) {
      flat[key] = true;
      continue;
    }

    flat[key] = coerceArgValue(next);
    i += 1;
  }

  if (positionals.length > 0) {
    flat._ = positionals;
  }

  return flat;
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
  if ((quote !== '"' && quote !== "'") || token.at(-1) !== quote) {
    return token;
  }

  const inner = token.slice(1, -1);
  return inner.replaceAll(/\\(["'\\])/g, '$1');
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

function toCommandResponse(result: unknown): CommandResponse | void {
  if (result === undefined) return undefined;
  if (isCommandResponseLike(result)) {
    return result;
  }

  return {
    status: 'ok',
    message: typeof result === 'string' ? result : 'Command executed successfully.',
    data: result,
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
