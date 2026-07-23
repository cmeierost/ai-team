import { describe, expect, it } from 'vitest';
import type { ITerminal } from '@ai-team/core';
import { Loader, Text } from '@ai-team/tui';
import { ChatLayout } from './chat-layout.js';
import { ChatView } from './chat-view.js';
import { Prompt } from './prompt.js';
import { StatusLine } from './status-line.js';
import { AgentResponse } from './agent-response.js';
import { SlashCommandResult } from './tool-results.js';

const terminal: ITerminal = {
  columns: 80,
  rows: 8,
  write: () => {},
  hideCursor: () => {},
  showCursor: () => {},
  start: () => {},
  stop: () => {},
};

describe('ChatLayout', () => {
  it('keeps chronological messages above a bottom composer and model footer', () => {
    const chat = new ChatView();
    chat.getContent().addChild(new Text('Clemens Meier → Michael Brown: first'));
    chat.getContent().addChild(new Text('Michael Brown → Clemens Meier: response'));
    chat.getContent().addChild(new Text('Clemens Meier → Michael Brown: second'));

    const spinner = new Loader();
    spinner.setVisible(false);
    const prompt = new Prompt('> ', () => {});
    const footer = new StatusLine();
    footer.setRight('gpt-5.2');
    const layout = new ChatLayout(
      terminal,
      chat,
      spinner,
      prompt,
      footer
    );

    const lines = layout.render(80);
    const transcript = lines.join('\n');
    expect(lines).toHaveLength(8);
    expect(lines.at(-3)).toContain('> ');
    expect(lines.at(-2)).toContain('─');
    expect(lines.at(-1)).toContain('gpt-5.2');
    expect(transcript.indexOf('first')).toBeLessThan(transcript.indexOf('response'));
    expect(transcript.indexOf('response')).toBeLessThan(transcript.indexOf('second'));
  });

  it('clips a long agent response above the composer and footer', () => {
    const chat = new ChatView();
    const response = new AgentResponse({
      name: 'Michael Brown',
      color: { r: 82, g: 165, b: 224 },
    }, 'Clemens Meier');
    response.setText(Array.from({ length: 30 }, (_, index) => `Line ${index + 1}`).join('\n'));
    chat.getContent().addChild(response);

    const spinner = new Loader();
    spinner.setVisible(false);
    const prompt = new Prompt('> ', () => {});
    const footer = new StatusLine();
    footer.setRight('Michael Brown (gpt-5.2) - session-1');
    const layout = new ChatLayout(
      terminal,
      chat,
      spinner,
      prompt,
      footer
    );

    const lines = layout.render(80);
    expect(lines).toHaveLength(terminal.rows);
    expect(lines.every((line) => !line.includes('\n') && !line.includes('\r'))).toBe(true);
    expect(lines.at(-3)).toContain('> ');
    expect(lines.at(-1)).toContain('session-1');
  });

  it('routes transcript navigation through the focused layout', () => {
    const chat = new ChatView();
    for (let index = 1; index <= 12; index += 1) {
      chat.getContent().addChild(new Text(`message ${index}`));
    }
    const spinner = new Loader();
    spinner.setVisible(false);
    const prompt = new Prompt('> ', () => {});
    const layout = new ChatLayout(
      terminal,
      chat,
      spinner,
      prompt,
      new StatusLine()
    );

    layout.focused = true;
    expect(layout.render(80).join('\n')).toContain('message 12');

    layout.handleInput('\x1b[5~');
    const older = layout.render(80).join('\n');
    expect(older).toContain('message 1');
    expect(older).not.toContain('message 12');

    layout.handleInput('x');
    expect(prompt.value).toBe('x');
  });

  it('routes modified Page Up through the layout to the beginning of the transcript', () => {
    const chat = new ChatView();
    for (let index = 1; index <= 120; index += 1) {
      chat.getContent().addChild(new Text(`message ${index}`));
    }
    const spinner = new Loader();
    spinner.setVisible(false);
    const prompt = new Prompt('> ', () => {});
    const layout = new ChatLayout(terminal, chat, spinner, prompt, new StatusLine());
    layout.focused = true;

    layout.render(80);
    for (let index = 0; index < 20; index += 1) {
      layout.handleInput('\x1b[5;2~');
    }

    const older = layout.render(80).join('\n');
    expect(older).toContain('message 1');
    expect(older).not.toContain('message 120');
  });

  it('routes mouse-wheel scrolling through the layout', () => {
    const chat = new ChatView();
    for (let index = 1; index <= 80; index += 1) {
      chat.getContent().addChild(new Text(`message ${index}`));
    }
    const spinner = new Loader();
    spinner.setVisible(false);
    const layout = new ChatLayout(terminal, chat, spinner, new Prompt('> ', () => {}), new StatusLine());
    layout.focused = true;
    layout.render(80);
    for (let index = 0; index < 30; index += 1) layout.handleInput('\x1b[<64;10;10M');
    expect(layout.render(80).join('\n')).toContain('message 1');
  });

  it('scrolls a slash result taller than the viewport without moving the composer', () => {
    const chat = new ChatView();
    chat.getContent().addChild(new SlashCommandResult(
      Array.from({ length: 30 }, (_, index) => `command ${index + 1}`).join('\n')
    ));
    const prompt = new Prompt('> ', () => {});
    const spinner = new Loader();
    spinner.setVisible(false);
    const layout = new ChatLayout(
      terminal,
      chat,
      spinner,
      prompt,
      new StatusLine()
    );
    layout.focused = true;

    const bottom = layout.render(80);
    expect(bottom.join('\n')).toContain('command 30');
    expect(bottom.at(-3)).toContain('> ');

    layout.handleInput('\x1b[5~');
    const older = layout.render(80);
    expect(older.join('\n')).not.toContain('command 30');
    expect(older.at(-3)).toContain('> ');

    layout.handleInput('x');
    expect(prompt.value).toBe('x');
  });

  it('retains every transcript row in inline scrollback mode', () => {
    const chat = new ChatView();
    for (let index = 1; index <= 120; index += 1) {
      chat.getContent().addChild(new Text(`message ${index}`));
    }
    const spinner = new Loader();
    spinner.setVisible(false);
    const layout = new ChatLayout(
      terminal,
      chat,
      spinner,
      new Prompt('> ', () => {}),
      new StatusLine(),
      true
    );

    const lines = layout.render(80);
    expect(lines.length).toBeGreaterThan(terminal.rows);
    expect(lines).toContain('message 1');
    expect(lines).toContain('message 120');
    expect(lines.at(-3)).toContain('> ');
  });
});
