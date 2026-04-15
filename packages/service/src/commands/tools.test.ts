import { describe, expect, it, vi } from 'vitest';
import {
  allowToolCommand,
  disallowToolCommand,
  listToolsCommand,
  type ListToolsOptions,
} from './tools.js';

interface MutableAgent {
  id: string;
  name: string;
  role: string;
  tools?: string[];
  disallowedTools?: string[];
}

function createAgentManager(agent: MutableAgent) {
  return {
    resolveAgentAsync: vi.fn(async () => [agent]),
    getAllAgentsAsync: vi.fn(async () => [agent]),
    getAgentAsync: vi.fn(async () => agent),
    updateAgentAsync: vi.fn(async (_id: string, patch: Partial<MutableAgent>) => {
      Object.assign(agent, patch);
      return agent;
    }),
  } as any;
}

function createToolManager() {
  const tools = [
    { name: 'hire', group: 'hr', description: 'Hire an agent' },
    { name: 'performance', group: 'hr', description: 'Assess performance' },
    { name: 'list', group: 'tool', description: 'List tools' },
  ];

  return {
    getAll: vi.fn(() => tools as any[]),
    get: vi.fn((name: string) =>
      (tools as any[]).find((tool) => `${tool.group}_${tool.name}` === name)
    ),
    toSchema: vi.fn(() => ({ parameters: {} })),
    canExecute: vi.fn(async () => ({ allowed: true })),
  } as any;
}

describe('commands/tools', () => {
  it('lists canonical tool names for grouped tools', async () => {
    const agentManager = createAgentManager({ id: 'ceo', name: 'CEO', role: 'CEO' });
    const toolManager = createToolManager();

    const result = await listToolsCommand(agentManager, toolManager, {} satisfies ListToolsOptions);

    expect(result.entries.map((entry) => entry.name)).toEqual([
      'hr_hire',
      'tool_list',
      'hr_performance',
    ]);
  });

  it('allows a grouped tool when called with short name', async () => {
    const agent = { id: 'ceo', name: 'CEO', role: 'CEO', tools: [], disallowedTools: [] };
    const agentManager = createAgentManager(agent);
    const toolManager = createToolManager();

    const result = await allowToolCommand(agentManager, toolManager, {
      agent: 'ceo',
      tool: 'hire',
    });

    expect(result.tool).toBe('hr_hire');
    expect(result.tools).toContain('hr_hire');
    expect(agent.disallowedTools).toBeUndefined();
  });

  it('disallows a grouped tool when called with short name', async () => {
    const agent = {
      id: 'ceo',
      name: 'CEO',
      role: 'CEO',
      tools: ['hr_performance'],
      disallowedTools: [],
    };
    const agentManager = createAgentManager(agent);
    const toolManager = createToolManager();

    const result = await disallowToolCommand(agentManager, toolManager, {
      agent: 'ceo',
      tool: 'performance',
    });

    expect(result.tool).toBe('hr_performance');
    expect(agent.disallowedTools).toContain('hr_performance');
    expect(agent.tools).toBeUndefined();
  });

  it('throws for unknown tools', async () => {
    const agentManager = createAgentManager({ id: 'ceo', name: 'CEO', role: 'CEO' });
    const toolManager = createToolManager();

    await expect(
      disallowToolCommand(agentManager, toolManager, {
        agent: 'ceo',
        tool: 'totally_unknown_tool',
      })
    ).rejects.toThrow('Unknown tool: totally_unknown_tool');
  });
});
