import { describe, expect, it } from 'vitest';
import { Text } from '@ai-team/tui';
import { ChatViewport } from './chat-viewport.js';

describe('ChatViewport', () => {
  it('navigates from the newest messages to root history and back', () => {
    const viewport = new ChatViewport();
    viewport.setMaxVisibleLines(3);
    for (let index = 1; index <= 15; index += 1) {
      viewport.getContent().addChild(new Text(`message ${index}`));
    }

    expect(viewport.render(80)).toEqual([
      'message 13',
      'message 14',
      'message 15',
    ]);

    viewport.handleInput('\x1b[5~');
    expect(viewport.render(80)).toEqual([
      'message 3',
      'message 4',
      'message 5',
    ]);

    viewport.handleInput('\x1b[5~');
    expect(viewport.render(80)).toEqual([
      'message 1',
      'message 2',
      'message 3',
    ]);

    viewport.handleInput('\x1b[6~');
    viewport.handleInput('\x1b[6~');
    expect(viewport.render(80)).toEqual([
      'message 13',
      'message 14',
      'message 15',
    ]);

    viewport.getContent().addChild(new Text('message 16'));
    expect(viewport.render(80)).toEqual([
      'message 14',
      'message 15',
      'message 16',
    ]);
  });

  it('reaches the first line of a long thread with modified page keys', () => {
    const viewport = new ChatViewport();
    viewport.setMaxVisibleLines(5);
    for (let index = 1; index <= 250; index += 1) {
      viewport.getContent().addChild(new Text(`message ${index}`));
    }

    viewport.render(80);
    for (let index = 0; index < 40; index += 1) {
      viewport.handleInput('\x1b[5;2~');
    }
    expect(viewport.render(80)).toEqual([
      'message 1',
      'message 2',
      'message 3',
      'message 4',
      'message 5',
    ]);

    viewport.handleInput('\x1b[6;2~');
    expect(viewport.render(80)).toEqual([
      'message 11',
      'message 12',
      'message 13',
      'message 14',
      'message 15',
    ]);
    viewport.handleInput('\x1b[1;5H');
    expect(viewport.render(80)[0]).toBe('message 1');
  });
});
