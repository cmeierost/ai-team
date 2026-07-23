import { describe, expect, it } from 'vitest';
import { visibleWidth } from '@ai-team/tui';
import { AgentResponse } from './agent-response.js';

const ANSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

describe('AgentResponse', () => {
  it('preserves characters that meet the message surface wrap boundary', () => {
    const source = '123456789012345can have';
    const response = new AgentResponse({
      name: 'Michael Brown',
      color: { r: 82, g: 165, b: 224 },
    });
    response.setText(source);

    const rendered = response.render(20);
    const bodyLines = rendered.slice(1);
    const reconstructed = rendered
      .slice(1)
      .map((line) => line.replace(ANSI_SEQUENCE, '').slice(3).trimEnd())
      .join('');

    expect(rendered.every((line) => visibleWidth(line) <= 20)).toBe(true);
    expect(
      bodyLines.every((line) => line.includes('\x1b[38;2;82;165;224m'))
    ).toBe(true);
    expect(reconstructed).toBe(source);
  });
});
