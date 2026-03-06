/**
 * Orchestration tools — service-layer tools the LLM uses to coordinate work.
 *
 * All four tools are created via factory functions that accept OrchestrationDeps.
 * This is Dependency Inversion: each tool depends on a minimal interface (e.g.
 * ISessionGateway) rather than a concrete service type, so callers can inject
 * any compatible implementation without touching this file (Open/Closed).
 *
 * Tools that produce real results (hire, find, list) do the work at execute-time
 * using injected deps, not inside the orchestrator. handoff_to_agent pre-validates
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
import { ContextLevel } from '@ai-team/core';
import type { Agent, AgentConfig, AgentTool, ToolCatalogEntry, ToolContext } from '@ai-team/core';
import type {
  HandoffRequest,
  HireResult,
  FindCapableAgentResult,
  ToolCatalogResult,
} from '@ai-team/core';

// ── DI contracts — each tool depends only on what it needs ───────────────────

/**
 * Minimal session access needed by handoff_to_agent.
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
  getAgent(id: string): Agent | undefined;
  getAllAgents(): Agent[];
  createAgent(config: AgentConfig): Promise<Agent>;
}

/**
 * Minimal tool catalog access needed by find_capable_agent and list_tools.
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
 * handoff_to_agent
 *
 * Validates the target agent exists and pre-resolves its latest session.
 * Returns a HandoffRequest — the orchestrator's tool-dispatch does the actual
 * context switch because it holds the full OrchestratorContext.
 */
export function createHandoffTool(
  deps: Pick<OrchestrationDeps, 'agents' | 'sessions'>,
): AgentTool {
  return {
    name: 'handoff_to_agent',
    description:
      'Transfer the current conversation to another agent who is better suited ' +
      'to handle the request. Use when a task is outside your area of responsibility. ' +
      'You must have delegation permission to the target agent.',
    permissionCheck: { type: 'agent-delegation', argsPath: 'targetAgentId' },
    parameters: z.object({
      targetAgentId: z.string().min(1).describe('ID of the agent to hand off to'),
      briefingNote: z.string().min(1).describe(
        'Concise summary of the conversation and what the target agent needs to do.',
      ),
    }),
    tags: ['orchestration'],
    examples: [
      'handoff_to_agent({ targetAgentId: "alice", briefingNote: "User wants to refactor auth. Context: ..." })',
    ],
    async execute(params: unknown): Promise<HandoffRequest> {
      const { targetAgentId, briefingNote } = params as {
        targetAgentId: string;
        briefingNote: string;
      };

      const target = deps.agents.getAgent(targetAgentId);
      if (!target) {
        throw new Error(
          `Agent not found: "${targetAgentId}". ` +
            'Use find_capable_agent to discover valid agent IDs.',
        );
      }

      // Pre-resolve target session — tool-dispatch uses this directly without
      // an extra lookup, keeping the hot path free of redundant I/O.
      const existingSession = await deps.sessions.getLatestSession(targetAgentId);

      return {
        type: 'handoff',
        targetAgentId,
        briefingNote,
        targetSessionId: existingSession?.id,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * hire_agent
 *
 * Actually creates the agent via AgentManager at execute-time so the LLM
 * gets immediate confirmation (the new agent's ID) rather than a deferred marker.
 */
export function createHireTool(deps: Pick<OrchestrationDeps, 'agents'>): AgentTool {
  return {
    name: 'hire_agent',
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
      'hire_agent({ name: "Bob Smith", role: "Senior Developer", specializations: ["Rust"] })',
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

      const created = await deps.agents.createAgent(config);

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
 * find_capable_agent
 *
 * Queries the live agent list and ToolManager.whoCanExecute() at execute-time
 * and returns actual matches — not a deferred request. The LLM gets a concrete
 * list it can immediately use as input for handoff_to_agent.
 */
export function createFindCapableTool(
  deps: Pick<OrchestrationDeps, 'agents' | 'tools'>,
): AgentTool {
  return {
    name: 'find_capable_agent',
    description:
      'Discover which team members are authorized to perform a specific action. ' +
      'Call this before handoff_to_agent to ensure you delegate to the right person.',
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
    examples: ['find_capable_agent({ task: "write to src/auth/", requiredTool: "write_file" })'],
    async execute(params: unknown): Promise<FindCapableAgentResult> {
      const { task, requiredTool, requiredArgs } = params as {
        task: string;
        requiredTool?: string;
        requiredArgs?: Record<string, unknown>;
      };

      const allAgents = deps.agents.getAllAgents();

      const matched: Agent[] = requiredTool
        ? await deps.tools.whoCanExecute(requiredTool, requiredArgs ?? {}, allAgents)
        : allAgents;

      return {
        type: 'find_capable_agent_result',
        task,
        matches: matched.map(a => ({ agentId: a.id, agentName: a.name, agentRole: a.role })),
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * list_tools
 *
 * Returns the ToolCatalog for the calling agent at execute-time, optionally
 * filtered by tag. The LLM gets real, up-to-date entries.
 */
export function createListToolsTool(deps: Pick<OrchestrationDeps, 'tools'>): AgentTool {
  return {
    name: 'list_tools',
    description:
      'Show all tools currently available to you, including name, description, and parameters.',
    permissionCheck: { type: 'none' },
    parameters: z.object({
      tag: z.string().optional().describe('Filter by tag (e.g. "file", "orchestration", "hr")'),
    }),
    tags: ['orchestration'],
    examples: ['list_tools({})', 'list_tools({ tag: "file" })'],
    async execute(params: unknown, context: ToolContext): Promise<ToolCatalogResult> {
      const { tag } = params as { tag?: string };

      let entries = deps.tools.catalog(context.agent);
      if (tag) {
        entries = entries.filter(e => e.tags?.includes(tag));
      }

      return {
        type: 'list_tools_result',
        entries,
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
  ];
}
