import { describe, expect, it, vi } from 'vitest';
import { OnboardICommand } from './onboard.js';

describe('OnboardICommand', () => {
  it('delegates to OnboardCommand and passes injected session manager', async () => {
    const execute = vi.fn(async () => undefined);
    const sessionManager = { getLatestSession: vi.fn() };
    const cmd = new OnboardICommand({ execute } as any, sessionManager as any);

    await cmd.execute({ options: { force: true } }, undefined, {
      workspaceRoot: 'C:/workspace',
    } as any);

    expect(execute).toHaveBeenCalledWith(
      { options: { force: true }, injected: { sessionManager } },
      expect.any(Object)
    );
  });
});
