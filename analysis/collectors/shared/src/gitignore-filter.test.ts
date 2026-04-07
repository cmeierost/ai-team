import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPathFilter } from './gitignore-filter.js';

describe('buildPathFilter', () => {
  const tmpRoot = join(tmpdir(), 'gitignore-filter-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(tmpRoot, { recursive: true });
    // Create a .gitignore
    writeFileSync(
      join(tmpRoot, '.gitignore'),
      ['node_modules/', 'dist/', '*.log', '.env', 'coverage/'].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('filters node_modules paths', () => {
    const filter = buildPathFilter(tmpRoot);
    expect(filter.isIgnored('node_modules/foo/bar.js')).toBe(true);
    expect(filter.isIgnored('packages/core/node_modules/x.js')).toBe(true);
  });

  it('filters dist paths', () => {
    const filter = buildPathFilter(tmpRoot);
    expect(filter.isIgnored('dist/index.js')).toBe(true);
    expect(filter.isIgnored('packages/core/dist/index.js')).toBe(true);
  });

  it('filters gitignore patterns', () => {
    const filter = buildPathFilter(tmpRoot);
    expect(filter.isIgnored('debug.log')).toBe(true);
    expect(filter.isIgnored('.env')).toBe(true);
    expect(filter.isIgnored('coverage/lcov.info')).toBe(true);
  });

  it('allows source files', () => {
    const filter = buildPathFilter(tmpRoot);
    expect(filter.isIgnored('src/index.ts')).toBe(false);
    expect(filter.isIgnored('packages/core/src/agent.ts')).toBe(false);
  });

  it('filters bare names (Node builtins)', () => {
    const filter = buildPathFilter(tmpRoot);
    expect(filter.isIgnored('path')).toBe(true);
    expect(filter.isIgnored('fs')).toBe(true);
    expect(filter.isIgnored('stream')).toBe(true);
  });

  it('filters paths outside rootDir', () => {
    const filter = buildPathFilter(tmpRoot);
    expect(filter.isIgnored('../something/file.ts')).toBe(true);
  });

  it('normalizes backslash paths', () => {
    const filter = buildPathFilter(tmpRoot);
    expect(filter.isIgnored('node_modules\\foo\\bar.js')).toBe(true);
    expect(filter.isIgnored('src\\index.ts')).toBe(false);
  });

  it('filter() returns only allowed paths', () => {
    const filter = buildPathFilter(tmpRoot);
    const paths = [
      'src/index.ts',
      'node_modules/foo.js',
      'dist/bundle.js',
      'packages/core/src/agent.ts',
    ];
    const result = filter.filter(paths);
    expect(result).toEqual(['src/index.ts', 'packages/core/src/agent.ts']);
  });

  it('handles missing .gitignore gracefully', () => {
    const emptyDir = join(tmpRoot, 'no-gitignore');
    mkdirSync(emptyDir, { recursive: true });
    const filter = buildPathFilter(emptyDir);
    // Default exclusions still work
    expect(filter.isIgnored('node_modules/foo.js')).toBe(true);
    expect(filter.isIgnored('src/index.ts')).toBe(false);
  });
});
