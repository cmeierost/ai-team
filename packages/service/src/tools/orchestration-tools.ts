/**
 * Orchestration tools — service-layer tools the LLM uses to coordinate work.
 *
 * Each tool is a class that receives its dependencies via constructor injection.
 * This is Dependency Inversion: each tool depends on a minimal interface rather
 * than a concrete service type, so callers can inject any compatible implementation
 * without touching this file (Open/Closed).
 *
 * Usage:
 *   const tools = createOrchestrationTools({ sessions, agents, tools });
 *   for (const t of tools) toolManager.register(t);
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
} from '@ai-team/core';

// ─── DI contracts ─────────────────────────────────────────────────────────────

/**
 * Minimal session access needed by HandoffTool.
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
 * Minimal tool catalog access needed by FindCapableAgentTool and ListToolsTool.
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

// ─── Ask helpers ──────────────────────────────────────────────────────────────

type AskKind = 'input' | 'confirm' | 'select' | 'password' | 'checklist';

interface AskUserParams {
  kind?: AskKind;
  message: string;
  workflow?: {
    workflowId?: string;
    stepId?: string;
    questionId?: string;
    continuationToken?: string;
  };
  defaultText?: string;
  defaultBoolean?: boolean;
  choices?: Array<{ name: string; value: string; description?: string; recommended?: boolean }>;
  defaultChecklist?: string[];
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  minSelections?: number;
  maxSelections?: number;
  mask?: string;
}

function askResult(kind: AskKind, answer: unknown, workflow?: AskUserParams['workflow']) {
  return {
    type: 'com_ask_result',
    kind,
    answer,
    workflow,
    timestamp: new Date().toISOString(),
  };
}

function requireInputBridge(context: ToolContext): NonNullable<ToolContext['questionInput']> {
  if (!context.questionInput) {
    throw new Error('Question bridge unavailable: questionInput responder is not registered.');
  }
  return context.questionInput;
}

function normalizeYesNo(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'y' || value === 'yes' || value === 'true' || value === '1') return true;
  if (value === 'n' || value === 'no' || value === 'false' || value === '0') return false;
  return fallback;
}

async function askSelectWithInputFallback(
  context: ToolContext,
  params: {
    message: string;
    choices: Array<{ name: string; value: string; description?: string }>;
    defaultText?: string;
  }
): Promise<string> {
  const askInput = requireInputBridge(context);
  const options = params.choices.map((c) => `${c.value} (${c.name})`).join(', ');
  const prompt = `${params.message}\nOptions: ${options}${params.defaultText ? `\nDefault: ${params.defaultText}` : ''}\nType one option value:`;
  const raw = await askInput({ message: prompt });
  const picked = raw.trim();
  if (!picked && params.defaultText) return params.defaultText;
  if (!params.choices.some((c) => c.value === picked)) {
    throw new Error(
      `Invalid selection "${picked}". Expected one of: ${params.choices.map((c) => c.value).join(', ')}`
    );
  }
  return picked;
}

async function askChecklistWithInputFallback(
  context: ToolContext,
  params: {
    message: string;
    choices: Array<{ name: string; value: string; description?: string }>;
    defaultChecklist?: string[];
  }
): Promise<string[]> {
  const askInput = requireInputBridge(context);
  const options = params.choices.map((c) => `${c.value} (${c.name})`).join(', ');
  const defaults = params.defaultChecklist?.join(', ');
  const prompt = `${params.message}\nOptions: ${options}${defaults ? `\nDefaults: ${defaults}` : ''}\nType comma-separated option values:`;
  const raw = await askInput({ message: prompt });
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const selected =
    values.length === 0 && params.defaultChecklist ? params.defaultChecklist : values;
  const invalid = selected.filter((value) => !params.choices.some((c) => c.value === value));
  if (invalid.length > 0) {
    throw new Error(`Invalid checklist selection(s): ${invalid.join(', ')}.`);
  }
  return selected;
}

function ensureChoices(kind: 'select' | 'checklist', choices: AskUserParams['choices']) {
  if (!choices || choices.length === 0) {
    throw new Error(`com_ask ${kind} requires at least one choice.`);
  }
  return choices;
}

async function executeAskUser(params: AskUserParams, context: ToolContext): Promise<unknown> {
  const {
    kind = 'input',
    message,
    workflow,
    defaultText,
    defaultBoolean,
    choices,
    defaultChecklist,
    allowOther,
    otherLabel,
    otherPrompt,
    minSelections,
    maxSelections,
    mask,
  } = params;

  switch (kind) {
    case 'confirm': {
      if (context.questionConfirm) {
        return askResult(
          kind,
          await context.questionConfirm({ message, default: defaultBoolean }),
          workflow
        );
      }
      const askInput = requireInputBridge(context);
      const suffix = defaultBoolean ? '[Y/n]' : '[y/N]';
      const raw = await askInput({ message: `${message} ${suffix}` });
      return askResult(kind, normalizeYesNo(raw, defaultBoolean ?? false), workflow);
    }
    case 'select': {
      const options = ensureChoices(kind, choices);
      if (context.questionSelect) {
        return askResult(
          kind,
          await context.questionSelect({
            message,
            choices: options,
            default: defaultText,
            allowOther,
            otherLabel,
            otherPrompt,
          }),
          workflow
        );
      }
      return askResult(
        kind,
        await askSelectWithInputFallback(context, { message, choices: options, defaultText }),
        workflow
      );
    }
    case 'password': {
      if (context.questionPassword) {
        return askResult(kind, await context.questionPassword({ message, mask }), workflow);
      }
      const askInput = requireInputBridge(context);
      return askResult(kind, await askInput({ message }), workflow);
    }
    case 'checklist': {
      const options = ensureChoices(kind, choices);
      if (context.questionChecklist) {
        return askResult(
          kind,
          await context.questionChecklist({
            message,
            choices: options,
            default: defaultChecklist,
            minSelections,
            maxSelections,
            allowOther,
            otherLabel,
            otherPrompt,
          }),
          workflow
        );
      }
      return askResult(
        kind,
        await askChecklistWithInputFallback(context, {
          message,
          choices: options,
          defaultChecklist,
        }),
        workflow
      );
    }
    case 'input':
    default: {
      if (!context.questionInput) {
        throw new Error('Question bridge unavailable: questionInput responder is not registered.');
      }
      const prompt = defaultText ? `${message} (default: ${defaultText})` : message;
      return askResult('input', await context.questionInput({ message: prompt }), workflow);
    }
  }
}

// ─── Tools ────────────────────────────────────────────────────────────────────

interface HandoffParams {
  targetAgentId: string;
  briefingNote: string;
}

export class HandoffTool implements AgentTool<ToolContext, HandoffParams, HandoffRequest> {
  readonly name = 'handoff';
  readonly key = 'handoff';
  readonly group = 'com';
  readonly availableIn = { tool: true };
  readonly description =
    'Transfer the current conversation to another agent who is better suited ' +
    'to handle the request. Use when a task is outside your area of responsibility. ' +
    'You must have delegation permission to the target agent.';
  readonly permissionCheck = { type: 'agent-delegation' as const, argsPath: 'targetAgentId' };
  readonly parameters = z.object({
    targetAgentId: z.string().min(1).describe('ID of the agent to hand off to'),
    briefingNote: z
      .string()
      .min(1)
      .describe('Concise summary of the conversation and what the target agent needs to do.'),
  });
  readonly tags = ['orchestration'];

  constructor(
    private readonly agents: IAgentRegistry,
    private readonly sessions: ISessionGateway
  ) {}

  async execute(params: HandoffParams, context: ToolContext): Promise<HandoffRequest> {
    const { targetAgentId, briefingNote } = params;

    const target =
      (await this.agents.getAgentAsync(targetAgentId)) ??
      (await this.agents.getAllAgentsAsync()).find((candidate) => {
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

    const existingSession = await this.sessions.getLatestSession(target.id);

    return {
      type: 'handoff',
      targetAgentId: target.id,
      briefingNote,
      targetSessionId: existingSession?.id,
      timestamp: new Date().toISOString(),
    };
  }
}

interface HireParams {
  name: string;
  role: string;
  specializations?: string[];
  reportsTo?: string;
}

export class HireTool implements AgentTool<ToolContext, HireParams, HireResult> {
  readonly name = 'hire';
  readonly key = 'hire';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description =
    'Create a new virtual team member with a defined role. Requires manage_agents permission.';
  readonly permissionCheck = { type: 'manage-agents' as const };
  readonly parameters = z.object({
    name: z.string().min(1).describe('Full name of the new team member'),
    role: z.string().min(1).describe('Job role / title'),
    specializations: z.array(z.string()).optional().describe('Areas of expertise'),
    reportsTo: z.string().optional().describe('Agent ID of the direct manager'),
  });
  readonly tags = ['orchestration', 'hr'];

  constructor(private readonly agents: IAgentRegistry) {}

  async execute(params: HireParams, context: ToolContext): Promise<HireResult> {
    const { name, role, specializations = [], reportsTo } = params;

    const config: AgentConfig = {
      name,
      role,
      specializations,
      reportsTo: reportsTo ?? context.agent.id,
      contextLevel: ContextLevel.MODULE,
    };

    const created = await this.agents.createAgentAsync(config);

    return {
      type: 'hire',
      agentId: created.id,
      name: created.name,
      role: created.role,
      specializations: created.specializations ?? [],
      reportsTo: created.reportsTo,
      timestamp: new Date().toISOString(),
    };
  }
}

interface FindCapableAgentParams {
  task: string;
  requiredTool?: string;
  requiredArgs?: Record<string, unknown>;
}

export class FindCapableAgentTool
  implements AgentTool<ToolContext, FindCapableAgentParams, FindCapableAgentResult>
{
  readonly name = 'who_should';
  readonly key = 'who_should';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description =
    'Discover which team members are authorized to perform a specific action. ' +
    'Call this before com_handoff to ensure you delegate to the right person.';
  readonly permissionCheck = { type: 'none' as const };
  readonly parameters = z.object({
    task: z.string().min(1).describe('Natural language description of the task'),
    requiredTool: z
      .string()
      .optional()
      .describe('Tool name that must be available (e.g. write_file)'),
    requiredArgs: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arguments for requiredTool — used for permission checking'),
  });
  readonly tags = ['orchestration'];

  constructor(
    private readonly agents: IAgentRegistry,
    private readonly tools: IToolCatalog
  ) {}

  async execute(params: FindCapableAgentParams): Promise<FindCapableAgentResult> {
    const { task, requiredTool, requiredArgs } = params;

    const allAgents = await this.agents.getAllAgentsAsync();

    const matched: Agent[] = requiredTool
      ? await this.tools.whoCanExecute(requiredTool, requiredArgs ?? {}, allAgents)
      : allAgents;

    return {
      type: 'fs_who_should_result',
      task,
      matches: matched.map((a) => ({ agentId: a.id, agentName: a.name, agentRole: a.role })),
      timestamp: new Date().toISOString(),
    };
  }
}

export class AskUserTool implements AgentTool<ToolContext, AskUserParams, unknown> {
  readonly name = 'ask';
  readonly key = 'ask';
  readonly group = 'com';
  readonly availableIn = { tool: true };
  readonly description =
    'Ask the user for missing clarification as an LLM tool call. Use this instead of guessing when required information is unknown. Choose kind=input|confirm|select|password|checklist. Use select only when exactly one option may be chosen. Use checklist when multiple options may be valid (select all that apply). For select/checklist, provide machine-stable option values and clear labels.';
  readonly permissionCheck = { type: 'none' as const };
  readonly parameters = z.object({
    kind: z
      .enum(['input', 'confirm', 'select', 'password', 'checklist'])
      .default('input')
      .describe(
        'Question kind: input (free text), confirm (yes/no), select (single choice), password (sensitive text), checklist (multi-select). Prefer checklist when more than one option can be valid.'
      ),
    message: z
      .string()
      .min(1)
      .describe(
        'User-visible prompt text. For checklist prompts, phrase as "select all that apply".'
      ),
    workflow: z
      .object({
        workflowId: z.string().optional().describe('Workflow ID for stateful flows.'),
        stepId: z.string().optional().describe('Workflow step ID.'),
        questionId: z.string().optional().describe('Stable workflow question identifier.'),
        continuationToken: z.string().optional().describe('Workflow continuation token.'),
      })
      .optional()
      .describe('Optional workflow metadata passthrough for workflow controllers.'),
    defaultText: z
      .string()
      .optional()
      .describe('Default text value for input/select when the user submits empty input.'),
    defaultBoolean: z.boolean().optional().describe('Default yes/no value for confirm prompts.'),
    choices: z
      .array(
        z.object({
          name: z.string().min(1).describe('Human-readable option label.'),
          value: z.string().min(1).describe('Machine-stable value returned to the model.'),
          description: z.string().optional().describe('Optional helper text for this choice.'),
          recommended: z
            .boolean()
            .optional()
            .describe('Marks this option as recommended in capable UIs.'),
        })
      )
      .optional()
      .describe('Required for select/checklist prompts. Include every valid option.'),
    defaultChecklist: z
      .array(z.string())
      .optional()
      .describe('Default selected values for checklist prompts (kind=checklist only).'),
    allowOther: z
      .boolean()
      .optional()
      .describe('Allow custom value outside listed choices in supported UIs.'),
    otherLabel: z
      .string()
      .optional()
      .describe('Label for custom "other" option in supported UIs.'),
    otherPrompt: z
      .string()
      .optional()
      .describe('Prompt used when custom "other" option is selected.'),
    minSelections: z.number().int().min(0).optional().describe('Minimum selections for checklist.'),
    maxSelections: z.number().int().min(1).optional().describe('Maximum selections for checklist.'),
    mask: z.string().optional().describe('Mask character for password prompts'),
  });
  readonly tags = ['orchestration'];

  async execute(params: AskUserParams, context: ToolContext): Promise<unknown> {
    return executeAskUser(params, context);
  }
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

interface ListToolsParams {
  tag?: string;
}

export class ListToolsTool implements AgentTool<ToolContext, ListToolsParams, ToolCatalogResult> {
  readonly name = 'list';
  readonly key = 'list';
  readonly group = 'tool';
  readonly availableIn = { tool: true };
  readonly description =
    'Show all tools currently available to you, including name, description, and parameters.';
  readonly permissionCheck = { type: 'none' as const };
  readonly parameters = z.object({
    tag: z.string().optional().describe('Filter by tag (e.g. "file", "orchestration", "hr")'),
  });
  readonly tags = ['orchestration'];

  constructor(private readonly tools: IToolCatalog) {}

  async execute(params: ListToolsParams, context: ToolContext): Promise<ToolCatalogResult> {
    const { tag } = params;

    let entries = this.tools.catalog(context.agent);
    if (tag) {
      entries = entries.filter((e) => e.tags?.includes(tag));
    }

    return {
      type: 'tool_list_result',
      entries,
      timestamp: new Date().toISOString(),
    };
  }
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

export class TeamListTool implements AgentTool<ToolContext, Record<string, never>, TeamListResult> {
  readonly name = 'list';
  readonly key = 'list';
  readonly group = 'team';
  readonly availableIn = { tool: true };
  readonly description = 'List all team members with their IDs, names, and roles.';
  readonly permissionCheck = { type: 'none' as const };
  readonly parameters = z.object({});
  readonly tags = ['orchestration'];

  constructor(private readonly agents: IAgentRegistry) {}

  async execute(): Promise<TeamListResult> {
    const members = await this.agents.getAllAgentsAsync();

    return {
      type: 'team_list_result',
      members: members.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
      })),
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Assembly helper ──────────────────────────────────────────────────────────

/** Assemble all orchestration tools in one call. */
export function createOrchestrationTools(deps: OrchestrationDeps): AgentTool[] {
  return [
    new HandoffTool(deps.agents, deps.sessions),
    new AskUserTool(),
    new HireTool(deps.agents),
    new FindCapableAgentTool(deps.agents, deps.tools),
    new ListToolsTool(deps.tools),
    new TeamListTool(deps.agents),
  ];
}
