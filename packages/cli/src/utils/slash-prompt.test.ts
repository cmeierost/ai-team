import { describe, expect, it, vi } from 'vitest';
import { SLASH_PROMPT_TESTING } from './slash-prompt.js';

describe('slash prompt suggestions', () => {
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
    expect(suggestions.map((entry) => entry.key)).toEqual(['help', 'hello']);

    expect(SLASH_PROMPT_TESTING.shouldApplySelectionOnEnter('/he', suggestions, -1)).toBe(false);
    expect(SLASH_PROMPT_TESTING.shouldApplySelectionOnEnter('/he', suggestions, 0)).toBe(true);
  });

  it('does not auto-apply for non-slash input', () => {
    const suggestions = [{ key: 'help', aliases: ['h'], usage: '/help', description: 'Show help' }];
    expect(SLASH_PROMPT_TESTING.shouldApplySelectionOnEnter('hello', suggestions, -1)).toBe(false);
  });
});
