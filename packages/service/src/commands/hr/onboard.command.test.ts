import { describe, expect, it, vi } from 'vitest';
import { OnboardICommand } from './onboard.js';

describe('OnboardICommand', () => {
  it('forwards options to executeOnboarding', async () => {
    const cmd = new OnboardICommand('C:/workspace', {} as any, {} as any);
    const executeOnboarding = vi
      .spyOn(cmd as any, 'executeOnboarding')
      .mockResolvedValue(undefined);

    await cmd.execute({ options: { force: true } }, undefined, {
      workspaceRoot: 'C:/workspace',
    } as any);

    expect(executeOnboarding).toHaveBeenCalledWith(
      { options: { force: true } },
      undefined,
      'cli'
    );
  });
});
