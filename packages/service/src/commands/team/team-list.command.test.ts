import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamListICommand } from './team-list.command.js';

const agentManager = {
  getAllAgentsAsync: vi.fn(),
};

describe('TeamListICommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentManager.getAllAgentsAsync.mockResolvedValue([]);
  });

  it('uses team-list key for single-source registration', () => {
    const cmd = new TeamListICommand(agentManager as any);
    expect(cmd.key).toBe('team-list');
    expect(cmd.cli).toEqual({ command: 'list', parentKey: 'team' });
  });

  it('returns filtered employees', async () => {
    agentManager.getAllAgentsAsync.mockResolvedValue([
      { id: 'a', name: 'Maya', role: 'engineer', features: ['auth'] },
      { id: 'b', name: 'Dimitri', role: 'engineer', features: ['infra'] },
      { id: 'c', name: 'Jordan', role: 'designer', features: ['auth'] },
    ]);

    const cmd = new TeamListICommand(agentManager as any);
    const result = await cmd.execute({ role: 'engineer', feature: 'auth' }, undefined, {} as any);

    expect(result).toEqual([{ id: 'a', name: 'Maya', role: 'engineer', features: ['auth'] }]);
  });
});