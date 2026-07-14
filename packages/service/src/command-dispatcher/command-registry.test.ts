import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './command-registry.js';

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

  it('allows duplicate tool keys across groups and resolves by derived name', () => {
    const registry = new CommandRegistry();

    const fsList = {
      key: 'list',
      group: 'fs',
      description: 'list files',
      availableIn: { tool: true },
      execute: async () => undefined,
    } as any;
    const teamList = {
      key: 'list',
      group: 'team',
      description: 'list team members',
      availableIn: { tool: true },
      execute: async () => undefined,
    } as any;

    expect(() => registry.register(fsList)).not.toThrow();
    expect(() => registry.register(teamList)).not.toThrow();

    expect(registry.get('fs_list')).toBe(fsList);
    expect(registry.get('team_list')).toBe(teamList);
  });
});
