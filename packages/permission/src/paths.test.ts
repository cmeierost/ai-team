import { describe, it, expect, beforeEach } from 'vitest';
import { normalizePath, resolveAndNormalize, fileName } from './paths.js';

const ROOT = '/workspace/project';

describe('normalizePath', () => {
  it('strips workspace root prefix', () => {
    expect(normalizePath('/workspace/project/src/foo.ts', ROOT)).toBe('src/foo.ts');
  });

  it('handles Windows backslashes', () => {
    expect(normalizePath('C:\\workspace\\project\\src\\foo.ts', 'C:\\workspace\\project')).toBe(
      'src/foo.ts',
    );
  });

  it('handles trailing slash on root', () => {
    expect(normalizePath('/workspace/project/src/foo.ts', '/workspace/project/')).toBe(
      'src/foo.ts',
    );
  });

  it('collapses .. segments', () => {
    expect(normalizePath('/workspace/project/src/../docs/readme.md', ROOT)).toBe(
      'docs/readme.md',
    );
  });

  it('returns empty string for workspace root itself', () => {
    expect(normalizePath('/workspace/project', ROOT)).toBe('');
  });

  it('handles already-relative paths', () => {
    expect(normalizePath('src/foo.ts', ROOT)).toBe('src/foo.ts');
  });
});

describe('resolveAndNormalize', () => {
  it('resolves relative path against cwd', () => {
    expect(
      resolveAndNormalize('foo.ts', '/workspace/project/src', ROOT),
    ).toBe('src/foo.ts');
  });

  it('resolves absolute path directly', () => {
    expect(
      resolveAndNormalize('/workspace/project/docs/readme.md', '/workspace/project/src', ROOT),
    ).toBe('docs/readme.md');
  });

  it('resolves Windows absolute path', () => {
    expect(
      resolveAndNormalize(
        'C:\\workspace\\project\\src\\bar.ts',
        'C:\\workspace\\project',
        'C:\\workspace\\project',
      ),
    ).toBe('src/bar.ts');
  });

  it('resolves parent-relative path against cwd', () => {
    expect(
      resolveAndNormalize('../docs/readme.md', '/workspace/project/src', ROOT),
    ).toBe('docs/readme.md');
  });
});

describe('fileName', () => {
  it('extracts basename', () => {
    expect(fileName('src/foo.ts')).toBe('foo.ts');
  });

  it('handles root-level file', () => {
    expect(fileName('readme.md')).toBe('readme.md');
  });
});
