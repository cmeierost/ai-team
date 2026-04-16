import { describe, it, expect } from 'vitest';
import { analyzeContextOverlap } from './overlap.js';
import type { ResolvedContext } from './types.js';

function ctx(
  list: string[],
  read: string[],
  write: string[],
): ResolvedContext {
  return {
    list: new Set(list),
    read: new Set(read),
    write: new Set(write),
  };
}

describe('analyzeContextOverlap', () => {
  it('computes shared sets across all three rights', () => {
    const a = ctx(
      ['a.ts', 'b.ts', 'c.ts'],
      ['a.ts', 'b.ts'],
      ['a.ts'],
    );
    const b = ctx(
      ['b.ts', 'c.ts', 'd.ts'],
      ['b.ts', 'c.ts'],
      ['b.ts'],
    );

    const overlap = analyzeContextOverlap(a, b);
    expect(overlap.shared.list).toEqual(new Set(['b.ts', 'c.ts']));
    expect(overlap.shared.read).toEqual(new Set(['b.ts']));
    expect(overlap.shared.write.size).toBe(0);
  });

  it('listOnly contains files shared in list but not read', () => {
    const a = ctx(['a.ts', 'b.ts'], ['a.ts'], []);
    const b = ctx(['a.ts', 'b.ts'], ['a.ts'], []);

    const overlap = analyzeContextOverlap(a, b);
    expect(overlap.listOnly).toEqual(new Set(['b.ts']));
  });

  it('readOnly contains files shared in read but not write', () => {
    const a = ctx(['a.ts'], ['a.ts'], ['a.ts']);
    const b = ctx(['a.ts'], ['a.ts'], []);

    const overlap = analyzeContextOverlap(a, b);
    expect(overlap.readOnly).toEqual(new Set(['a.ts']));
    expect(overlap.shared.write.size).toBe(0);
  });

  it('returns empty sets when no overlap', () => {
    const a = ctx(['a.ts'], ['a.ts'], ['a.ts']);
    const b = ctx(['b.ts'], ['b.ts'], ['b.ts']);

    const overlap = analyzeContextOverlap(a, b);
    expect(overlap.shared.list.size).toBe(0);
    expect(overlap.shared.read.size).toBe(0);
    expect(overlap.shared.write.size).toBe(0);
    expect(overlap.listOnly.size).toBe(0);
    expect(overlap.readOnly.size).toBe(0);
  });

  it('handles empty contexts', () => {
    const a = ctx([], [], []);
    const b = ctx([], [], []);
    const overlap = analyzeContextOverlap(a, b);
    expect(overlap.shared.list.size).toBe(0);
  });

  it('full overlap when contexts are identical', () => {
    const files = ['x.ts', 'y.ts'];
    const a = ctx(files, files, files);
    const b = ctx(files, files, files);

    const overlap = analyzeContextOverlap(a, b);
    expect(overlap.shared.list).toEqual(new Set(files));
    expect(overlap.shared.read).toEqual(new Set(files));
    expect(overlap.shared.write).toEqual(new Set(files));
    // When shared in all, listOnly and readOnly should be empty
    expect(overlap.listOnly.size).toBe(0);
    expect(overlap.readOnly.size).toBe(0);
  });
});
