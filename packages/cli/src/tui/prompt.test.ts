import { describe, expect, it, vi } from 'vitest';
import { CURSOR_MARKER } from '@ai-team/tui';
import { Prompt } from './prompt.js';

describe('Prompt', () => {
  it('places the cursor after the prompt prefix and edited input', () => {
    const prompt = new Prompt('\x1b[1m>\x1b[0m ', vi.fn());
    prompt.focused = true;
    prompt.handleInput('a');
    prompt.handleInput('b');
    prompt.handleInput('\x1b[D');

    const lines = prompt.render(80);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('─');
    expect(lines[1]).toContain(`a${CURSOR_MARKER}b`);
    expect(lines[1]).toContain('\x1b[48;5;236m');
    expect(lines[2]).toContain('─');
  });

  it('submits the edited value on enter', () => {
    const resolve = vi.fn();
    const prompt = new Prompt('> ', resolve);
    prompt.handleInput('hello');
    prompt.handleInput('\r');

    expect(resolve).toHaveBeenCalledWith('hello');
    const lines = prompt.render(80);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('> ');
  });

  it('preserves bracketed paste content delivered across terminal chunks', () => {
    const prompt = new Prompt('> ', vi.fn());
    prompt.focused = true;

    prompt.handleInput('\x1b[200~hello');
    prompt.handleInput('\nworld\x1b[201~');

    expect(prompt.value).toBe('hello\nworld');
    expect(prompt.render(80)).toHaveLength(4);
  });

  it('grows for explicit and wrapped multiline input', () => {
    const resolve = vi.fn();
    const prompt = new Prompt('> ', resolve);
    prompt.focused = true;
    prompt.handleInput('first line');
    prompt.handleInput('\x1b[13;2u');
    prompt.handleInput('second line that wraps');

    const lines = prompt.render(24);
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.join('\n')).toContain('first line');
    expect(lines.join('\n')).toContain('second line');
    expect(lines.join('\n')).toContain(CURSOR_MARKER);

    prompt.handleInput('\r');
    expect(resolve).toHaveBeenCalledWith(
      'first line\nsecond line that wraps'
    );
  });

  it('renders and applies slash-command suggestions inside the TUI', () => {
    const resolve = vi.fn();
    const prompt = new Prompt('> ', resolve, [
      {
        key: 'handoff',
        aliases: ['pass'],
        usage: 'handoff <agent>',
        description: 'Hand off to another agent',
      },
    ]);
    prompt.focused = true;
    prompt.handleInput('/han');

    expect(prompt.render(80).join('\n')).toContain('/handoff');
    expect(prompt.render(80).join('\n')).toContain('Hand off to another agent');

    prompt.handleInput('\t');
    expect(prompt.value).toBe('/handoff <agent>');
    prompt.handleInput('\r');
    expect(resolve).toHaveBeenCalledWith('/handoff <agent>');
  });

  it('includes CLI-only exit commands in slash hints', () => {
    const prompt = new Prompt('> ', vi.fn());
    prompt.focused = true;
    prompt.handleInput('/');

    const rendered = prompt.render(80).join('\n');
    expect(rendered).toContain('/exit');
    expect(rendered).toContain('/q');
    expect(rendered).toContain('Exit the interactive CLI chat');
  });
});
