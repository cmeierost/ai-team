/**
 * ToolManager — the single catalog, authorization gate, and execution engine
 * for all tools in the system.
 *
 * Design principles (Open/Closed):
 *   - register()  adds capabilities without modifying existing code.
 *   - canExecute() is the single authorization gate for every call surface
 *     (LLM tool call, CLI command, slash command, direct #tool syntax).
 *   - Tool implementations stay pure: no permission checks inside execute().
 *   - catalog() / toSchema() / whoCanExecute() enable introspection at runtime.
 */

import {
  Agent,
  ICommand,
  type ICommandRegistry,
  ExecutionContext,
  ContextLevel,
  type IPathPermissionChecker,
  PermissionResult,
  ToolCatalogEntry,
  type PermissionDescriptor,
} from '@ai-team/core';
import { withTimeout } from '../utils/with-timeout.js';
import { ZodSchemaTools } from '../utils/zod-schema.js';

interface ToolResolverContainer {
  resolve<T>(token: unknown): T;
}

// Re-export for convenience so callers only import from 'tools'.
export type { PermissionResult, ToolCatalogEntry } from '@ai-team/core';

type ToolIdentityField = 'key' | 'group';

/**
 * Canonical lookup key for a tool.
 */
export class ToolIdentity {
  static key(tool: Pick<ICommand, ToolIdentityField>): string {
    const key = typeof tool.key === 'string' ? tool.key.trim() : '';
    if (!key) {
      throw new Error('Tool must define a non-empty `key`.');
    }
    const group = typeof tool.group === 'string' ? tool.group.trim() : '';
    return group ? `${group}_${key}` : key;
  }

  /**
   * Match a tool selector against a tool.
   * Supports:
   * - exact canonical names (e.g. fs_tree)
   * - exact short names (e.g. tree)
   * - wildcard selectors (e.g. fs_*, *_list)
   */
  static matchesSelector(selector: string, tool: Pick<ICommand, ToolIdentityField>): boolean {
    const normalized = ToolIdentity.normalizeSelector(selector);
    if (!normalized) {
      return false;
    }

    return ToolIdentity.matchesSelectorValue(normalized, ToolIdentity.key(tool));
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
  private readonly tools = new Map<string, ICommand>();
  private static readonly schemaTools = new ZodSchemaTools();

  constructor(
    private readonly workspaceRoot: string,
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly registry: ICommandRegistry,
    private readonly container: ToolResolverContainer
  ) {}

  private getRegistryTools(): ICommand[] {
    return this.registry.getAll({ availableIn: { tool: true } });
  }

  private getAllResolvedTools(): ICommand[] {
    const result: ICommand[] = [];
    for (const tool of this.getRegistryTools()) {
      ToolManager.pushIfMissing(result, tool);
    }
    for (const tool of this.tools.values()) {
      ToolManager.pushIfMissing(result, tool);
    }
    return result;
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /**
   * Register a tool. Calling register() with the same name replaces the
   * previous entry — this is the Open/Closed plugin seam.
   * Tools are stored under their canonical key (`tool.key`).
   */
  register(tool: ICommand): this {
    this.tools.set(ToolIdentity.key(tool), tool);
    return this;
  }

  /** Look up a single tool by name. Returns undefined if not registered. */
  get(name: string): ICommand | undefined {
    const local = this.tools.get(name);
    if (local) {
      return local;
    }

    const registryCommand = this.registry.get(name);
    if (!registryCommand?.availableIn?.tool) {
      return undefined;
    }

    return registryCommand;
  }

  /** All registered tools, regardless of agent. */
  getAll(): ICommand[] {
    return this.getAllResolvedTools();
  }

  /** Alias for getAll() required by IToolManager interface. */
  list(): ICommand[] {
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
    const result: ICommand[] = [];
    const allowedSelectors = (agent.tools ?? [])
      .map((selector) => ToolManager.normalizeToolSelector(String(selector)))
      .filter((selector) => selector.length > 0);
    if (allowedSelectors.length === 0) {
      return result;
    }

    const deniedSelectors = (agent.disallowedTools ?? [])
      .map((selector) => ToolManager.normalizeToolSelector(String(selector)))
      .filter((selector) => selector.length > 0);

    for (const tool of this.getAllResolvedTools()) {
      if (deniedSelectors.some((selector) => ToolIdentity.matchesSelector(selector, tool))) {
        continue;
      }

      if (allowedSelectors.some((selector) => ToolIdentity.matchesSelector(selector, tool))) {
        ToolManager.pushIfMissing(result, tool);
      }
    }

    return result;
  }

  // ── Authorization ─────────────────────────────────────────────────────────

  /**
   * Single authorization gate.
   * Reads the tool's PermissionDescriptor and calls ContextManager once.
   * No permission logic should live inside tool.execute().
   */
  async canExecute(agent: Agent, toolName: string, args: unknown): Promise<PermissionResult> {
    const tool = this.get(toolName);
    if (!tool) {
      return { allowed: false, reason: `Unknown tool: ${toolName}` };
    }

    // Is the tool in the agent's allowed set?
    const available = this.getForAgent(agent).map(ToolIdentity.key);
    if (!available.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not available to agent '${agent.id}'.`,
      };
    }

    const descriptor: PermissionDescriptor = tool.permissionCheck ?? { type: 'none' };

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
      tool.parameters && typeof tool.parameters.safeParse === 'function'
        ? tool.parameters.safeParse(args)
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
    return this.getForAgent(agent).map((tool) => {
      const key = ToolIdentity.key(tool);
      return {
        name: key,
        description: tool.summary ?? tool.description,
        group: tool.group,
        schema: this.toSchema(key)?.parameters ?? {},
        tags: tool.tags,
        examples: tool.examples,
      };
    });
  }

  /**
   * Build an LLM-ready tool definition (flat format consumed by LlmService.chatWithTools).
   * LlmService wraps this in the OpenAI { type: 'function', function: {...} } envelope itself.
   */
  toSchema(toolName: string): LlmToolDefinition | undefined {
    const tool = this.get(toolName);
    if (!tool) return undefined;

    return {
      name: toolName,
      description: tool.summary ?? tool.description,
      parameters: ToolManager.schemaTools.toJsonSchema(tool.parameters, {
        additionalProperties: true,
      }),
    };
  }

  /**
   * LLM-ready definitions for all tools available to an agent.
   * Passed directly to the LLM as the `tools` array.
   */
  describeAll(agent: Agent): LlmToolDefinition[] {
    return this.getForAgent(agent)
      .map((t) => this.toSchema(ToolIdentity.key(t)))
      .filter((d): d is LlmToolDefinition => d !== undefined);
  }

  private static normalizeToolSelector(selector: string): string {
    return selector.trim();
  }

  private static pushIfMissing(result: ICommand[], tool: ICommand): void {
    const key = ToolIdentity.key(tool);
    if (!result.some((t) => ToolIdentity.key(t) === key)) {
      result.push(tool);
    }
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
