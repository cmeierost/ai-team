import { describe, expect, it, vi } from 'vitest';
import { AccessCanCommand } from './access-can.command.js';
import { AccessWhoCommand } from './access-who.command.js';

describe('access commands', () => {
  it('AccessCanCommand delegates to the injected access service', async () => {
    const accessService = {
      doIHaveAccess: vi.fn().mockResolvedValue({ allowed: true }),
    };
    const command = new AccessCanCommand(accessService as any);
    const payload = { path: 'docs/readme.md', right: 'read' as const };

    const result = await command.execute(payload, undefined, {} as any);

    expect(result).toEqual({ allowed: true });
    expect(accessService.doIHaveAccess).toHaveBeenCalledWith(payload);
  });

  it('AccessWhoCommand delegates to the injected access service', async () => {
    const accessService = {
      whoHasAccess: vi.fn().mockResolvedValue({ contextIds: ['agent-a'] }),
    };
    const command = new AccessWhoCommand(accessService as any);
    const payload = { path: 'docs/readme.md', right: 'list' as const };

    const result = await command.execute(payload, undefined, {} as any);

    expect(result).toEqual({ contextIds: ['agent-a'] });
    expect(accessService.whoHasAccess).toHaveBeenCalledWith(payload);
  });
});