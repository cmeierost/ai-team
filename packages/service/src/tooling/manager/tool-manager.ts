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
  type IPathPermissionChecker,
  PermissionResult,
  ToolCatalogEntry,
  type PermissionDescriptor,
  type IToolManager,
} from '@ai-team/core';
import { withTimeout } from '../../utils/with-timeout.js';
import { ZodSchemaTools } from '../../utils/zod-schema.js';

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
export class ToolManager implements IToolManager {
  private static readonly schemaTools = new ZodSchemaTools();
  private static readonly ALWAYS_ALLOWED_TOOLS: ReadonlySet<string> = new Set(['com_handoff']);

  /**
   * Tools that are available to every agent by default.
   * Agents may still deny these via their `disallowedTools` list.
   */
  private static readonly DEFAULT_TOOLS: ReadonlySet<string> = new Set(['com_ask', 'com_handoff']);

  /** Directly-registered tool instances, keyed by canonical name. */
  private readonly directTools = new Map<string, ICommand>();

  constructor(
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly registry: ICommandRegistry,
    private readonly container: IServiceContainer
  ) {}

  /** Register a fully-constructed ICommand instance directly. */
  register(tool: ICommand): void {
    this.directTools.set(ToolIdentity.key(tool.metadata), tool);
  }

  private resolveAll(): ICommand[] {
    const fromRegistry = this.registry
      .getAll({ availableIn: { tool: true } })
      .map((meta) => this.registry.resolve(ToolIdentity.key(meta), this.container))
      .filter((t): t is ICommand<unknown, unknown> => t !== undefined);

    const fromDirect = [...this.directTools.values()].filter(
      (t) => t.metadata.availableIn?.tool !== false
    );

    return [...fromRegistry, ...fromDirect];
  }

  /** All descriptors — no instance resolution. */
  private getAllDescriptors(): ICommandDescriptor[] {
    const fromRegistry = this.registry.getAll();
    const fromDirect = [...this.directTools.values()].map((t) => t.metadata);
    const seen = new Set(fromRegistry.map((m) => ToolIdentity.key(m)));
    return [...fromRegistry, ...fromDirect.filter((m) => !seen.has(ToolIdentity.key(m)))];
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
      const key = ToolIdentity.key(meta);

      if (ToolManager.ALWAYS_ALLOWED_TOOLS.has(key)) {
        return true;
      }

      if (deniedSelectors.some((s) => ToolIdentity.matchesSelector(s, meta))) return false;
      return (
        ToolManager.DEFAULT_TOOLS.has(key) ||
        allowedSelectors.some((s) => ToolIdentity.matchesSelector(s, meta))
      );
    });
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /** Look up a single tool by name. Returns undefined if not registered. */
  get(name: string): ICommand | undefined {
    for (const candidate of this.getToolNameCandidates(name)) {
      const direct = this.directTools.get(candidate);
      if (direct) return direct;

      const meta = this.registry.get(candidate);
      if (!meta?.availableIn?.tool) continue;

      const resolved = this.registry.resolve(candidate, this.container);
      if (resolved) return resolved;
    }

    return undefined;
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
      const key = ToolIdentity.key(tool.metadata);

      if (ToolManager.ALWAYS_ALLOWED_TOOLS.has(key)) {
        return true;
      }

      if (deniedSelectors.some((s) => ToolIdentity.matchesSelector(s, tool.metadata))) return false;
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
    const { meta, canonicalName } = this.resolveToolMetadata(toolName);
    if (!meta) {
      return { allowed: false, reason: `Unknown tool: ${toolName}` };
    }

    if (
      ToolManager.ALWAYS_ALLOWED_TOOLS.has(toolName) ||
      (canonicalName ? ToolManager.ALWAYS_ALLOWED_TOOLS.has(canonicalName) : false)
    ) {
      return { allowed: true };
    }

    // Is the tool in the agent's allowed set?
    const available = this.getDescriptorsForAgent(agent).map((d) => ToolIdentity.key(d));
    const nameForAvailability = canonicalName ?? toolName;
    if (!available.includes(nameForAvailability)) {
      return {
        allowed: false,
        reason: `Tool '${nameForAvailability}' is not available to agent '${agent.id}'.`,
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

    const canonicalToolName = ToolIdentity.key(tool.metadata);

    const workflowPolicy = this.resolveWorkflowToolPolicy(context.workflowState);
    if (this.isToolDeniedByWorkflowPolicy(workflowPolicy, tool.metadata)) {
      return {
        ok: false,
        toolName,
        error: `Tool '${toolName}' is disallowed by active workflow policy.`,
      };
    }

    // Authorization
    const permission = await this.canExecute(agent, canonicalToolName, args);
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
      resolve: this.container.resolve.bind(this.container),
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

  /** Tool catalog visible to a specific agent. */
  catalog(agent: Agent): ToolCatalogEntry[] {
    return this.getForAgent(agent).map((tool) => {
      const key = ToolIdentity.key(tool.metadata);
      const aliases = tool.metadata.aliases ?? [];
      const tags = tool.metadata.tags ?? [];
      const permission = this.resolvePermissionDescriptor(tool.metadata.permissionCheck);
      const schema = ToolManager.schemaTools.toJsonSchema(tool.metadata.parameters, {
        additionalProperties: true,
      });

      return {
        name: key,
        description: tool.metadata.description,
        aliases,
        tags,
        permission,
        schema,
      } as ToolCatalogEntry;
    });
  }

  /**
   * LLM-facing tool schema for a specific agent.
   * Uses concise metadata when provided to reduce prompt/context pollution.
   */
  toSchema(agent: Agent): LlmToolDefinition[];
  toSchema(toolName: string): LlmToolDefinition | undefined;
  toSchema(agentOrToolName: Agent | string): LlmToolDefinition[] | LlmToolDefinition | undefined {
    if (typeof agentOrToolName === 'string') {
      const tool = this.get(agentOrToolName);
      return tool ? this.toLlmDefinition(tool) : undefined;
    }

    return this.getForAgent(agentOrToolName).map((tool) => this.toLlmDefinition(tool));
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private evaluatePermissionDescriptor(
    agent: Agent,
    descriptor: any,
    args: unknown
  ): PermissionResult {
    switch (descriptor?.type ?? 'none') {
      case 'none':
        return { allowed: true };

      case 'context-level':
        return this.checkContextLevel(agent, descriptor.minLevel);

      case 'workspace-path':
        return this.checkWorkspacePath(agent, descriptor, args);

      case 'file-read':
        return this.checkPathArgPermission(agent, descriptor, args, 'read');

      case 'file-write':
        return this.checkPathArgPermission(agent, descriptor, args, 'write');

      case 'agent-delegation':
        return this.checkAgentDelegation(agent, descriptor, args);

      case 'manage-agents':
        return this.checkManageAgents(agent);

      case 'custom':
        if (typeof descriptor.check === 'function') {
          return descriptor.check(agent, args);
        }
        return { allowed: false, reason: 'Custom permission descriptor missing check()' };

      default:
        return {
          allowed: false,
          reason: `Unsupported permission type: ${(descriptor as any).type}`,
        };
    }
  }

  private checkContextLevel(agent: Agent, minLevel: unknown): PermissionResult {
    const current = this.rankContextLevel(agent.contextLevel);
    const required = this.rankContextLevel(minLevel);

    if (current >= required) return { allowed: true };

    return {
      allowed: false,
      reason: `Requires context level ${String(minLevel)}; current is ${String(agent.contextLevel)}.`,
    };
  }

  private checkWorkspacePath(agent: Agent, descriptor: any, args: unknown): PermissionResult {
    if (!descriptor.pathArg) {
      return { allowed: false, reason: 'workspace-path permission missing pathArg.' };
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { allowed: false, reason: `Expected object args containing '${descriptor.pathArg}'.` };
    }

    const value = (args as Record<string, unknown>)[descriptor.pathArg];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return {
        allowed: false,
        reason: `Missing required path argument '${descriptor.pathArg}'.`,
      };
    }

    const targetPath = value;

    const checker = this.pathPermissionChecker as any;
    const canRead = checker.canReadPath(agent.permissions, targetPath);
    const canWrite = checker.canWritePath(agent.permissions, targetPath);
    const canList = checker.canListPath(agent.permissions, targetPath);

    if (descriptor.mode === 'read' && canRead) return { allowed: true };
    if (descriptor.mode === 'write' && canWrite) return { allowed: true };
    if (descriptor.mode === 'list' && canList) return { allowed: true };

    return {
      allowed: false,
      reason: `Agent '${agent.id}' lacks ${descriptor.mode} access to '${targetPath}'.`,
    };
  }

  private checkPathArgPermission(
    agent: Agent,
    descriptor: any,
    args: unknown,
    mode: 'read' | 'write'
  ): PermissionResult {
    if (!descriptor.argsPath) {
      return { allowed: false, reason: `${mode} permission missing argsPath.` };
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return {
        allowed: false,
        reason: `Expected object args containing '${descriptor.argsPath}'.`,
      };
    }

    const value = (args as Record<string, unknown>)[descriptor.argsPath];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return {
        allowed: false,
        reason: `Missing required path argument '${descriptor.argsPath}'.`,
      };
    }

    const targetPath = value;
    const checker = this.pathPermissionChecker as any;
    const allowed =
      mode === 'read'
        ? checker.canReadPath(agent.permissions, targetPath)
        : checker.canWritePath(agent.permissions, targetPath);

    return allowed
      ? { allowed: true }
      : {
          allowed: false,
          reason: `Agent '${agent.id}' lacks ${mode} access to '${targetPath}'.`,
        };
  }

  private checkAgentDelegation(agent: Agent, descriptor: any, args: unknown): PermissionResult {
    const callerCanDelegate = agent.canDelegate !== false;
    if (!callerCanDelegate) {
      return {
        allowed: false,
        reason: `Agent '${agent.id}' is not allowed to delegate.`,
      };
    }

    const delegatesTo = (agent.delegatesTo ?? []).map((id) => String(id).trim()).filter(Boolean);

    // Default-open delegation: if no explicit delegate list is configured,
    // handoff is allowed by default.
    if (delegatesTo.length === 0) {
      return { allowed: true };
    }

    if (!descriptor.argsPath) {
      return {
        allowed: false,
        reason: 'agent-delegation permission missing argsPath.',
      };
    }

    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return {
        allowed: false,
        reason: `Expected object args containing '${descriptor.argsPath}'.`,
      };
    }

    const value = (args as Record<string, unknown>)[descriptor.argsPath];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return {
        allowed: false,
        reason: `Missing required delegation argument '${descriptor.argsPath}'.`,
      };
    }

    if (delegatesTo.includes(value)) {
      return { allowed: true };
    }

    const configuredHandoffTargets = (agent.handoffs ?? [])
      .map((handoff) => String(handoff.agent ?? '').trim())
      .filter(Boolean);

    if (configuredHandoffTargets.includes(value)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Agent '${agent.id}' cannot delegate to '${value}'.`,
    };
  }

  private checkManageAgents(agent: Agent): PermissionResult {
    if (agent.permissions?.manage_agents) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Agent '${agent.id}' lacks manage_agents permission.`,
    };
  }

  private resolvePermissionDescriptor(
    descriptor: PermissionDescriptor | undefined
  ): PermissionDescriptor {
    return descriptor ?? { type: 'none' };
  }

  private rankContextLevel(level: unknown): number {
    const normalized = String(level ?? '').toLowerCase();
    switch (normalized) {
      case 'worker':
        return 1;
      case 'module':
      case 'standard':
        return 2;
      case 'domain':
      case 'leadership':
        return 3;
      case 'organization':
      case 'executive':
        return 4;
      default:
        return 0;
    }
  }

  private toLlmDefinition(tool: ICommand): LlmToolDefinition {
    const meta = tool.metadata;
    const llmMeta = meta.llm;
    const description = llmMeta?.description?.trim()
      ? llmMeta.description.trim()
      : meta.summary?.trim()
        ? meta.summary.trim()
        : meta.description;

    const schema = ToolManager.schemaTools.toJsonSchema(meta.parameters, {
      additionalProperties: true,
    });

    return {
      name: ToolIdentity.key(meta),
      description,
      parameters: schema,
    };
  }

  private static normalizeToolSelector(selector: string): string {
    return selector.trim();
  }

  private getToolNameCandidates(toolName: string): string[] {
    const raw = String(toolName ?? '').trim();
    if (!raw) return [];

    const candidates = new Set<string>([raw]);

    if (raw.includes('_')) {
      candidates.add(raw.replace('_', '-'));
      candidates.add(raw.replaceAll('_', '-'));
    }
    if (raw.includes('-')) {
      candidates.add(raw.replace('-', '_'));
      candidates.add(raw.replaceAll('-', '_'));
    }

    return [...candidates];
  }

  private resolveToolMetadata(toolName: string): {
    meta?: ICommandDescriptor;
    canonicalName?: string;
  } {
    for (const candidate of this.getToolNameCandidates(toolName)) {
      const meta = this.registry.get(candidate) ?? this.directTools.get(candidate)?.metadata;
      if (meta) {
        return {
          meta,
          canonicalName: ToolIdentity.key(meta),
        };
      }
    }

    return {};
  }

  private resolveWorkflowToolPolicy(workflowState: unknown): {
    deny: string[];
    remove: string[];
  } {
    if (!workflowState || typeof workflowState !== 'object' || Array.isArray(workflowState)) {
      return { deny: [], remove: [] };
    }

    const bag = workflowState as Record<string, unknown>;
    const candidates = [
      bag['toolPolicy'],
      bag['workflowToolPolicy'],
      (bag['workflow'] as Record<string, unknown> | undefined)?.['toolPolicy'],
      (bag['workflow'] as Record<string, unknown> | undefined)?.['workflowToolPolicy'],
    ];

    const policy = candidates.find(
      (candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ) as Record<string, unknown> | undefined;

    if (!policy) {
      return { deny: [], remove: [] };
    }

    const toSelectors = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.map((entry) => String(entry ?? '').trim()).filter((entry) => entry.length > 0)
        : [];

    return {
      deny: toSelectors(policy['deny']),
      remove: toSelectors(policy['remove']),
    };
  }

  private isToolDeniedByWorkflowPolicy(
    policy: { deny: string[]; remove: string[] },
    meta: ICommandDescriptor
  ): boolean {
    const all = [...policy.deny, ...policy.remove];
    return all.some((selector) => ToolIdentity.matchesSelector(selector, meta));
  }
}
