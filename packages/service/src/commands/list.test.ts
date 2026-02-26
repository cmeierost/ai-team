import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  getAllAgents: vi.fn(),
}));

vi.mock('@ai-team/core', () => {
  class AgentManager {
    constructor(_workspaceRoot: string) {}

    initialize = agentApi.initialize;
    getAllAgents = agentApi.getAllAgents;
  }

  return {
    AgentManager,
  };
});

import { listEmployeesCommand } from './list.js';

describe('listEmployeesCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentApi.initialize.mockResolvedValue(undefined);
    agentApi.getAllAgents.mockReturnValue([]);
  });

  it('returns unfiltered agents', async () => {
    const agents = [{ name: 'Maya', role: 'engineer' }, { name: 'Dimitri', role: 'designer' }];
    agentApi.getAllAgents.mockReturnValue(agents);

    const result = await listEmployeesCommand('c:/workspace', {});

    expect(agentApi.initialize).toHaveBeenCalledTimes(1);
    expect(result).toEqual(agents);
  });

  it('applies role and feature filters', async () => {
    agentApi.getAllAgents.mockReturnValue([
      { name: 'Maya', role: 'engineer', features: ['auth'] },
      { name: 'Dimitri', role: 'engineer', features: ['infra'] },
      { name: 'Jordan', role: 'designer', features: ['auth'] },
    ]);

    const result = await listEmployeesCommand('c:/workspace', { role: 'engineer', feature: 'auth' });

    expect(result).toEqual([{ name: 'Maya', role: 'engineer', features: ['auth'] }]);
  });
});
