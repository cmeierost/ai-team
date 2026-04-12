import { describe, it, expect, afterEach } from 'vitest';
import { matchesPattern, matchInSet, clearMatcherCache } from './glob-engine.js';
import { applyOrderedTokens, collectDenyPatterns, removeMatchingPatterns } from './glob-engine.js';
import type { PatternToken } from './types.js';

afterEach(() => clearMatcherCache());

describe('matchesPattern', () => {
  it('matches simple glob *.ts against basename-only path', () => {
    expect(matchesPattern('index.ts', '*.ts')).toBe(true);
    expect(matchesPattern('index.js', '*.ts')).toBe(false);
  });

  it('matches deep path with ** prefix normalisation', () => {
    // *.ts without / gets **/ prepend → should match at any depth
    expect(matchesPattern('src/web/index.ts', '*.ts')).toBe(true);
    expect(matchesPattern('deep/nested/dir/file.ts', '*.ts')).toBe(true);
  });

  it('pattern with / is left as-is', () => {
    expect(matchesPattern('src/web/index.ts', 'src/web/**')).toBe(true);
    expect(matchesPattern('other/index.ts', 'src/web/**')).toBe(false);
  });

  it('matches dotfiles when dot option is on', () => {
    expect(matchesPattern('.env', '*.env')).toBe(true);
    expect(matchesPattern('.env', '.env')).toBe(true);
  });

  it('handles exact filename matches', () => {
    expect(matchesPattern('package.json', 'package.json')).toBe(true);
    expect(matchesPattern('src/package.json', 'package.json')).toBe(true);
  });
});

describe('matchInSet', () => {
  const files = new Set([
    'src/web/index.ts',
    'src/web/styles.css',
    'src/app/main.ts',
    'docs/readme.md',
  ]);

  it('filters files by glob pattern', () => {
    const result = matchInSet(files, '*.ts');
    expect(result).toEqual(new Set(['src/web/index.ts', 'src/app/main.ts']));
  });

  it('matches directory-scoped pattern', () => {
    const result = matchInSet(files, 'src/web/**');
    expect(result).toEqual(new Set(['src/web/index.ts', 'src/web/styles.css']));
  });

  it('returns empty set for non-matching pattern', () => {
    expect(matchInSet(files, '*.yml').size).toBe(0);
  });
});

describe('applyOrderedTokens', () => {
  const globalFiles = new Set([
    'src/a.ts',
    'src/b.json',
    'docs/readme.md',
    'docs/notes.yml',
  ]);

  it('adds allow tokens from global files', () => {
    const tokens: PatternToken[] = [
      { raw: 'src/**', kind: 'allow', pattern: 'src/**' },
    ];
    const result = applyOrderedTokens(new Set(), tokens, globalFiles);
    expect(result).toEqual(new Set(['src/a.ts', 'src/b.json']));
  });

  it('deny token removes from running set', () => {
    const tokens: PatternToken[] = [
      { raw: 'src/**', kind: 'allow', pattern: 'src/**' },
      { raw: '!*.json', kind: 'deny', pattern: '*.json' },
    ];
    const result = applyOrderedTokens(new Set(), tokens, globalFiles);
    expect(result).toEqual(new Set(['src/a.ts']));
  });

  it('inherit first-token is no-op (start already seeded)', () => {
    const tokens: PatternToken[] = [
      { raw: '*', kind: 'inherit' },
      { raw: '!*.yml', kind: 'deny', pattern: '*.yml' },
    ];
    const start = new Set(['docs/readme.md', 'docs/notes.yml']);
    const result = applyOrderedTokens(start, tokens, globalFiles);
    expect(result).toEqual(new Set(['docs/readme.md']));
  });

  it('bypass token uses filesystem files', () => {
    const fsFiles = new Set([...globalFiles, 'dist/output.js']);
    const tokens: PatternToken[] = [
      { raw: '+dist/**', kind: 'allow', pattern: 'dist/**', bypass: true },
    ];
    const result = applyOrderedTokens(new Set(), tokens, globalFiles, fsFiles);
    expect(result).toEqual(new Set(['dist/output.js']));
  });
});

describe('collectDenyPatterns', () => {
  it('collects only deny patterns', () => {
    const tokens: PatternToken[] = [
      { raw: 'src/**', kind: 'allow', pattern: 'src/**' },
      { raw: '!*.json', kind: 'deny', pattern: '*.json' },
      { raw: '!*.yml', kind: 'deny', pattern: '*.yml' },
    ];
    expect(collectDenyPatterns(tokens)).toEqual(['*.json', '*.yml']);
  });

  it('returns empty for no denies', () => {
    const tokens: PatternToken[] = [
      { raw: 'src/**', kind: 'allow', pattern: 'src/**' },
    ];
    expect(collectDenyPatterns(tokens)).toEqual([]);
  });
});

describe('removeMatchingPatterns', () => {
  it('removes matching files', () => {
    const files = new Set(['a.ts', 'b.json', 'c.yml']);
    const result = removeMatchingPatterns(files, ['*.json']);
    expect(result).toEqual(new Set(['a.ts', 'c.yml']));
  });

  it('returns original set when no deny patterns', () => {
    const files = new Set(['a.ts', 'b.json']);
    const result = removeMatchingPatterns(files, []);
    expect(result).toBe(files); // same reference
  });

  it('applies multiple deny patterns', () => {
    const files = new Set(['a.ts', 'b.json', 'c.yml', 'd.md']);
    const result = removeMatchingPatterns(files, ['*.json', '*.yml']);
    expect(result).toEqual(new Set(['a.ts', 'd.md']));
  });
});
