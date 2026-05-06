import type { Agent, IAgentManager, AgentTool } from '@ai-team/core';
import type { ToolManager } from '../tools/tool-manager.js';
import { matchesToolSelector, toolKey } from '../tools/tool-manager.js';
import type { ListToolsResponse, UpdateAgentToolResponse } from '@ai-team/api-contracts';
import type { IMcpGateway } from '../orchestrator/pipeline.js';
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
  const key = toolKey(tool);
  const permType = tool.permissionCheck?.type;
  return {
    name: key,
    description: tool.description,
    group: tool.group,
    schema: toolManager.toSchema(key)?.parameters ?? {},
    tags: tool.tags,
    examples: tool.examples,
    fileRightsDependent: permType === 'file-read' || permType === 'file-write',
  };
}

function sortToolsByName(tools: AgentTool[]): AgentTool[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveFullAgent(
  agentManager: IAgentManager,
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

function resolveToolIdentifier(
  toolManager: Pick<ToolManager, 'get' | 'getAll'>,
  requestedTool: string
): string {
  const normalizedRequestedTool = requestedTool.trim();
  if (!normalizedRequestedTool) {
    throw new Error('Tool selector cannot be empty.');
  }

  if (normalizedRequestedTool.includes('*')) {
    const hasMatch = toolManager
      .getAll()
      .some((tool) => matchesToolSelector(normalizedRequestedTool, tool));
    if (!hasMatch) {
      throw new Error(`Unknown tool: ${normalizedRequestedTool}`);
    }
    return normalizedRequestedTool;
  }

  // Preferred: canonical lookup key (e.g., "hr_hire").
  if (toolManager.get(normalizedRequestedTool)) {
    return normalizedRequestedTool;
  }

  // Backward compatibility: accept short names returned by older API payloads
  // (e.g., "hire" -> "hr_hire", "performance" -> "hr_performance").
  const canonicalMatches = Array.from(
    new Set(
      toolManager
        .getAll()
        .filter((tool) => tool.name === normalizedRequestedTool)
        .map((tool) => toolKey(tool))
    )
  );

  if (canonicalMatches.length === 1) {
    return canonicalMatches[0];
  }

  if (canonicalMatches.length > 1) {
    throw new Error(
      `Ambiguous tool name: ${normalizedRequestedTool}. Use one of: ${canonicalMatches.join(', ')}`
    );
  }

  throw new Error(`Unknown tool: ${normalizedRequestedTool}`);
}

export async function listToolsCommand(
  agentManager: IAgentManager,
  toolManager: ToolManager,
  options: ListToolsOptions = {},
  mcpGateway?: IMcpGateway
): Promise<ListToolsResponse> {
  const [staticTools, mcpTools] = await Promise.all([
    Promise.resolve(sortToolsByName(toolManager.getAll())),
    mcpGateway ? mcpGateway.discover() : Promise.resolve([] as AgentTool[]),
  ]);

  if (!options.agent) {
    const mcpEntries = mcpTools.map((tool) => ({
      ...buildCatalogEntry(toolManager, tool),
      allowedForAgent: true,
    }));
    return {
      entries: [...staticTools.map((tool) => buildCatalogEntry(toolManager, tool)), ...mcpEntries],
      timestamp: new Date().toISOString(),
    };
  }

  const agent = await resolveFullAgent(agentManager, options.agent, 'list tools for agent');
  const staticEntries = await Promise.all(
    staticTools.map(async (tool) => {
      const permission = await toolManager.canExecute(agent, toolKey(tool), {});
      return {
        ...buildCatalogEntry(toolManager, tool),
        allowedForAgent: permission.allowed,
        deniedReason: permission.allowed ? undefined : permission.reason,
      };
    })
  );
  const mcpEntries = mcpTools.map((tool) => ({
    ...buildCatalogEntry(toolManager, tool),
    allowedForAgent: true,
  }));

  return {
    entries: [...staticEntries, ...mcpEntries],
    timestamp: new Date().toISOString(),
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
    },
  };
}

export async function allowToolCommand(
  agentManager: IAgentManager,
  toolManager: ToolManager,
  options: UpdateAgentToolOptions
): Promise<UpdateAgentToolResponse> {
  const resolved = await resolveAgentForOperationAsync(agentManager, options.agent, 'allow tool');
  const agent = await agentManager.getAgentAsync(resolved.id);
  if (!agent) {
    throw new Error(`Agent not found: ${resolved.id}`);
  }

  const resolvedTool = resolveToolIdentifier(toolManager, options.tool);

  const currentTools = agent.tools ?? [];
  const currentDenied = agent.disallowedTools ?? [];
  const toolAllowed = currentTools.includes(resolvedTool);
  const toolDenied = currentDenied.includes(resolvedTool);

  const nextTools = toolAllowed
    ? currentTools
    : [...currentTools, resolvedTool].sort((a, b) => a.localeCompare(b));
  const nextDenied = currentDenied.filter((t) => t !== resolvedTool);
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
    tool: resolvedTool,
    tools: updatedAgent.tools ?? nextTools,
    changed,
  };
}

/**
 * Alias for allowToolCommand using governance naming.
 */
export async function toolAllowCommand(
  agentManager: IAgentManager,
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
  agentManager: IAgentManager,
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

  const resolvedTool = resolveToolIdentifier(toolManager, options.tool);

  const currentTools = agent.tools ?? [];
  const currentDenied = agent.disallowedTools ?? [];
  const nextTools = currentTools.filter((t) => t !== resolvedTool);
  const alreadyDenied = currentDenied.includes(resolvedTool);
  const nextDenied = alreadyDenied
    ? currentDenied
    : [...currentDenied, resolvedTool].sort((a, b) => a.localeCompare(b));
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
    tool: resolvedTool,
    tools: updatedAgent.tools ?? nextTools,
    changed,
  };
}

/**
 * Alias for disallowToolCommand using governance naming.
 */
export async function toolDenyCommand(
  agentManager: IAgentManager,
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
