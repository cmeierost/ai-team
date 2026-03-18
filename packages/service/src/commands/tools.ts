import {
  type Agent,
  type AgentTool,
} from '@ai-team/core';
import {
  type ListToolsOptions,
  type ListToolsResponse,
  type UpdateAgentToolOptions,
  type UpdateAgentToolResponse,
} from '../contracts.js';
import { createContainer, TOKENS } from '../container/index.js';
import { resolveAgentForOperation } from '../utils/agent-resolution.js';
import {
  type GovernanceRequest,
  assertDefaultGovernancePolicy,
  requireUserApproval,
  resolveGovernanceActor,
} from './governance.js';

function buildCatalogEntry(toolManager: { toSchema: (toolName: string) => { parameters?: Record<string, unknown> } | undefined }, tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    schema: toolManager.toSchema(tool.name)?.parameters ?? {},
    tags: tool.tags,
    examples: tool.examples,
  };
}

function sortToolsByName(tools: AgentTool[]): AgentTool[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveFullAgent(workspaceRoot: string, query: string, operation: string): Promise<Agent> {
  const container = createContainer({ workspaceRoot });
  const agentManager = container.resolve(TOKENS.AgentManager);
  await agentManager.initialize();
  const resolved = resolveAgentForOperation(agentManager, query, operation);
  const agent = agentManager.getAgent(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }
  return agent;
}

export async function listToolsCommand(
  workspaceRoot: string,
  options: ListToolsOptions = {},
): Promise<ListToolsResponse> {
  const container = createContainer({ workspaceRoot });
  const toolManager = container.resolve(TOKENS.ToolManager);
  const allTools = sortToolsByName(toolManager.getAll());

  if (!options.agent) {
    return {
      entries: allTools.map(tool => buildCatalogEntry(toolManager, tool)),
      timestamp: new Date().toISOString(),
    };
  }

  const agent = await resolveFullAgent(workspaceRoot, options.agent, 'list tools for agent');
  const entries = await Promise.all(allTools.map(async (tool) => {
    const permission = await toolManager.canExecute(agent, tool.name, {});
    return {
      ...buildCatalogEntry(toolManager, tool),
      allowedForAgent: permission.allowed,
      deniedReason: permission.allowed ? undefined : permission.reason,
    };
  }));

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
  workspaceRoot: string,
  options: UpdateAgentToolOptions,
): Promise<UpdateAgentToolResponse> {
  const container = createContainer({ workspaceRoot });
  const toolManager = container.resolve(TOKENS.ToolManager);
  const agentManager = container.resolve(TOKENS.AgentManager);
  await agentManager.initialize();

  const resolved = resolveAgentForOperation(agentManager, options.agent, 'allow tool');
  const agent = agentManager.getAgent(resolved.id);
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

  const nextTools = toolAllowed ? currentTools : [...currentTools, options.tool].sort((a, b) => a.localeCompare(b));
  const nextDenied = currentDenied.filter(t => t !== options.tool);
  const changed = !toolAllowed || toolDenied;

  const updatedAgent = changed
    ? await agentManager.updateAgent(agent.id, { tools: nextTools, disallowedTools: nextDenied.length > 0 ? nextDenied : undefined })
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
  workspaceRoot: string,
  options: UpdateAgentToolOptions,
  governance: GovernanceRequest,
): Promise<UpdateAgentToolResponse> {
  const actor = await resolveGovernanceActor(workspaceRoot, governance.requestedBy, 'tool_allow');
  assertDefaultGovernancePolicy(actor);
  await requireUserApproval(
    governance,
    `Approve tool_allow by ${actor.name} (${actor.id}) for target agent '${options.agent}' and tool '${options.tool}'?`,
  );

  return allowToolCommand(workspaceRoot, options);
}

export async function disallowToolCommand(
  workspaceRoot: string,
  options: UpdateAgentToolOptions,
): Promise<UpdateAgentToolResponse> {
  const container = createContainer({ workspaceRoot });
  const toolManager = container.resolve(TOKENS.ToolManager);
  const agentManager = container.resolve(TOKENS.AgentManager);
  await agentManager.initialize();

  const resolved = resolveAgentForOperation(agentManager, options.agent, 'disallow tool');
  const agent = agentManager.getAgent(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }

  if (!toolManager.get(options.tool)) {
    throw new Error(`Unknown tool: ${options.tool}`);
  }

  const currentTools = agent.tools ?? [];
  const currentDenied = agent.disallowedTools ?? [];
  const nextTools = currentTools.filter(t => t !== options.tool);
  const alreadyDenied = currentDenied.includes(options.tool);
  const nextDenied = alreadyDenied
    ? currentDenied
    : [...currentDenied, options.tool].sort((a, b) => a.localeCompare(b));
  const changed = nextTools.length !== currentTools.length || !alreadyDenied;

  const updatedAgent = changed
    ? await agentManager.updateAgent(agent.id, { tools: nextTools.length > 0 ? nextTools : undefined, disallowedTools: nextDenied })
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
  workspaceRoot: string,
  options: UpdateAgentToolOptions,
  governance: GovernanceRequest,
): Promise<UpdateAgentToolResponse> {
  const actor = await resolveGovernanceActor(workspaceRoot, governance.requestedBy, 'tool_deny');
  assertDefaultGovernancePolicy(actor);
  await requireUserApproval(
    governance,
    `Approve tool_deny by ${actor.name} (${actor.id}) for target agent '${options.agent}' and tool '${options.tool}'?`,
  );

  return disallowToolCommand(workspaceRoot, options);
}
