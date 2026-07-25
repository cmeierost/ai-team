import { describe, expect, it, vi } from 'vitest';
import { SetPermissionsCommand } from './set-permissions.tool.js';

describe('SetPermissionsCommand', () => {
  it('refreshes loaded agents after persisting a new permission file', async () => {
    const saveAsync = vi.fn(async () => undefined);
    const refreshAsync = vi.fn(async () => undefined);
    const command = new SetPermissionsCommand({ saveAsync } as any, { refreshAsync } as any);

    await command.execute(
      {
        agentId: 'elena-rostova',
        list: ['**/*'],
        read: ['**/*'],
        write: ['.ai-team/**/*'],
      },
      { history: [] }
    );

    expect(saveAsync).toHaveBeenCalled();
    expect(refreshAsync).toHaveBeenCalledAfter(saveAsync);
  });
});
