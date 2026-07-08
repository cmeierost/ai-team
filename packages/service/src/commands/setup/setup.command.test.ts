import { describe, expect, it, vi } from 'vitest';
import { SetupICommand } from './setup.command.js';

describe('SetupICommand', () => {
  it('delegates to SetupCommand with workspaceRoot from runtime', async () => {
    const execute = vi.fn(async () => undefined);
    const cmd = new SetupICommand('C:/workspace', { execute } as any);

    await cmd.execute({ options: { force: true } }, {} as any);

    expect(execute).toHaveBeenCalledWith(
      { workspaceRoot: 'C:/workspace', options: { force: true } }
    );
  });
});
