import { describe, expect, it } from 'vitest';
import { StatusLine } from './status-line.js';

describe('StatusLine', () => {
  it('preserves right-aligned model metadata in narrow terminals', () => {
    const status = new StatusLine();
    status.setLeft('C:\\a\\very\\long\\workspace\\path');
    status.setRight('gpt-5.2');

    expect(status.render(24).join('')).toContain('gpt-5.2');
  });

  it('renders the working directory like session metadata without a background', () => {
    const status = new StatusLine();
    status.setLeft('C:\\Projects\\ai-team -');
    status.setRight('session-1');

    const rendered = status.render(80).join('');
    expect(rendered).toContain('\x1b[2mC:\\Projects\\ai-team -\x1b[0m');
    expect(rendered).toContain('\x1b[2msession-1\x1b[0m');
    expect(rendered).not.toContain('\x1b[100m');
  });
});
