import { describe, expect, it } from 'vitest';
import type { ITerminal } from '@ai-team/core';
import { Loader, TUI } from '@ai-team/tui';
import { ChatLayout } from './chat-layout.js';
import { ChatView } from './chat-view.js';
import { Prompt } from './prompt.js';
import { TuiQuestionPresenter } from './question-composer.js';
import { StatusLine } from './status-line.js';

class FakeTerminal implements ITerminal {
  columns = 80;
  rows = 24;
  writes: string[] = [];
  private onInput?: (data: string) => void;
  write(data: string): void { this.writes.push(data); }
  hideCursor(): void {}
  showCursor(): void {}
  start(onInput: (data: string) => void): void { this.onInput = onInput; }
  stop(): void {}
  input(data: string): void { this.onInput?.(data); }
}

function harness() {
  const terminal = new FakeTerminal();
  const base = new Prompt('> ', () => {});
  const layout = new ChatLayout(
    terminal,
    new ChatView(),
    new Loader(),
    base,
    new StatusLine()
  );
  const tui = new TUI(terminal);
  tui.addChild(layout);
  tui.start();
  tui.setFocused(layout);
  return {
    terminal,
    layout,
    base,
    presenter: new TuiQuestionPresenter(layout, tui),
    stop: () => tui.stop(),
  };
}

describe('TuiQuestionPresenter', () => {
  it('validates Unicode input and restores the underlying composer', async () => {
    const h = harness();
    const answer = h.presenter.input({
      message: 'Name',
      validate: (value) => value.length >= 2 || 'Too short',
    });

    h.terminal.input('é');
    h.terminal.input('\r');
    expect(h.layout.render(80).join('\n')).toContain('Too short');
    h.terminal.input('😊');
    h.terminal.input('\r');

    await expect(answer).resolves.toBe('é😊');
    expect(h.base.focused).toBe(true);
    expect(h.layout.render(80).join('\n')).toContain('> ');
    h.stop();
  });

  it('supports confirm defaults and select recommendations, descriptions, and Other', async () => {
    const h = harness();
    const confirmed = h.presenter.confirm({ message: 'Proceed?', default: false });
    h.terminal.input('\r');
    await expect(confirmed).resolves.toBe(false);

    const selected = h.presenter.select({
      message: 'Owner',
      choices: [{
        name: 'Sarah',
        value: 'sarah',
        description: 'Architect',
        recommended: true,
      }],
      allowOther: true,
      otherLabel: 'Someone else',
      otherPrompt: 'Enter owner',
    });
    const rendered = h.layout.render(80).join('\n');
    expect(rendered).toContain('Architect');
    expect(rendered).toContain('★');
    h.terminal.input('\x1b[B');
    h.terminal.input('\r');
    h.terminal.input('Zoë');
    h.terminal.input('\r');
    await expect(selected).resolves.toBe('Zoë');
    h.stop();
  });

  it('submits the highlighted Allow choice instead of the original deny default', async () => {
    const h = harness();
    const confirmed = h.presenter.confirm({
      message: 'Allow Michael Brown to run fs_delete?',
      default: false,
      style: 'allow',
    });

    expect(h.layout.render(80).join('\n')).toContain('Allow');
    h.terminal.input('\x1b[D');
    h.terminal.input('\r');

    await expect(confirmed).resolves.toBe(true);
    h.stop();
  });

  it('enforces checklist selection limits and supports defaults', async () => {
    const h = harness();
    const answer = h.presenter.checklist({
      message: 'Select all that apply',
      choices: [
        { name: 'One', value: 'one' },
        { name: 'Two', value: 'two' },
      ],
      default: ['one'],
      minSelections: 1,
      maxSelections: 1,
    });

    h.terminal.input('\x1b[B');
    h.terminal.input(' ');
    expect(h.layout.render(80).join('\n')).toContain('Select at most 1 option');
    h.terminal.input('\r');
    await expect(answer).resolves.toEqual(['one']);
    h.stop();
  });

  it('masks passwords and rejects pending questions on abort', async () => {
    const h = harness();
    const password = h.presenter.password({ message: 'Secret', mask: '•' });
    h.terminal.input('päss');
    const rendered = h.layout.render(80).join('\n');
    expect(rendered).toContain('••••');
    expect(rendered).not.toContain('päss');
    h.terminal.input('\r');
    await expect(password).resolves.toBe('päss');

    const pending = h.presenter.input({ message: 'Never answered' });
    h.presenter.abort(new Error('shutdown'));
    await expect(pending).rejects.toThrow('shutdown');
    expect(h.base.focused).toBe(true);
    h.stop();
  });
});
