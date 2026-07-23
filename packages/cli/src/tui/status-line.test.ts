import { describe, expect, it } from 'vitest';
import { StatusLine } from './status-line.js';

describe('StatusLine', () => {
  it('preserves right-aligned model metadata in narrow terminals', () => {
    const status = new StatusLine();
    status.setLeft('C:\\a\\very\\long\\workspace\\path');
    status.setRight('gpt-5.2');

    expect(status.render(24).join('')).toContain('gpt-5.2');
  });
});
