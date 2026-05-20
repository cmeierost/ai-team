import { describe, expect, it, vi } from 'vitest';
import { AgentToolsService, type ListToolsOptions } from './tools-service.js';

interface MutableAgent {
  id: string;
  name: string;
  role: string;
  tools?: string[];
  disallowedTools?: string[];
}

function createAgentManager(agent: MutableAgent) {
  return {
    resolveAgentForOperationAsync: vi.fn(async () => ({ id: agent.id })),
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
    { key: 'hire', name: 'hire', group: 'hr', description: 'Hire an agent' },
    {
      key: 'performance',
      name: 'performance',
      group: 'hr',
      description: 'Assess performance',
    },
    { key: 'list', name: 'list', group: 'tool', description: 'List tools' },
  ];

  return {
    getAll: vi.fn(() => tools as any[]),
    get: vi.fn((name: string) =>
      (tools as any[]).find((tool) => `${tool.group}_${tool.key}` === name)
    ),
    toSchema: vi.fn(() => ({ parameters: {} })),
    canExecute: vi.fn(async () => ({ allowed: true })),
  } as any;
}

function createService(agent?: MutableAgent) {
  const agentManager = agent
    ? createAgentManager(agent)
    : createAgentManager({ id: 'ceo', name: 'CEO', role: 'CEO' });
  const toolManager = createToolManager();
  const governanceService = {} as any;
  return {
    service: new AgentToolsService(agentManager, toolManager, governanceService),
    agentManager,
    toolManager,
  };
}

describe('commands/tools', () => {
  it('lists canonical tool names for grouped tools', async () => {
    const { service } = createService();

    const result = await service.list({} satisfies ListToolsOptions);

    expect(result.entries.map((entry) => entry.name)).toEqual([
      'hr_hire',
      'hr_performance',
      'tool_list',
    ]);
  });

  it('allows a grouped tool when called with canonical key', async () => {
    const agent = { id: 'ceo', name: 'CEO', role: 'CEO', tools: [], disallowedTools: [] };
    const { service } = createService(agent);

    const result = await service.allow({
      agent: 'ceo',
      tool: 'hr_hire',
    });

    expect(result.tool).toBe('hr_hire');
    expect(result.tools).toContain('hr_hire');
    expect(agent.disallowedTools).toBeUndefined();
  });

  it('disallows a grouped tool when called with canonical key', async () => {
    const agent = {
      id: 'ceo',
      name: 'CEO',
      role: 'CEO',
      tools: ['hr_performance'],
      disallowedTools: [],
    };
    const { service } = createService(agent);

    const result = await service.disallow({
      agent: 'ceo',
      tool: 'hr_performance',
    });

    expect(result.tool).toBe('hr_performance');
    expect(agent.disallowedTools).toContain('hr_performance');
    expect(agent.tools).toBeUndefined();
  });

  it('rejects non-canonical short names', async () => {
    const agent = { id: 'ceo', name: 'CEO', role: 'CEO', tools: [], disallowedTools: [] };
    const { service } = createService(agent);

    await expect(
      service.allow({
        agent: 'ceo',
        tool: 'hire',
      })
    ).rejects.toThrow('Unknown tool: hire');
  });

  it('throws for unknown tools', async () => {
    const { service } = createService();

    await expect(
      service.disallow({
        agent: 'ceo',
        tool: 'totally_unknown_tool',
      })
    ).rejects.toThrow('Unknown tool: totally_unknown_tool');
  });

  it('allows wildcard tool selector when it matches registered tools', async () => {
    const agent = { id: 'ceo', name: 'CEO', role: 'CEO', tools: [], disallowedTools: [] };
    const { service } = createService(agent);

    const result = await service.allow({
      agent: 'ceo',
      tool: 'hr_*',
    });

    expect(result.tool).toBe('hr_*');
    expect(result.tools).toContain('hr_*');
  });

  it('rejects wildcard selector when it matches no registered tool', async () => {
    const { service } = createService();

    await expect(
      service.allow({
        agent: 'ceo',
        tool: 'totally_unknown_*',
      })
    ).rejects.toThrow('Unknown tool: totally_unknown_*');
  });
});
