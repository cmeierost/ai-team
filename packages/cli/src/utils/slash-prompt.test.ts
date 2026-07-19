import { describe, expect, it, vi } from 'vitest';
import { SLASH_PROMPT_TESTING } from './slash-prompt.js';

describe('slash prompt suggestions', () => {
  it('normalizes prompt prefix by appending one trailing space when missing', () => {
    expect(SLASH_PROMPT_TESTING.normalizePromptPrefix('You -> Agent:')).toBe('You -> Agent: ');
  });

  it('keeps prompt prefix unchanged when trailing space already exists', () => {
    expect(SLASH_PROMPT_TESTING.normalizePromptPrefix('You -> Agent: ')).toBe('You -> Agent: ');
  });

  it('includes /exit in rendered suggestion list for matching slash input', () => {
    const commands = [
      {
        key: 'help',
        aliases: ['h'],
        usage: '/help',
        description: 'Show help',
      },
      {
        key: 'exit',
        aliases: ['quit', 'q'],
        usage: '/exit',
        description: 'Exit chat',
      },
    ];

    const suggestions = SLASH_PROMPT_TESTING.getSuggestions(commands, '/e');
    expect(suggestions.map((entry) => entry.key)).toContain('exit');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      SLASH_PROMPT_TESTING.renderAll('You:', '/e', suggestions, 0, 1);
      const outputText = stdoutSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
      expect(outputText).toContain('/exit');
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('auto-applies a single slash command match on enter', () => {
    const commands = [
      { key: 'help', aliases: ['h'], usage: '/help', description: 'Show help' },
      { key: 'exit', aliases: ['quit', 'q'], usage: '/exit', description: 'Exit chat' },
    ];

    const suggestions = SLASH_PROMPT_TESTING.getSuggestions(commands, '/he');
    expect(suggestions.map((entry) => entry.key)).toEqual(['help']);

    expect(SLASH_PROMPT_TESTING.shouldApplySelectionOnEnter('/he', suggestions, -1)).toBe(true);
  });

  it('does not auto-apply on enter when multiple slash command matches exist', () => {
    const commands = [
      { key: 'help', aliases: ['h'], usage: '/help', description: 'Show help' },
      { key: 'hello', aliases: [], usage: '/hello', description: 'Say hello' },
    ];

    const suggestions = SLASH_PROMPT_TESTING.getSuggestions(commands, '/he');
    expect(suggestions.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['help', 'hello'])
    );
    expect(suggestions).toHaveLength(2);

    expect(SLASH_PROMPT_TESTING.shouldApplySelectionOnEnter('/he', suggestions, -1)).toBe(false);
    expect(SLASH_PROMPT_TESTING.shouldApplySelectionOnEnter('/he', suggestions, 0)).toBe(true);
  });

  it('does not auto-apply for non-slash input', () => {
    const suggestions = [{ key: 'help', aliases: ['h'], usage: '/help', description: 'Show help' }];
    expect(SLASH_PROMPT_TESTING.shouldApplySelectionOnEnter('hello', suggestions, -1)).toBe(false);
  });

  it('normalizes usage without leading slash into executable slash command', () => {
    const cmd = {
      key: 'switch',
      aliases: ['chat'],
      usage: 'switch <agent|role>',
      description: 'Switch to another team member',
    };

    expect(SLASH_PROMPT_TESTING.normalizeAppliedSlashUsage(cmd)).toBe('/switch <agent|role>');
  });

  it('falls back to /key when usage does not start with slash or key', () => {
    const cmd = {
      key: 'new',
      aliases: [],
      usage: '<session-id>',
      description: 'Start a new session',
    };

    expect(SLASH_PROMPT_TESTING.normalizeAppliedSlashUsage(cmd)).toBe('/new');
  });

  it('orders built-in slash commands before dynamic skill commands', () => {
    const suggestions = SLASH_PROMPT_TESTING.getSuggestions(
      [
        {
          key: 'agent-skill',
          aliases: [],
          usage: '/agent-skill',
          description: 'Dynamic skill command',
          path: ['dynamic', 'skill'],
        },
        {
          key: 'help',
          aliases: ['h'],
          usage: '/help',
          description: 'Show help',
          path: ['chat'],
        },
      ] as any,
      '/'
    );

    expect(suggestions[0]?.key).toBe('help');
    expect(suggestions[1]?.key).toBe('agent-skill');
  });

  it('keeps commands before skills for bare slash even when skill key sorts first', () => {
    const suggestions = SLASH_PROMPT_TESTING.getSuggestions(
      [
        {
          key: 'a-skill',
          aliases: [],
          usage: '/a-skill',
          description: 'Dynamic skill command',
          path: ['dynamic', 'skill'],
        },
        {
          key: 'z-help',
          aliases: [],
          usage: '/z-help',
          description: 'Built-in command',
          path: ['chat'],
        },
      ] as any,
      '/'
    );

    expect(suggestions[0]?.key).toBe('z-help');
    expect(suggestions[1]?.key).toBe('a-skill');
  });

  it('truncates long suggestion descriptions', () => {
    const commands = [
      {
        key: 'long-skill',
        aliases: [],
        usage: '/long-skill',
        description:
          'This is a very long skill summary that should be truncated in the CLI suggestions to keep the list compact and readable for users.',
        path: ['dynamic', 'skill'],
      },
    ];

    const suggestions = SLASH_PROMPT_TESTING.getSuggestions(commands as any, '/long');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      SLASH_PROMPT_TESTING.renderAll('You:', '/long', suggestions, 0, 1);
      const outputText = stdoutSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
      expect(outputText).toContain('/long-skill');
      expect(outputText).toContain('[skill]');
      expect(outputText).toContain('…');
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
