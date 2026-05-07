import { describe, expect, it, vi } from 'vitest';
import {
  assertDefaultGovernancePolicy,
  isDefaultGovernanceActor,
  requireUserApproval,
} from './governance.js';

function actor(role: string, id = role): any {
  return {
    id,
    role,
    name: id,
  };
}

describe('governance policy', () => {
  it('allows CEO and HR Director by default', () => {
    expect(isDefaultGovernanceActor(actor('ceo', 'michael-brown'))).toBe(true);
    expect(isDefaultGovernanceActor(actor('hr-director', 'emily-davis'))).toBe(true);
  });

  it('denies other roles by default', () => {
    expect(isDefaultGovernanceActor(actor('chief-architect', 'sarah-lee'))).toBe(false);
    expect(() => assertDefaultGovernancePolicy(actor('chief-architect', 'sarah-lee'))).toThrow(
      /Only CEO and HR Director are allowed by default/,
    );
  });

  it('requires explicit user approval', async () => {
    await expect(requireUserApproval({
      requestedBy: 'emily-davis',
      confirmUserApproval: vi.fn().mockResolvedValue(true),
    }, 'approve?')).resolves.toBeUndefined();

    await expect(requireUserApproval({
      requestedBy: 'emily-davis',
      confirmUserApproval: vi.fn().mockResolvedValue(false),
    }, 'approve?')).rejects.toThrow(/denied by user approval/i);
  });
});
