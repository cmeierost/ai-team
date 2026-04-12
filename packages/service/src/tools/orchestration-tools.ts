/**
 * Orchestration tools — service-layer tools the LLM uses to coordinate work.
 *
 * All four tools are created via factory functions that accept OrchestrationDeps.
 * This is Dependency Inversion: each tool depends on a minimal interface (e.g.
 * ISessionGateway) rather than a concrete service type, so callers can inject
 * any compatible implementation without touching this file (Open/Closed).
 *
 * Tools that produce real results (hire, find, list) do the work at execute-time
 * using injected deps, not inside the orchestrator. com_handoff pre-validates
 * the target and resolves the existing session so tool-dispatch has all context
 * without a second lookup.
 *
 * Usage:
 *   const tools = createOrchestrationTools({ sessions, agents, tools });
 *   for (const t of tools) toolManager.register(t);
 *
 *   Or per-tool for fine-grained control:
 *   toolManager.register(createHandoffTool({ agents, sessions }));
 */

import { z } from 'zod';
import {
  ContextLevel,
  type Agent,
  type AgentConfig,
  type AgentTool,
  type ToolCatalogEntry,
  type ToolContext,
  HandoffRequest,
  HireResult,
  FindCapableAgentResult,
  TeamListResult,
  ToolCatalogResult,
} from '@ai-team/infrastructure';

// ── DI contracts — each tool depends only on what it needs ───────────────────

/**
 * Minimal session access needed by com_handoff.
 * SessionManager satisfies this structurally — no explicit implements needed.
 */
export interface ISessionGateway {
  getLatestSession(agentId: string): Promise<{ id: string; agentId: string } | null>;
}

/**
 * Minimal agent registry access needed by handoff/hire/find tools.
 * AgentManager satisfies this structurally.
 */
export interface IAgentRegistry {
  getAgentAsync(id: string): Promise<Agent | undefined>;
  getAllAgentsAsync(): Promise<Agent[]>;
  createAgentAsync(config: AgentConfig): Promise<Agent>;
}

/**
 * Minimal tool catalog access needed by fs_who_should and tool_list.
 * ToolManager satisfies this structurally.
 */
export interface IToolCatalog {
  whoCanExecute(toolName: string, args: unknown, agents: Agent[]): Promise<Agent[]>;
  catalog(agent: Agent): ToolCatalogEntry[];
}

/** Full dependency bag passed to createOrchestrationTools(). */
export interface OrchestrationDeps {
  sessions: ISessionGateway;
  agents: IAgentRegistry;
  tools: IToolCatalog;
}

// ── Factory functions — one per tool ─────────────────────────────────────────

/**
 * com_handoff
 *
 * Validates the target agent exists and pre-resolves its latest session.
 * Returns a HandoffRequest — the orchestrator's tool-dispatch does the actual
 * context switch because it holds the full OrchestratorContext.
 */
export function createHandoffTool(deps: Pick<OrchestrationDeps, 'agents' | 'sessions'>): AgentTool {
  return {
    name: 'handoff',
    group: 'com',
    description:
      'Transfer the current conversation to another agent who is better suited ' +
      'to handle the request. Use when a task is outside your area of responsibility. ' +
      'You must have delegation permission to the target agent.',
    permissionCheck: { type: 'agent-delegation', argsPath: 'targetAgentId' },
    parameters: z.object({
      targetAgentId: z.string().min(1).describe('ID of the agent to hand off to'),
      briefingNote: z
        .string()
        .min(1)
        .describe('Concise summary of the conversation and what the target agent needs to do.'),
    }),
    tags: ['orchestration'],
    examples: [
      'com_handoff({ targetAgentId: "alice", briefingNote: "User wants to refactor auth. Context: ..." })',
    ],
    async execute(params: unknown, context: ToolContext): Promise<HandoffRequest> {
      const { targetAgentId, briefingNote } = params as {
        targetAgentId: string;
        briefingNote: string;
      };

      const target =
        (await deps.agents.getAgentAsync(targetAgentId)) ??
        (await deps.agents.getAllAgentsAsync()).find((candidate) => {
          const query = targetAgentId.trim().toLowerCase();
          return (
            candidate.id.toLowerCase() === query ||
            candidate.name.toLowerCase() === query ||
            candidate.role.toLowerCase() === query
          );
        });

      if (!target) {
        throw new Error(
          `Agent not found: "${targetAgentId}". ` + 'Use who_should to discover valid agent IDs.'
        );
      }

      if (target.id === context.agent.id) {
        throw new Error('Cannot hand off to yourself. Choose another agent.');
      }

      // Pre-resolve target session — tool-dispatch uses this directly without
      // an extra lookup, keeping the hot path free of redundant I/O.
      const existingSession = await deps.sessions.getLatestSession(target.id);

      return {
        type: 'handoff',
        targetAgentId: target.id,
        briefingNote,
        targetSessionId: existingSession?.id,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * hr_hire
 *
 * Actually creates the agent via AgentManager at execute-time so the LLM
 * gets immediate confirmation (the new agent's ID) rather than a deferred marker.
 */
export function createHireTool(deps: Pick<OrchestrationDeps, 'agents'>): AgentTool {
  return {
    name: 'hire',
    group: 'hr',
    description:
      'Create a new virtual team member with a defined role. Requires manage_agents permission.',
    permissionCheck: { type: 'manage-agents' },
    parameters: z.object({
      name: z.string().min(1).describe('Full name of the new team member'),
      role: z.string().min(1).describe('Job role / title'),
      specializations: z.array(z.string()).optional().describe('Areas of expertise'),
      reportsTo: z.string().optional().describe('Agent ID of the direct manager'),
    }),
    tags: ['orchestration', 'hr'],
    examples: [
      'hr_hire({ name: "Bob Smith", role: "Senior Developer", specializations: ["Rust"] })',
    ],
    async execute(params: unknown, context: ToolContext): Promise<HireResult> {
      const {
        name,
        role,
        specializations = [],
        reportsTo,
      } = params as {
        name: string;
        role: string;
        specializations?: string[];
        reportsTo?: string;
      };

      const config: AgentConfig = {
        name,
        role,
        specializations,
        reportsTo: reportsTo ?? context.agent.id,
        contextLevel: ContextLevel.MODULE,
      };

      const created = await deps.agents.createAgentAsync(config);

      return {
        type: 'hire',
        agentId: created.id,
        name: created.name,
        role: created.role,
        specializations: created.specializations ?? [],
        reportsTo: created.reportsTo,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * fs_who_should
 *
 * Queries the live agent list and ToolManager.whoCanExecute() at execute-time
 * and returns actual matches — not a deferred request. The LLM gets a concrete
 * list it can immediately use as input for com_handoff.
 */
export function createFindCapableTool(
  deps: Pick<OrchestrationDeps, 'agents' | 'tools'>
): AgentTool {
  return {
    name: 'who_should',
    group: 'fs',
    description:
      'Discover which team members are authorized to perform a specific action. ' +
      'Call this before com_handoff to ensure you delegate to the right person.',
    permissionCheck: { type: 'none' },
    parameters: z.object({
      task: z.string().min(1).describe('Natural language description of the task'),
      requiredTool: z
        .string()
        .optional()
        .describe('Tool name that must be available (e.g. write_file)'),
      requiredArgs: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Arguments for requiredTool — used for permission checking'),
    }),
    tags: ['orchestration'],
    examples: ['fs_who_should({ task: "write to src/auth/", requiredTool: "fs_write_file" })'],
    async execute(params: unknown): Promise<FindCapableAgentResult> {
      const { task, requiredTool, requiredArgs } = params as {
        task: string;
        requiredTool?: string;
        requiredArgs?: Record<string, unknown>;
      };

      const allAgents = await deps.agents.getAllAgentsAsync();

      const matched: Agent[] = requiredTool
        ? await deps.tools.whoCanExecute(requiredTool, requiredArgs ?? {}, allAgents)
        : allAgents;

      return {
        type: 'fs_who_should_result',
        task,
        matches: matched.map((a) => ({ agentId: a.id, agentName: a.name, agentRole: a.role })),
        timestamp: new Date().toISOString(),
      };
    },
  };
}

// Keep pre-LLM regexes right above the tool they trigger.
export const TOOL_LIST_PRE_LLM_PATTERNS: readonly RegExp[] = [
  /\b(what|which|list|show)\b.*\b(tool|tools)\b/i,
  /\bwhat can you use\b/i,
  /\bavailable tools\b/i,
];

export function matchesToolListPreLlmIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return TOOL_LIST_PRE_LLM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * tool_list
 *
 * Returns the ToolCatalog for the calling agent at execute-time, optionally
 * filtered by tag. The LLM gets real, up-to-date entries.
 */
export function createListToolsTool(deps: Pick<OrchestrationDeps, 'tools'>): AgentTool {
  return {
    name: 'list',
    group: 'tool',
    description:
      'Show all tools currently available to you, including name, description, and parameters.',
    permissionCheck: { type: 'none' },
    parameters: z.object({
      tag: z.string().optional().describe('Filter by tag (e.g. "file", "orchestration", "hr")'),
    }),
    tags: ['orchestration'],
    examples: ['tool_list({})', 'tool_list({ tag: "file" })'],
    async execute(params: unknown, context: ToolContext): Promise<ToolCatalogResult> {
      const { tag } = params as { tag?: string };

      let entries = deps.tools.catalog(context.agent);
      if (tag) {
        entries = entries.filter((e) => e.tags?.includes(tag));
      }

      return {
        type: 'tool_list_result',
        entries,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

// Keep pre-LLM regexes right above the tool they trigger.
export const TEAM_LIST_PRE_LLM_PATTERNS: readonly RegExp[] = [
  /\b(what|which|list|show)\b.*\b(employee|employees|agent|agents|team|teammates|team members)\b/i,
  /\bwho\b.*\b(employee|employees|agent|agents|team|teammates|team members)\b/i,
  /\bwho\s+is\s+on\s+the\s+team\b/i,
  /\bshow\s+all\s+(agents|employees|team members)\b/i,
  /\blist\s+(all\s+)?(agents|employees|team members)\b/i,
];

export function matchesTeamListPreLlmIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return TEAM_LIST_PRE_LLM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * team_list
 *
 * Returns all known team members as a structured snapshot.
 */
export function createTeamListTool(deps: Pick<OrchestrationDeps, 'agents'>): AgentTool {
  return {
    name: 'list',
    group: 'team',
    description: 'List all team members with their IDs, names, and roles.',
    permissionCheck: { type: 'none' },
    parameters: z.object({}),
    tags: ['orchestration'],
    examples: ['team_list({})'],
    async execute(): Promise<TeamListResult> {
      const members = await deps.agents.getAllAgentsAsync();

      return {
        type: 'team_list_result',
        members: members.map((agent) => ({
          agentId: agent.id,
          agentName: agent.name,
          agentRole: agent.role,
        })),
        timestamp: new Date().toISOString(),
      };
    },
  };
}

// ── Assembly helper ───────────────────────────────────────────────────────────

/** Assemble all four orchestration tools in one call. */
export function createOrchestrationTools(deps: OrchestrationDeps): AgentTool[] {
  return [
    createHandoffTool(deps),
    createHireTool(deps),
    createFindCapableTool(deps),
    createListToolsTool(deps),
    createTeamListTool(deps),
  ];
}
