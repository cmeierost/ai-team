import { describe, expect, it } from 'vitest';
import { BracketedPaste, LineEditor } from './input.js';

describe('BracketedPaste', () => {
  it('preserves content when the opening marker and content share a chunk', () => {
    const paste = new BracketedPaste();

    expect(paste.process('\x1b[200~hello')).toEqual({});
    expect(paste.process(' world\x1b[201~')).toEqual({ pasted: 'hello world' });
  });

  it('handles an entire paste in one input chunk', () => {
    const paste = new BracketedPaste();

    expect(paste.process('\x1b[200~hello\nworld\x1b[201~')).toEqual({
      pasted: 'hello\nworld',
    });
  });
});

describe('LineEditor', () => {
  it('edits Unicode characters by code point', () => {
    const editor = new LineEditor('a😀b');

    editor.handleInput('\x1b[D');
    editor.handleInput('\x7f');

    expect(editor.value).toBe('ab');
    expect(editor.cursorPos).toBe(1);
  });

  it('moves vertically between multiline input rows', () => {
    const editor = new LineEditor('one\nsecond\nthree');
    editor.handleInput('\x1b[A');
    expect(editor.cursorPos).toBe(9);
    editor.handleInput('\x1b[A');
    expect(editor.cursorPos).toBe(3);
    editor.handleInput('\x1b[B');
    expect(editor.cursorPos).toBe(7);
  });
});
