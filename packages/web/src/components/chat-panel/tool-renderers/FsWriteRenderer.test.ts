import { describe, expect, it } from 'vitest';
import { buildDiffRows } from './FsWriteRenderer';

describe('FsWriteRenderer', () => {
  it('keeps unchanged lines and renders every addition and deletion', () => {
    const rows = buildDiffRows('alpha\nbeta\ngamma', 'alpha\nchanged\ngamma\nadded');

    expect(rows).toEqual([
      { kind: 'same', content: 'alpha', oldLine: 1, newLine: 1 },
      { kind: 'add', content: 'changed', newLine: 2 },
      { kind: 'remove', content: 'beta', oldLine: 2 },
      { kind: 'same', content: 'gamma', oldLine: 3, newLine: 3 },
      { kind: 'add', content: 'added', newLine: 4 },
    ]);
  });

  it('renders a created file entirely as additions', () => {
    expect(buildDiffRows('', 'first\nsecond')).toEqual([
      { kind: 'add', content: 'first', newLine: 1 },
      { kind: 'add', content: 'second', newLine: 2 },
    ]);
  });
});
