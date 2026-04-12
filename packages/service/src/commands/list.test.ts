import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentApi = vi.hoisted(() => ({
  getAllAgentsAsync: vi.fn(),
}));

vi.mock('@ai-team/core', () => {
  class AgentManager {
    constructor(_workspaceRoot: string) {}

    getAllAgentsAsync = agentApi.getAllAgentsAsync;
  }

  return {
    AgentManager,
  };
});

import { listEmployeesCommand } from './list.js';

describe('listEmployeesCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentApi.getAllAgentsAsync.mockResolvedValue([]);
  });

  it('returns unfiltered agents', async () => {
    const agents = [{ name: 'Maya', role: 'engineer' }, { name: 'Dimitri', role: 'designer' }];
    agentApi.getAllAgentsAsync.mockResolvedValue(agents);

    const result = await listEmployeesCommand('c:/workspace', {});

    expect(result).toEqual(agents);
  });

  it('applies role and feature filters', async () => {
    agentApi.getAllAgentsAsync.mockResolvedValue([
      { name: 'Maya', role: 'engineer', features: ['auth'] },
      { name: 'Dimitri', role: 'engineer', features: ['infra'] },
      { name: 'Jordan', role: 'designer', features: ['auth'] },
    ]);

    const result = await listEmployeesCommand('c:/workspace', { role: 'engineer', feature: 'auth' });

    expect(result).toEqual([{ name: 'Maya', role: 'engineer', features: ['auth'] }]);
  });
});
