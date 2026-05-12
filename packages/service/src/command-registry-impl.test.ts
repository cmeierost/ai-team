import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './command-registry-impl.js';

describe('CommandRegistry availability filters', () => {
  it('filters by cliChat when requested', () => {
    const registry = new CommandRegistry();

    registry.register({
      key: 'history',
      description: 'history',
      availableIn: { chat: true, cliChat: true },
      execute: async () => undefined,
    } as any);

    registry.register({
      key: 'help',
      description: 'help',
      availableIn: { chat: true },
      execute: async () => undefined,
    } as any);

    const cliChatCommands = registry.getAll({ availableIn: { cliChat: true } });

    expect(cliChatCommands.map((command) => command.key)).toEqual(['history']);
  });
});
