import { describe, expect, it, vi } from 'vitest';
import { InitICommand } from './init.command.js';
import { initCommand } from './init.js';
import { EmitService } from '../../interaction/emit-service.js';

vi.mock('./init.js', () => ({
  initCommand: vi.fn(async () => undefined),
}));

describe('InitICommand', () => {
  it('delegates to InitCommand with runtime workspace/options and injected session manager', async () => {
    const cmd = new InitICommand('C:/workspace', new EmitService(() => {}), undefined);

    await cmd.execute({ options: { force: true } }, undefined as unknown as any);

    expect(initCommand).toHaveBeenCalledWith(
      'C:/workspace',
      { force: true },
      expect.objectContaining({ questionConfirm: expect.any(Function) })
    );
  });
});
