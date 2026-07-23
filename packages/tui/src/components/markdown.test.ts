import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown.js';
import { visibleWidth } from '../utils.js';

describe('Markdown', () => {
  it('renders common assistant markdown as styled terminal lines', () => {
    const markdown = new Markdown(
      '# Result\n\nUse **care** with `code`.\n\n- first\n- second\n\n```ts\nconst ok = true;\n```'
    );

    const output = markdown.render(60).join('\n');
    expect(output).toContain('Result');
    expect(output).not.toContain('# Result');
    expect(output).toContain('\x1b[1m');
    expect(output).toContain('• first');
    expect(output).toContain('ts');
    expect(output).toContain('const ok = true;');
    expect(output).not.toContain('```');
  });

  it('wraps rendered markdown to the available terminal width', () => {
    const markdown = new Markdown('A deliberately long Markdown paragraph for a narrow terminal.');
    expect(markdown.render(16).every((line) => visibleWidth(line) <= 16)).toBe(true);
  });

  it('prefers word boundaries instead of splitting ordinary words', () => {
    const markdown = new Markdown('A deliberately long Markdown paragraph for a narrow terminal.');
    const plainLines = markdown
      .render(16)
      .map((line) => line.replaceAll(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''));

    expect(plainLines).toEqual([
      'A deliberately',
      'long Markdown',
      'paragraph for a',
      'narrow terminal.',
    ]);
  });
});
