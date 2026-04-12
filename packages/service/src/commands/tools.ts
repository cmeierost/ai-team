import { type Agent, type AgentManager, type AgentTool } from '@ai-team/infrastructure';
import type { ToolManager } from '../tools/tool-manager.js';
import type { ListToolsResponse, UpdateAgentToolResponse } from '@ai-team/api-client';
export interface ListToolsOptions {
  agent?: string;
}

export interface UpdateAgentToolOptions {
  agent: string;
  tool: string;
}
import { resolveAgentForOperationAsync } from '../utils/agent-resolution.js';
import {
  type GovernanceRequest,
  assertDefaultGovernancePolicy,
  requireUserApproval,
  resolveGovernanceActor,
} from './governance.js';

function buildCatalogEntry(
  toolManager: {
    toSchema: (toolName: string) => { parameters?: Record<string, unknown> } | undefined;
  },
  tool: AgentTool
) {
  return {
    name: tool.name,
    description: tool.description,
    group: tool.group,
    schema: toolManager.toSchema(tool.name)?.parameters ?? {},
    tags: tool.tags,
    examples: tool.examples,
  };
}

function sortToolsByName(tools: AgentTool[]): AgentTool[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveFullAgent(
  agentManager: AgentManager,
  query: string,
  operation: string
): Promise<Agent> {
  const resolved = await resolveAgentForOperationAsync(agentManager, query, operation);
  const agent = await agentManager.getAgentAsync(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }
  return agent;
}

export async function listToolsCommand(
  agentManager: AgentManager,
  toolManager: ToolManager,
  options: ListToolsOptions = {}
): Promise<ListToolsResponse> {
  const allTools = sortToolsByName(toolManager.getAll());

  if (!options.agent) {
    return {
      entries: allTools.map((tool) => buildCatalogEntry(toolManager, tool)),
      timestamp: new Date().toISOString(),
    };
  }

  const agent = await resolveFullAgent(agentManager, options.agent, 'list tools for agent');
  const entries = await Promise.all(
    allTools.map(async (tool) => {
      const permission = await toolManager.canExecute(agent, tool.name, {});
      return {
        ...buildCatalogEntry(toolManager, tool),
        allowedForAgent: permission.allowed,
        deniedReason: permission.allowed ? undefined : permission.reason,
      };
    })
  );

  return {
    entries,
    timestamp: new Date().toISOString(),
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
    },
  };
}

export async function allowToolCommand(
  agentManager: AgentManager,
  toolManager: ToolManager,
  options: UpdateAgentToolOptions
): Promise<UpdateAgentToolResponse> {
  const resolved = await resolveAgentForOperationAsync(agentManager, options.agent, 'allow tool');
  const agent = await agentManager.getAgentAsync(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }

  if (!toolManager.get(options.tool)) {
    throw new Error(`Unknown tool: ${options.tool}`);
  }

  const currentTools = agent.tools ?? [];
  const currentDenied = agent.disallowedTools ?? [];
  const toolAllowed = currentTools.includes(options.tool);
  const toolDenied = currentDenied.includes(options.tool);

  const nextTools = toolAllowed
    ? currentTools
    : [...currentTools, options.tool].sort((a, b) => a.localeCompare(b));
  const nextDenied = currentDenied.filter((t) => t !== options.tool);
  const changed = !toolAllowed || toolDenied;

  const updatedAgent = changed
    ? await agentManager.updateAgentAsync(agent.id, {
        tools: nextTools,
        disallowedTools: nextDenied.length > 0 ? nextDenied : undefined,
      })
    : agent;

  return {
    agent: {
      id: updatedAgent.id,
      name: updatedAgent.name,
      role: updatedAgent.role,
    },
    tool: options.tool,
    tools: updatedAgent.tools ?? nextTools,
    changed,
  };
}

/**
 * Alias for allowToolCommand using governance naming.
 */
export async function toolAllowCommand(
  agentManager: AgentManager,
  toolManager: ToolManager,
  options: UpdateAgentToolOptions,
  governance: GovernanceRequest
): Promise<UpdateAgentToolResponse> {
  const actor = await resolveGovernanceActor(agentManager, governance.requestedBy, 'tool_allow');
  assertDefaultGovernancePolicy(actor);
  await requireUserApproval(
    governance,
    `Approve tool_allow by ${actor.name} (${actor.id}) for target agent '${options.agent}' and tool '${options.tool}'?`
  );

  return allowToolCommand(agentManager, toolManager, options);
}

export async function disallowToolCommand(
  agentManager: AgentManager,
  toolManager: ToolManager,
  options: UpdateAgentToolOptions
): Promise<UpdateAgentToolResponse> {
  const resolved = await resolveAgentForOperationAsync(
    agentManager,
    options.agent,
    'disallow tool'
  );
  const agent = await agentManager.getAgentAsync(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }

  if (!toolManager.get(options.tool)) {
    throw new Error(`Unknown tool: ${options.tool}`);
  }

  const currentTools = agent.tools ?? [];
  const currentDenied = agent.disallowedTools ?? [];
  const nextTools = currentTools.filter((t) => t !== options.tool);
  const alreadyDenied = currentDenied.includes(options.tool);
  const nextDenied = alreadyDenied
    ? currentDenied
    : [...currentDenied, options.tool].sort((a, b) => a.localeCompare(b));
  const changed = nextTools.length !== currentTools.length || !alreadyDenied;

  const updatedAgent = changed
    ? await agentManager.updateAgentAsync(agent.id, {
        tools: nextTools.length > 0 ? nextTools : undefined,
        disallowedTools: nextDenied,
      })
    : agent;

  return {
    agent: {
      id: updatedAgent.id,
      name: updatedAgent.name,
      role: updatedAgent.role,
    },
    tool: options.tool,
    tools: updatedAgent.tools ?? nextTools,
    changed,
  };
}

/**
 * Alias for disallowToolCommand using governance naming.
 */
export async function toolDenyCommand(
  agentManager: AgentManager,
  toolManager: ToolManager,
  options: UpdateAgentToolOptions,
  governance: GovernanceRequest
): Promise<UpdateAgentToolResponse> {
  const actor = await resolveGovernanceActor(agentManager, governance.requestedBy, 'tool_deny');
  assertDefaultGovernancePolicy(actor);
  await requireUserApproval(
    governance,
    `Approve tool_deny by ${actor.name} (${actor.id}) for target agent '${options.agent}' and tool '${options.tool}'?`
  );

  return disallowToolCommand(agentManager, toolManager, options);
}
