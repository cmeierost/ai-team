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
  const changed = !currentTools.includes(options.tool);
  const nextTools = changed
    ? [...currentTools, options.tool].sort((a, b) => a.localeCompare(b))
    : [...currentTools];

  const updatedAgent = changed
    ? await agentManager.updateAgent(agent.id, { tools: nextTools })
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
  const nextTools = currentTools.filter(tool => tool !== options.tool);
  const changed = nextTools.length !== currentTools.length;

  const updatedAgent = changed
    ? await agentManager.updateAgent(agent.id, { tools: nextTools })
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
