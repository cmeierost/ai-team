import { describe, expect, it, vi } from 'vitest';
import { InitICommand } from './init.command.js';

describe('InitICommand', () => {
  it('delegates to InitCommand with runtime workspace/options and injected session manager', async () => {
    const execute = vi.fn(async () => undefined);
    const sessionManager = { getLatestSession: vi.fn() };
    const cmd = new InitICommand({ execute } as any, sessionManager as any);

    await cmd.execute(
      { options: { force: true } },
      undefined,
      {
        workspaceRoot: 'C:/workspace',
        questionConfirm: vi.fn(async () => true),
      } as any
    );

    expect(execute).toHaveBeenCalledWith(
      {
        workspaceRoot: 'C:/workspace',
        options: { force: true },
        injected: { sessionManager },
      },
      expect.objectContaining({ questionConfirm: expect.any(Function) })
    );
  });
});
