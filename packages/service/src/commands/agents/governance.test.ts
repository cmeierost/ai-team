import { describe, expect, it, vi } from 'vitest';
import type { IAgentManager } from '@ai-team/core';
import { GovernanceService } from './governance.js';

function actor(role: string, id = role): any {
  return {
    id,
    role,
    name: id,
  };
}

function createMockAgentManager(): IAgentManager {
  return {
    resolveAgentForOperationAsync: vi.fn(),
    getAgentAsync: vi.fn(),
  } as any;
}

describe('governance policy', () => {
  it('allows CEO and HR Director by default', () => {
    const service = new GovernanceService(createMockAgentManager(), {} as any);
    expect(service.isDefaultGovernanceActor(actor('ceo', 'michael-brown'))).toBe(true);
    expect(service.isDefaultGovernanceActor(actor('hr-director', 'emily-davis'))).toBe(true);
  });

  it('denies other roles by default', () => {
    const service = new GovernanceService(createMockAgentManager(), {} as any);
    expect(service.isDefaultGovernanceActor(actor('chief-architect', 'sarah-lee'))).toBe(false);
    expect(() =>
      service.assertDefaultGovernancePolicy(actor('chief-architect', 'sarah-lee'))
    ).toThrow(/Only CEO and HR Director are allowed by default/);
  });

  it('requires explicit user approval', async () => {
    const service = new GovernanceService(createMockAgentManager(), {} as any);
    await expect(
      service.requireUserApproval(
        {
          requestedBy: 'emily-davis',
          confirmUserApproval: vi.fn().mockResolvedValue(true),
        },
        'approve?'
      )
    ).resolves.toBeUndefined();

    await expect(
      service.requireUserApproval(
        {
          requestedBy: 'emily-davis',
          confirmUserApproval: vi.fn().mockResolvedValue(false),
        },
        'approve?'
      )
    ).rejects.toThrow(/denied by user approval/i);
  });
});
