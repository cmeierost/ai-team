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
  AgentTool,
  ContextLevel,
  PermissionResult,
  ToolCatalogEntry,
  ToolContext,
  type PermissionDescriptor,
} from '@ai-team/core';
import type { LspProvider } from '@ai-team/core';
import { assertCanReadPath, assertCanWritePath } from '@ai-team/infrastructure';

// Re-export for convenience so callers only import from 'tools'.
export type { PermissionResult, ToolCatalogEntry } from '@ai-team/core';

/**
 * Canonical lookup key for a tool.
 * When the tool has a group, the key is `${group}_${name}` (e.g. `fs_tree`).
 * Without a group the short name is used as-is (e.g. `lsp`).
 */
export function toolKey(tool: Pick<AgentTool, 'name' | 'group'>): string {
  return tool.group ? `${tool.group}_${tool.name}` : tool.name;
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

const ALWAYS_ALLOWED_TOOLS = new Set<string>([
  'com_delegate',
  'com_handoff',
  'tool_list',
  'team_list',
  'access_can_i',
]);

const TOOL_ROLE_GATED = new Set<string>(['tool_run', 'tool_register_cli', 'tool_get_errors']);

const ANALYZE_TOOLS = new Set<string>(['code_complexity', 'hr_performance']);

const HR_ROLE_TOOLS = new Set<string>(['hr_hire', 'hr_archive', 'hr_avatar', 'hr_update_llm']);

function isHrRole(agent: Agent): boolean {
  return agent.role.toLowerCase().includes('hr');
}

function isCeoRole(agent: Agent): boolean {
  return agent.role.toLowerCase() === 'ceo';
}

function pushIfMissing(result: AgentTool[], tool: AgentTool): void {
  const key = toolKey(tool);
  if (!result.some((t) => toolKey(t) === key)) {
    result.push(tool);
  }
}

function isDefaultAllowedTool(agent: Agent, tool: AgentTool, canManageAgents: boolean): boolean {
  const hasElevatedContext =
    agent.contextLevel === ContextLevel.ORGANIZATION ||
    agent.contextLevel === ContextLevel.REPOSITORY;
  const isHr = isHrRole(agent);
  const isCeo = isCeoRole(agent);
  const key = toolKey(tool);

  if (ALWAYS_ALLOWED_TOOLS.has(key)) return true;
  if (tool.group === 'fs' || tool.group === 'search') return true;
  if (ANALYZE_TOOLS.has(key) && isCeo) return true;
  if ((HR_ROLE_TOOLS.has(key) || tool.tags?.includes('hr')) && (isHr || canManageAgents))
    return true;
  if (TOOL_ROLE_GATED.has(key) && hasElevatedContext) return true;

  return false;
}

function evaluatePermissionDescriptor(
  workspaceRoot: string,
  agent: Agent,
  descriptor: PermissionDescriptor,
  args: unknown
): PermissionResult {
  switch (descriptor.type) {
    case 'none':
      return { allowed: true };

    case 'file-read': {
      const filePath = resolveArgsPath(args, descriptor.argsPath);
      if (!filePath) return { allowed: true };
      assertCanReadPath(workspaceRoot, agent.id, agent.permissions, filePath);
      return { allowed: true };
    }

    case 'file-write': {
      const filePath = resolveArgsPath(args, descriptor.argsPath);
      if (!filePath) return { allowed: true };
      assertCanWritePath(workspaceRoot, agent.id, agent.permissions, filePath);
      return { allowed: true };
    }

    case 'agent-delegation': {
      const targetId = resolveArgsPath(args, descriptor.argsPath);
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
      return { allowed: false, reason: `Unknown permission type: ${JSON.stringify(_exhaustive)}` };
    }
  }
}

/**
 * ToolManager is the single source of truth for what tools exist,
 * which tools an agent may use, and how they are executed safely.
 */
export class ToolManager {
  private readonly tools = new Map<string, AgentTool>();
  private readonly workspaceRoot: string;
  /** Optional LSP provider injected into tool context. */
  private _lsp?: LspProvider;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /** Set the LSP provider that tools will receive in their context. */
  setLspProvider(lsp: LspProvider): void {
    this._lsp = lsp;
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /**
   * Register a tool. Calling register() with the same name replaces the
   * previous entry — this is the Open/Closed plugin seam.
   * Tools are stored under their canonical key: `${group}_${name}` when a group
   * is present (e.g. `fs_tree`), or just `name` when there is no group.
   */
  register(tool: AgentTool): this {
    this.tools.set(toolKey(tool), tool);
    return this;
  }

  /** Look up a single tool by name. Returns undefined if not registered. */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /** All registered tools, regardless of agent. */
  getAll(): AgentTool[] {
    return [...this.tools.values()];
  }

  // ── Availability ─────────────────────────────────────────────────────────

  /**
   * Tools available to a specific agent.
   * Combines explicit agent.tools[] grant with HR permission check.
   * Orchestration tools (type: none, no 'hr' tag) are always included.
   */
  getForAgent(agent: Agent): AgentTool[] {
    const result: AgentTool[] = [];
    const canManageAgents = agent.contextLevel === ContextLevel.ORGANIZATION;
    const denied = new Set<string>(agent.disallowedTools ?? []);

    for (const tool of this.tools.values()) {
      // Explicit deny list takes precedence over any allow.
      // Accept both the full key (fs_tree) and short name (tree) for backward compat.
      const key = toolKey(tool);
      if (denied.has(key) || denied.has(tool.name)) {
        continue;
      }

      // Explicit grants are always included.
      // Accept both the full key (fs_tree) and short name (tree) for backward compat.
      if (agent.tools?.includes(key) || agent.tools?.includes(tool.name)) {
        pushIfMissing(result, tool);
        continue;
      }

      if (isDefaultAllowedTool(agent, tool, canManageAgents)) {
        result.push(tool);
        continue;
      }

      // HR tools: require manage_agents permission
      if (tool.tags?.includes('hr') && !canManageAgents) {
        continue;
      }

      // Tools with type 'none' permission and no hr tag are universally available
      const check: PermissionDescriptor = tool.permissionCheck ?? { type: 'none' };
      if (check.type === 'none' && !tool.tags?.includes('hr')) {
        pushIfMissing(result, tool);
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
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { allowed: false, reason: `Unknown tool: ${toolName}` };
    }

    // Is the tool in the agent's allowed set?
    const available = this.getForAgent(agent).map(toolKey);
    if (!available.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not available to agent '${agent.id}'.`,
      };
    }

    const descriptor: PermissionDescriptor = tool.permissionCheck ?? { type: 'none' };

    try {
      return evaluatePermissionDescriptor(this.workspaceRoot, agent, descriptor, args);
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
    context: Omit<ToolContext, 'agent'>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolName);
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
    const parsed = tool.parameters.safeParse(args);
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
      lsp: this._lsp,
    } as ToolContext;
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
      const key = toolKey(tool);
      return {
        name: key,
        description: tool.description,
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
    const tool = this.tools.get(toolName);
    if (!tool) return undefined;

    return {
      name: toolName,
      description: tool.description,
      parameters: zodSchemaToJsonSchema(tool.parameters),
    };
  }

  /**
   * LLM-ready definitions for all tools available to an agent.
   * Passed directly to the LLM as the `tools` array.
   */
  describeAll(agent: Agent): LlmToolDefinition[] {
    return this.getForAgent(agent)
      .map((t) => this.toSchema(toolKey(t)))
      .filter((d): d is LlmToolDefinition => d !== undefined);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Resolve a dot-path into a parsed args object and return the string value. */
function resolveArgsPath(args: unknown, dotPath: string): string | undefined {
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

/** Race a promise against a timeout — local copy until all callers migrate to utils/async.ts. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const race = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, race]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Convert a Zod schema to a JSON Schema object for LLM function-calling.
 * Zod v4 has a built-in toJSONSchema() method; falls back to permissive object schema.
 */
function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && typeof (schema as any).toJSONSchema === 'function') {
    return (schema as any).toJSONSchema() as Record<string, unknown>;
  }
  return { type: 'object', properties: {}, additionalProperties: true };
}
