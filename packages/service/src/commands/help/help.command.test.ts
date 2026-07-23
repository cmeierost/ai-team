import { describe, expect, it } from 'vitest';
import { HelpChatCommand } from './help.command.js';

const entries = [
  {
    key: 'help',
    group: 'system',
    aliases: ['help'],
    description: 'Show help',
    availableIn: { chat: true, cli: true },
  },
  {
    key: 'switch',
    group: 'session',
    aliases: ['switch'],
    description: 'Switch agent',
    availableIn: { chat: true },
  },
  {
    key: 'list',
    group: 'team',
    description: 'List team members',
    availableIn: { chat: true, cli: true },
  },
] as any;

describe('HelpChatCommand', () => {
  it('renders grouped slash commands and aliases for chat help', async () => {
    const command = new HelpChatCommand(() => entries);
    const result = await command.execute('', { history: [], invocationSurface: 'slash' });

    expect(result.message).toContain('/session switch');
    expect(result.message).toContain('[aliases: /switch]');
    expect(result.message).toContain('/system help');
  });

  it('keeps direct CLI help limited to CLI-visible commands and CLI syntax', async () => {
    const command = new HelpChatCommand(() => entries);
    const result = await command.execute('', { history: [], invocationSurface: 'cli' });

    expect(result.message).toContain('ait system help');
    expect(result.message).toContain('ait team list');
    expect(result.message).not.toContain('switch agent');
  });

  it('renders CLI detail with the direct CLI route', async () => {
    const command = new HelpChatCommand(() => entries);
    const result = await command.execute(
      JSON.stringify({ filter: 'team list' }),
      { history: [], invocationSurface: 'cli' }
    );

    expect(result.message).toContain('ait team list');
    expect(result.message).not.toContain('/team list');
  });
});
