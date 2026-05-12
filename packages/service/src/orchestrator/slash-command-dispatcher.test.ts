import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../command-registry-impl.js';
import { SlashCommandDispatcher } from './slash-command-dispatcher.js';

describe('SlashCommandDispatcher', () => {
  it('resolves and dispatches chat commands with slash runtime context', async () => {
    const execute = vi.fn(async () => ({ status: 'ok', message: 'done' }));
    const registry = new CommandRegistry();
    registry.register({
      key: 'ping',
      aliases: ['p'],
      description: 'ping',
      availableIn: { chat: true },
      execute,
    } as any);

    const dispatcher = new SlashCommandDispatcher(registry);
    const emit = vi.fn();
    const ctx = {
      workspaceRoot: '/workspace',
      sessionId: 'sess-1',
      agent: { id: 'ceo' },
      hooks: { emit },
    } as any;

    await dispatcher.dispatch('/p', 'hello', ctx);

    expect(execute).toHaveBeenCalledWith(
      'hello',
      ctx,
      expect.objectContaining({
        invocationSurface: 'slash',
        workspaceRoot: '/workspace',
        sessionId: 'sess-1',
        agentId: 'ceo',
      })
    );
  });

  it('throws for unknown slash command', async () => {
    const dispatcher = new SlashCommandDispatcher(new CommandRegistry());
    await expect(dispatcher.dispatch('/missing', '', { workspaceRoot: '/w' } as any)).rejects.toThrow(
      "Unknown slash command 'missing'"
    );
  });
});
