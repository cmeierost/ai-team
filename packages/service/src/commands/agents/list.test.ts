import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentApi = {
  getAllAgentsAsync: vi.fn(),
};

import { listEmployees } from './list.js';

describe('listEmployees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentApi.getAllAgentsAsync.mockResolvedValue([]);
  });

  it('returns unfiltered agents', async () => {
    const agents = [{ name: 'Maya', role: 'engineer' }, { name: 'Dimitri', role: 'designer' }];
    agentApi.getAllAgentsAsync.mockResolvedValue(agents);

    const result = await listEmployees(agentApi as any, {});

    expect(result).toEqual(agents);
  });

  it('applies role and feature filters', async () => {
    agentApi.getAllAgentsAsync.mockResolvedValue([
      { name: 'Maya', role: 'engineer', features: ['auth'] },
      { name: 'Dimitri', role: 'engineer', features: ['infra'] },
      { name: 'Jordan', role: 'designer', features: ['auth'] },
    ]);

    const result = await listEmployees(agentApi as any, { role: 'engineer', feature: 'auth' });

    expect(result).toEqual([{ name: 'Maya', role: 'engineer', features: ['auth'] }]);
  });
});
