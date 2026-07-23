import { describe, expect, it } from 'vitest';
import { visibleWidth } from '@ai-team/tui';
import { ToolEvent } from './tool-event.js';

describe('ToolEvent', () => {
  it('hard-wraps unbroken tool output within the terminal width', () => {
    const tool = new ToolEvent(
      'search_grep',
      { pattern: 'TODO' },
      'x'.repeat(400),
      'result'
    );

    const lines = tool.render(40);
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
    expect(lines.length).toBeGreaterThan(4);
  });

  it('bounds restored tool output while showing omitted-line count', () => {
    const tool = new ToolEvent(
      'search_grep',
      { pattern: 'TODO' },
      Array.from({ length: 30 }, (_, index) => `result ${index + 1}`).join('\n'),
      'result',
      { maxInputLines: 4, maxOutputLines: 6 }
    );

    const rendered = tool.render(80).join('\n');
    expect(rendered).toContain('result 1');
    expect(rendered).not.toContain('result 30');
    expect(rendered).toContain('24 more lines');
  });
});
