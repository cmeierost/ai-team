import { describe, it, expect, beforeEach } from 'vitest';
import { parsePermFile } from './parser.js';
import { resolveContext } from './resolver.js';
import { ContextRuntime } from './context-runtime.js';
import type { GlobalContext } from './types.js';

function makeGlobal(): GlobalContext {
  return {
    files: new Set([
      'docs/readme.md',
      'docs/guide.md',
      'docs/api.json',
      'src/web/index.ts',
      'src/web/app.tsx',
      'src/web/styles.css',
      'src/app/main.ts',
      'src/app/data.json',
      'src/app/utils.ts',
      'package.json',
    ]),
  };
}

function registerContext(runtime: ContextRuntime, id: string, content: string) {
  const global = makeGlobal();
  const perm = parsePermFile(content, '');
  const resolved = resolveContext(perm, global);
  runtime.register(id, resolved);
  return resolved;
}

describe('resolveFilesToContexts', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerContext(runtime, 'docs-ctx', '[read]\ndocs/**');
    registerContext(runtime, 'web-ctx', '[read]\nsrc/web/**');
    registerContext(runtime, 'app-ctx', '[read]\nsrc/app/**');
  });

  it('maps files to their contexts at the given right', () => {
    const result = runtime.resolveFilesToContexts(
      ['docs/readme.md', 'src/web/index.ts', 'src/app/main.ts'],
      'read',
    );
    expect(result).toHaveLength(3);
    expect(result[0].contexts).toEqual(['docs-ctx']);
    expect(result[1].contexts).toEqual(['web-ctx']);
    expect(result[2].contexts).toEqual(['app-ctx']);
  });

  it('returns empty contexts array for uncovered files', () => {
    const result = runtime.resolveFilesToContexts(
      ['package.json', 'unknown/file.ts'],
      'read',
    );
    expect(result[0].contexts).toEqual([]);
    expect(result[1].contexts).toEqual([]);
  });

  it('returns multiple contexts when file is shared', () => {
    // Register an overlapping context
    registerContext(runtime, 'all-ctx', '[read]\nsrc/**');
    const result = runtime.resolveFilesToContexts(['src/web/index.ts'], 'read');
    expect(result[0].contexts).toContain('web-ctx');
    expect(result[0].contexts).toContain('all-ctx');
  });

  it('respects the right parameter', () => {
    // docs-ctx has read but not write on docs/**
    const readResult = runtime.resolveFilesToContexts(['docs/readme.md'], 'read');
    expect(readResult[0].contexts).toEqual(['docs-ctx']);

    const writeResult = runtime.resolveFilesToContexts(['docs/readme.md'], 'write');
    expect(writeResult[0].contexts).toEqual([]);
  });
});

describe('compareFilesToContext', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerContext(runtime, 'web-ctx', '[read]\nsrc/web/**');
  });

  it('splits files into covered/uncovered/extra', () => {
    const result = runtime.compareFilesToContext(
      ['src/web/index.ts', 'src/web/app.tsx', 'docs/readme.md'],
      'web-ctx',
      'read',
    );
    expect(result).toBeDefined();
    expect(result!.covered).toEqual(new Set(['src/web/index.ts', 'src/web/app.tsx']));
    expect(result!.uncovered).toEqual(new Set(['docs/readme.md']));
    // extra = files in context not in input
    expect(result!.extra.has('src/web/styles.css')).toBe(true);
    expect(result!.coverage).toBeCloseTo(2 / 3);
  });

  it('returns 100% coverage when all input files match', () => {
    const result = runtime.compareFilesToContext(
      ['src/web/index.ts', 'src/web/app.tsx', 'src/web/styles.css'],
      'web-ctx',
      'read',
    );
    expect(result!.coverage).toBe(1);
    expect(result!.uncovered.size).toBe(0);
  });

  it('returns 0% coverage when no files match', () => {
    const result = runtime.compareFilesToContext(
      ['docs/readme.md', 'package.json'],
      'web-ctx',
      'read',
    );
    expect(result!.coverage).toBe(0);
    expect(result!.uncovered.size).toBe(2);
  });

  it('returns undefined for unknown context', () => {
    const result = runtime.compareFilesToContext(['src/web/index.ts'], 'nonexistent', 'read');
    expect(result).toBeUndefined();
  });
});

describe('matchBestContexts', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerContext(runtime, 'docs-ctx', '[read]\ndocs/**');
    registerContext(runtime, 'web-ctx', '[read]\nsrc/web/**');
    registerContext(runtime, 'app-ctx', '[read]\nsrc/app/**');
  });

  it('ranks contexts by coverage descending', () => {
    const rankings = runtime.matchBestContexts(
      ['src/web/index.ts', 'src/web/app.tsx', 'docs/readme.md'],
      'read',
    );
    // web-ctx covers 2/3, docs-ctx covers 1/3, app-ctx covers 0/3
    expect(rankings[0].contextId).toBe('web-ctx');
    expect(rankings[0].coveredCount).toBe(2);
    expect(rankings[0].coverage).toBeCloseTo(2 / 3);
    expect(rankings[1].contextId).toBe('docs-ctx');
    expect(rankings[1].coveredCount).toBe(1);
    expect(rankings[2].contextId).toBe('app-ctx');
    expect(rankings[2].coveredCount).toBe(0);
  });

  it('returns uncovered files for each context', () => {
    const rankings = runtime.matchBestContexts(
      ['src/web/index.ts', 'docs/readme.md'],
      'read',
    );
    const webRank = rankings.find((r) => r.contextId === 'web-ctx')!;
    expect(webRank.uncovered).toEqual(new Set(['docs/readme.md']));
  });

  it('breaks coverage ties by preferring less extra files', () => {
    // Create two contexts with equal coverage on the input, but different sizes
    registerContext(runtime, 'small-ctx', '[read]\nsrc/web/index.ts');
    registerContext(runtime, 'big-ctx', '[read]\nsrc/**');
    const rankings = runtime.matchBestContexts(['src/web/index.ts'], 'read');
    // Both cover the single file (100%), but small-ctx has fewer extras
    const smallIdx = rankings.findIndex((r) => r.contextId === 'small-ctx');
    const bigIdx = rankings.findIndex((r) => r.contextId === 'big-ctx');
    expect(smallIdx).toBeLessThan(bigIdx);
  });

  it('handles empty file list gracefully', () => {
    const rankings = runtime.matchBestContexts([], 'read');
    expect(rankings).toHaveLength(3);
    for (const r of rankings) {
      expect(r.coverage).toBe(0);
      expect(r.coveredCount).toBe(0);
    }
  });
});

describe('contextsCoveringAll', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerContext(runtime, 'docs-ctx', '[read]\ndocs/**');
    registerContext(runtime, 'web-ctx', '[read]\nsrc/web/**');
    registerContext(runtime, 'full-src', '[read]\nsrc/**');
  });

  it('returns contexts that cover every input file', () => {
    const result = runtime.contextsCoveringAll(
      ['src/web/index.ts', 'src/web/app.tsx'],
      'read',
    );
    // Both web-ctx and full-src cover all src/web files
    expect(result).toContain('web-ctx');
    expect(result).toContain('full-src');
    expect(result).not.toContain('docs-ctx');
  });

  it('returns empty when one file is uncovered', () => {
    const result = runtime.contextsCoveringAll(
      ['src/web/index.ts', 'docs/readme.md'],
      'read',
    );
    // No single context covers both src/web and docs
    expect(result).toEqual([]);
  });

  it('returns empty when a file is in no context', () => {
    const result = runtime.contextsCoveringAll(
      ['package.json'],
      'read',
    );
    expect(result).toEqual([]);
  });

  it('returns all contexts for empty file list', () => {
    const result = runtime.contextsCoveringAll([], 'read');
    expect(result).toHaveLength(3);
  });

  it('respects right level', () => {
    // web-ctx has read but not write
    const readResult = runtime.contextsCoveringAll(['src/web/index.ts'], 'read');
    expect(readResult).toContain('web-ctx');

    const writeResult = runtime.contextsCoveringAll(['src/web/index.ts'], 'write');
    expect(writeResult).not.toContain('web-ctx');
  });
});

describe('contextsCoveringAny', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerContext(runtime, 'docs-ctx', '[read]\ndocs/**');
    registerContext(runtime, 'web-ctx', '[read]\nsrc/web/**');
    registerContext(runtime, 'full-src', '[read]\nsrc/**');
  });

  it('returns hit counts sorted descending', () => {
    const result = runtime.contextsCoveringAny(
      ['src/web/index.ts', 'src/app/main.ts', 'docs/readme.md'],
      'read',
    );
    // full-src covers 2 files, web-ctx covers 1, docs-ctx covers 1
    expect(result[0].contextId).toBe('full-src');
    expect(result[0].hitCount).toBe(2);
    expect(result[0].hitFiles).toContain('src/web/index.ts');
    expect(result[0].hitFiles).toContain('src/app/main.ts');
  });

  it('omits contexts with zero hits', () => {
    const result = runtime.contextsCoveringAny(['docs/readme.md'], 'read');
    const ids = result.map((r) => r.contextId);
    expect(ids).toContain('docs-ctx');
    expect(ids).not.toContain('web-ctx');
    expect(ids).not.toContain('full-src');
  });

  it('returns empty for completely uncovered files', () => {
    const result = runtime.contextsCoveringAny(['unknown/thing.txt'], 'read');
    expect(result).toEqual([]);
  });

  it('returns hitFiles for each context', () => {
    const result = runtime.contextsCoveringAny(
      ['src/web/index.ts', 'docs/readme.md'],
      'read',
    );
    const webHit = result.find((r) => r.contextId === 'web-ctx');
    expect(webHit).toBeDefined();
    expect(webHit!.hitFiles).toEqual(['src/web/index.ts']);
  });
});
