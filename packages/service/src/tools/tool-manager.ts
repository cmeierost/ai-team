/**
 * ToolManager — the single catalog, authorization gate, and execution engine
 * for all tools in the system.
 *
 * Design principles (Open/Closed):
 *   - Tools are registered via ICommandRegistry; ToolManager resolves them on demand.
 *   - canExecute() is the single authorization gate for every call surface
 *     (LLM tool call, CLI command, slash command, direct #tool syntax).
 *   - Tool implementations stay pure: no permission checks inside execute().
 *   - catalog() / toSchema() / whoCanExecute() enable introspection at runtime.
 */

import {
  Agent,
  ICommand,
  type ICommandDescriptor,
  type ICommandRegistry,
  type IServiceContainer,
  ExecutionContext,
  ContextLevel,
  type IPathPermissionChecker,
  PermissionResult,
  ToolCatalogEntry,
  type PermissionDescriptor,
} from '@ai-team/core';
import { withTimeout } from '../utils/with-timeout.js';
import { ZodSchemaTools } from '../utils/zod-schema.js';

export type { PermissionResult, ToolCatalogEntry } from '@ai-team/core';

/**
 * Canonical lookup key for a tool — works directly with ICommandDescriptor.
 * Callers that have an ICommand instance should pass tool.metadata.
 */
export class ToolIdentity {
  static key(meta: ICommandDescriptor): string {
    const key = typeof meta.key === 'string' ? meta.key.trim() : '';
    if (!key) {
      throw new Error('Tool must define a non-empty `key`.');
    }
    const group = typeof meta.group === 'string' ? meta.group.trim() : '';
    return group ? `${group}_${key}` : key;
  }

  /**
   * Match a tool selector against a tool descriptor.
   * Supports:
   * - exact canonical names (e.g. fs_tree)
   * - exact short names (e.g. tree)
   * - wildcard selectors (e.g. fs_*, *_list)
   */
  static matchesSelector(selector: string, meta: ICommandDescriptor): boolean {
    const normalized = ToolIdentity.normalizeSelector(selector);
    if (!normalized) {
      return false;
    }

    return ToolIdentity.matchesSelectorValue(normalized, ToolIdentity.key(meta));
  }

  private static normalizeSelector(selector: string): string {
    return selector.trim();
  }

  private static selectorToRegExp(selector: string): RegExp {
    const escaped = selector
      .replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)
      .replaceAll('*', '.*');
    return new RegExp(`^${escaped}$`);
  }

  private static matchesSelectorValue(selector: string, value: string): boolean {
    if (!selector.includes('*')) {
      return selector === value;
    }
    return ToolIdentity.selectorToRegExp(selector).test(value);
  }
}

/**
 * Flat tool definition consumed by LlmService.chatWithTools().
 * Defined here to avoid a circular dep between tools ↔ llm layers.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  ok: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
}

export interface ToolExecutionOptions {
  /** ms before the tool call is aborted (default 60 000). */
  timeoutMs?: number;
  /** Hook called before execution; returning false cancels the call. */
  onBeforeExecute?: (toolName: string, args: unknown) => Promise<boolean> | boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * ToolManager is the single source of truth for what tools exist,
 * which tools an agent may use, and how they are executed safely.
 */
export class ToolManager {
  private static readonly schemaTools = new ZodSchemaTools();

  /**
   * Tools that are available to every agent by default.
   * Agents may still deny these via their `disallowedTools` list.
   */
  private static readonly DEFAULT_TOOLS: ReadonlySet<string> = new Set(['com_ask']);

  constructor(
    private readonly workspaceRoot: string,
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly registry: ICommandRegistry,
    private readonly container: IServiceContainer
  ) {}

  private resolveAll(): ICommand[] {
    return this.registry
      .getAll({ availableIn: { tool: true } })
      .map((meta) => this.registry.resolve(meta.key, this.container))
      .filter((t): t is ICommand<unknown, unknown> => t !== undefined);
  }

  /** All descriptors — no instance resolution. */
  private getAllDescriptors(): ICommandDescriptor[] {
    return this.registry.getAll();
  }

  /** Descriptors available to a specific agent — no instance resolution. */
  private getDescriptorsForAgent(agent: Agent): ICommandDescriptor[] {
    const allowedSelectors = (agent.tools ?? [])
      .map((s) => ToolManager.normalizeToolSelector(String(s)))
      .filter((s) => s.length > 0);

    const deniedSelectors = (agent.disallowedTools ?? [])
      .map((s) => ToolManager.normalizeToolSelector(String(s)))
      .filter((s) => s.length > 0);

    return this.getAllDescriptors().filter((meta) => {
      if (deniedSelectors.some((s) => ToolIdentity.matchesSelector(s, meta))) return false;
      const key = ToolIdentity.key(meta);
      return (
        ToolManager.DEFAULT_TOOLS.has(key) ||
        allowedSelectors.some((s) => ToolIdentity.matchesSelector(s, meta))
      );
    });
  }

  private getAllResolvedTools(): ICommand[] {
    return this.resolveAll();
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /** Look up a single tool by name. Returns undefined if not registered. */
  get(name: string): ICommand | undefined {
    const meta = this.registry.get(name);
    if (!meta?.availableIn?.tool) return undefined;
    return this.registry.resolve(name, this.container);
  }

  /** All registered tool descriptors, regardless of agent. */
  getAll(): ICommandDescriptor[] {
    return this.registry.getAll();
  }

  /** Alias for getAll() required by IToolManager interface. */
  list(): ICommandDescriptor[] {
    return this.getAll();
  }

  // ── Availability ─────────────────────────────────────────────────────────

  /**
   * Tools available to a specific agent.
   * Strict allow-list policy:
   * - everything is denied by default
   * - only selectors in agent.tools[] are granted
   * - selectors support exact names and wildcard patterns (e.g. fs_*)
   * - agent.disallowedTools[] takes precedence over allows
   */
  getForAgent(agent: Agent): ICommand[] {
    const allowedSelectors = (agent.tools ?? [])
      .map((selector) => ToolManager.normalizeToolSelector(String(selector)))
      .filter((selector) => selector.length > 0);

    const deniedSelectors = (agent.disallowedTools ?? [])
      .map((selector) => ToolManager.normalizeToolSelector(String(selector)))
      .filter((selector) => selector.length > 0);

    return this.resolveAll().filter((tool) => {
      if (deniedSelectors.some((s) => ToolIdentity.matchesSelector(s, tool.metadata))) return false;
      const key = ToolIdentity.key(tool.metadata);
      return (
        ToolManager.DEFAULT_TOOLS.has(key) ||
        allowedSelectors.some((s) => ToolIdentity.matchesSelector(s, tool.metadata))
      );
    });
  }

  // ── Authorization ─────────────────────────────────────────────────────────

  /**
   * Single authorization gate.
   * Reads the tool's PermissionDescriptor and calls ContextManager once.
   * No permission logic should live inside tool.execute().
   */
  async canExecute(agent: Agent, toolName: string, args: unknown): Promise<PermissionResult> {
    const meta = this.registry.get(toolName);
    if (!meta) {
      return { allowed: false, reason: `Unknown tool: ${toolName}` };
    }

    // Is the tool in the agent's allowed set?
    const available = this.getDescriptorsForAgent(agent).map((d) => ToolIdentity.key(d));
    if (!available.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not available to agent '${agent.id}'.`,
      };
    }

    const descriptor: PermissionDescriptor = meta.permissionCheck ?? { type: 'none' };

    try {
      return this.evaluatePermissionDescriptor(agent, descriptor, args);
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * Execute a tool after checking authorization and parsing args.
   * This is the only path that should call tool.execute().
   */
  async execute(
    agent: Agent,
    toolName: string,
    args: unknown,
    context: Omit<ExecutionContext, 'agent'>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const tool = this.get(toolName);
    if (!tool) {
      return { ok: false, toolName, error: `Unknown tool: ${toolName}` };
    }

    // Authorization
    const permission = await this.canExecute(agent, toolName, args);
    if (!permission.allowed) {
      return { ok: false, toolName, error: permission.reason ?? 'Permission denied' };
    }

    // Optional pre-execution hook
    if (options?.onBeforeExecute) {
      const approved = await options.onBeforeExecute(toolName, args);
      if (!approved) {
        return { ok: false, toolName, error: `Tool call cancelled: ${toolName}` };
      }
    }

    // Zod validation
    const parsed =
      tool.metadata.parameters && typeof tool.metadata.parameters.safeParse === 'function'
        ? tool.metadata.parameters.safeParse(args)
        : { success: true as const, data: args };
    if (!parsed.success) {
      return {
        ok: false,
        toolName,
        error: `Invalid parameters for ${toolName}: ${parsed.error.message}`,
      };
    }

    // Execution with timeout
    const toolContext = {
      ...context,
      agent,
      agentId: agent.id,
    } as ExecutionContext;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const result = await withTimeout(
        tool.execute(parsed.data, toolContext),
        timeoutMs,
        `Tool ${toolName} timed out after ${timeoutMs}ms`
      );
      return { ok: true, toolName, result };
    } catch (error) {
      return {
        ok: false,
        toolName,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Capability Discovery ──────────────────────────────────────────────────

  /**
   * Which agents (from the provided list) are permitted to execute a tool
   * with the given args. Used by find_capable_agent and handoff validation.
   */
  async whoCanExecute(toolName: string, args: unknown, agents: Agent[]): Promise<Agent[]> {
    const results: Agent[] = [];

    for (const agent of agents) {
      const permission = await this.canExecute(agent, toolName, args);
      if (permission.allowed) {
        results.push(agent);
      }
    }

    // Sort: executive → leadership → standard → worker
    const levelOrder: Record<string, number> = {
      executive: 0,
      leadership: 1,
      standard: 2,
      worker: 3,
    };

    results.sort((a, b) => (levelOrder[a.contextLevel] ?? 9) - (levelOrder[b.contextLevel] ?? 9));

    return results;
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  /**
   * Live catalog of tools available to a specific agent.
   * Includes name, description, JSON Schema, tags, and examples.
   * Powering `list_tools` and `ait tools list`.
   */
  catalog(agent: Agent): ToolCatalogEntry[] {
    return this.getDescriptorsForAgent(agent).map((meta) => {
      const key = ToolIdentity.key(meta);
      return {
        name: key,
        description: meta.summary ?? meta.description,
        group: meta.group,
        schema: this.toSchema(key)?.parameters ?? {},
        tags: meta.tags,
        examples: meta.examples,
      };
    });
  }

  /**
   * Build an LLM-ready tool definition (flat format consumed by LlmService.chatWithTools).
   * LlmService wraps this in the OpenAI { type: 'function', function: {...} } envelope itself.
   */
  toSchema(toolName: string): LlmToolDefinition | undefined {
    const meta = this.registry.get(toolName);
    if (!meta) return undefined;

    return {
      name: toolName,
      description: meta.summary ?? meta.description,
      parameters: ToolManager.schemaTools.toJsonSchema(meta.parameters, {
        additionalProperties: true,
      }),
    };
  }

  /**
   * LLM-ready definitions for all tools available to an agent.
   * Passed directly to the LLM as the `tools` array.
   */
  describeAll(agent: Agent): LlmToolDefinition[] {
    return this.getDescriptorsForAgent(agent)
      .map((meta) => this.toSchema(ToolIdentity.key(meta)))
      .filter((d): d is LlmToolDefinition => d !== undefined);
  }

  private static normalizeToolSelector(selector: string): string {
    return selector.trim();
  }

  private evaluatePermissionDescriptor(
    agent: Agent,
    descriptor: PermissionDescriptor,
    args: unknown
  ): PermissionResult {
    switch (descriptor.type) {
      case 'none':
        return { allowed: true };

      case 'file-read': {
        const filePath = this.resolveArgsPath(args, descriptor.argsPath);
        if (!filePath) return { allowed: true };
        this.pathPermissionChecker.assertCanReadPath(agent.id, agent.permissions, filePath);
        return { allowed: true };
      }

      case 'file-write': {
        const filePath = this.resolveArgsPath(args, descriptor.argsPath);
        if (!filePath) return { allowed: true };
        this.pathPermissionChecker.assertCanWritePath(agent.id, agent.permissions, filePath);
        return { allowed: true };
      }

      case 'agent-delegation': {
        const targetId = this.resolveArgsPath(args, descriptor.argsPath);
        if (!targetId) return { allowed: true };
        const canDelegate =
          agent.delegatesTo?.includes(targetId) ||
          agent.contextLevel === ContextLevel.ORGANIZATION ||
          agent.contextLevel === ContextLevel.REPOSITORY;
        if (!canDelegate) {
          return {
            allowed: false,
            reason: `Agent '${agent.id}' is not allowed to delegate to '${targetId}'.`,
          };
        }
        return { allowed: true };
      }

      case 'manage-agents': {
        if (agent.contextLevel !== ContextLevel.ORGANIZATION) {
          return {
            allowed: false,
            reason: `Agent '${agent.id}' does not have organization-level authority.`,
          };
        }
        return { allowed: true };
      }

      default: {
        const _exhaustive: never = descriptor;
        return {
          allowed: false,
          reason: `Unknown permission type: ${JSON.stringify(_exhaustive)}`,
        };
      }
    }
  }

  private resolveArgsPath(args: unknown, dotPath: string): string | undefined {
    if (typeof args !== 'object' || args === null) return undefined;

    const parts = dotPath.split('.');
    let current: unknown = args;

    for (const part of parts) {
      if (typeof current !== 'object' || current === null || !(part in current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return typeof current === 'string' ? current : undefined;
  }
}
