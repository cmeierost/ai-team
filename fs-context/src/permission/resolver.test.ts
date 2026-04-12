import { describe, it, expect } from 'vitest';
import { parsePermFile } from './parser.js';
import { resolveContext } from './resolver.js';
import type { GlobalContext } from './types.js';

/**
 * Mock global context: a workspace with a known set of files.
 * Covers docs, src/web, src/app, and root-level files.
 */
function makeGlobal(extra?: string[]): GlobalContext {
  const files = new Set([
    'docs/readme.md',
    'docs/guide.md',
    'docs/api.json',
    'docs/notes.yml',
    'src/web/index.ts',
    'src/web/app.tsx',
    'src/web/styles.css',
    'src/web/config.yml',
    'src/app/main.ts',
    'src/app/data.json',
    'src/app/utils.ts',
    'README.md',
    'package.json',
    ...(extra ?? []),
  ]);
  return { files };
}

/** Convenience: parse + resolve, all baseDirs empty (root-relative patterns). */
function resolve(content: string, globalCtx?: GlobalContext, fs?: Set<string>) {
  const perm = parsePermFile(content, '');
  return resolveContext(perm, globalCtx ?? makeGlobal(), fs);
}

describe('resolver — 15 canonical cases', () => {
  // ─── Case 1: Empty file ────────────────────────────────────────────
  it('case 1 — empty file: list=global, read=∅, write=∅', () => {
    const r = resolve('');
    const g = makeGlobal();
    expect(r.list).toEqual(g.files);
    expect(r.read.size).toBe(0);
    expect(r.write.size).toBe(0);
  });

  // ─── Case 2: Only implicit patterns ────────────────────────────────
  it('case 2 — implicit patterns narrow list', () => {
    const r = resolve('docs/**');
    expect(r.list).toEqual(new Set([
      'docs/readme.md', 'docs/guide.md', 'docs/api.json', 'docs/notes.yml',
    ]));
    expect(r.read.size).toBe(0);
    expect(r.write.size).toBe(0);
  });

  // ─── Case 3: Only [read] ──────────────────────────────────────────
  it('case 3 — only [read]', () => {
    const r = resolve('[read]\nsrc/web/**');
    const g = makeGlobal();
    expect(r.list).toEqual(g.files); // no [list] section
    expect(r.read).toEqual(new Set([
      'src/web/index.ts', 'src/web/app.tsx', 'src/web/styles.css', 'src/web/config.yml',
    ]));
    expect(r.write.size).toBe(0);
  });

  // ─── Case 4: Only [write] ─────────────────────────────────────────
  it('case 4 — only [write] propagates to read', () => {
    const r = resolve('[write]\nsrc/web/**');
    const g = makeGlobal();
    const webFiles = new Set([
      'src/web/index.ts', 'src/web/app.tsx', 'src/web/styles.css', 'src/web/config.yml',
    ]);
    expect(r.list).toEqual(g.files);
    expect(r.read).toEqual(webFiles); // write propagates to read
    expect(r.write).toEqual(webFiles);
  });

  // ─── Case 5: Implicit + [read] ────────────────────────────────────
  it('case 5 — implicit + [read]', () => {
    const r = resolve('docs/**\n\n[read]\nsrc/web/**');
    const docFiles = ['docs/readme.md', 'docs/guide.md', 'docs/api.json', 'docs/notes.yml'];
    const webFiles = ['src/web/index.ts', 'src/web/app.tsx', 'src/web/styles.css', 'src/web/config.yml'];
    expect(r.list).toEqual(new Set([...docFiles, ...webFiles]));
    expect(r.read).toEqual(new Set(webFiles));
    expect(r.write.size).toBe(0);
  });

  // ─── Case 6: Implicit + [write] ────────────────────────────────────
  it('case 6 — implicit + [write]', () => {
    const r = resolve('docs/**\n\n[write]\nsrc/web/**');
    const docFiles = ['docs/readme.md', 'docs/guide.md', 'docs/api.json', 'docs/notes.yml'];
    const webFiles = ['src/web/index.ts', 'src/web/app.tsx', 'src/web/styles.css', 'src/web/config.yml'];
    expect(r.list).toEqual(new Set([...docFiles, ...webFiles]));
    expect(r.read).toEqual(new Set(webFiles));
    expect(r.write).toEqual(new Set(webFiles));
  });

  // ─── Case 7: Negative pattern in [read] ────────────────────────────
  it('case 7 — negative in [read] does not affect list', () => {
    const r = resolve('docs/**\n\n[read]\nsrc/web/**\n!*.yml');
    const docFiles = ['docs/readme.md', 'docs/guide.md', 'docs/api.json', 'docs/notes.yml'];
    const webFilesNoYml = ['src/web/index.ts', 'src/web/app.tsx', 'src/web/styles.css'];
    // list includes docs + all read positives (src/web/**) without yml removal
    expect(r.list).toEqual(new Set([...docFiles, ...webFilesNoYml]));
    expect(r.read).toEqual(new Set(webFilesNoYml));
    expect(r.write.size).toBe(0);
  });

  // ─── Case 8: Global ignore silently excludes ───────────────────────
  it('case 8 — global ignore silently excludes files', () => {
    // .env is not in global context
    const r = resolve('[read]\nsrc/web/**');
    expect(r.read.has('.env')).toBe(false);
  });

  // ─── Case 9: Explicit add to bypass global ignore (+) ─────────────
  it('case 9 — + prefix bypasses global ignore', () => {
    // dist/report/summary.txt is NOT in global context
    const fsFiles = new Set([
      ...makeGlobal().files,
      'dist/report/summary.txt',
    ]);
    const r = resolve('[read]\n+dist/report/**/*', makeGlobal(), fsFiles);
    expect(r.read).toEqual(new Set(['dist/report/summary.txt']));
    expect(r.list.has('dist/report/summary.txt')).toBe(true);
  });

  // ─── Case 10: Explicit [list] section ──────────────────────────────
  it('case 10 — [list] section equivalent to implicit', () => {
    const r = resolve('[list]\ndocs/**\n\n[write]\nsrc/web/**');
    const docFiles = ['docs/readme.md', 'docs/guide.md', 'docs/api.json', 'docs/notes.yml'];
    const webFiles = ['src/web/index.ts', 'src/web/app.tsx', 'src/web/styles.css', 'src/web/config.yml'];
    expect(r.list).toEqual(new Set([...docFiles, ...webFiles]));
    expect(r.read).toEqual(new Set(webFiles));
    expect(r.write).toEqual(new Set(webFiles));
  });

  // ─── Case 11: Negative in [read] with positive ────────────────────
  it('case 11 — negative in [read] does not remove from list', () => {
    const r = resolve('[read]\nsrc/web/**\n!*.md');
    const g = makeGlobal();
    // list = global (no [list] section), read positives propagate
    expect(r.list).toEqual(g.files);
    // read = src/web/** excluding .md
    expect(r.read).toEqual(new Set([
      'src/web/index.ts', 'src/web/app.tsx', 'src/web/styles.css', 'src/web/config.yml',
    ]));
    expect(r.write.size).toBe(0);
  });

  // ─── Case 12: Negative-first inheritance ───────────────────────────
  it('case 12 — negative-first in [write] inherits read', () => {
    const r = resolve('[read]\ndocs/**\n\n[write]\n!*.json');
    const docFiles = ['docs/readme.md', 'docs/guide.md', 'docs/api.json', 'docs/notes.yml'];
    const docFilesNoJson = ['docs/readme.md', 'docs/guide.md', 'docs/notes.yml'];
    expect(r.read).toEqual(new Set(docFiles));
    expect(r.write).toEqual(new Set(docFilesNoJson));
  });

  // ─── Case 13: Negative-first section with later positive ──────────
  it('case 13 — negative-first + later positive: ordered eval, json in src/app stays', () => {
    const r = resolve('[read]\ndocs/**\n\n[write]\n!*.json\nsrc/app/**');
    const docFiles = ['docs/readme.md', 'docs/guide.md', 'docs/api.json', 'docs/notes.yml'];
    const appFiles = ['src/app/main.ts', 'src/app/data.json', 'src/app/utils.ts'];
    // write: start from read (docs/**), remove *.json, then add src/app/**
    // Ordered eval: src/app/data.json is included because src/app/** was added AFTER !*.json
    const expectedWrite = new Set([
      'docs/readme.md', 'docs/guide.md', 'docs/notes.yml', // docs minus json
      'src/app/main.ts', 'src/app/data.json', 'src/app/utils.ts', // all app files
    ]);
    expect(r.write).toEqual(expectedWrite);
    // read includes write + read positives
    expect(r.read).toEqual(new Set([...docFiles, ...appFiles]));
    // list includes read
    expect(r.list.has('src/app/main.ts')).toBe(true);
  });

  // ─── Case 14: * in write equals negative-first ────────────────────
  it('case 14 — * sentinel equals negative-first', () => {
    // With [read] defined as docs/**, [write] * then !*.json
    const r1 = resolve('[read]\ndocs/**\n\n[write]\n*\n!*.json');
    const r2 = resolve('[read]\ndocs/**\n\n[write]\n!*.json');
    expect(r1.write).toEqual(r2.write);
  });

  // ─── Case 15: Ordered globs can re-add after exclusion ─────────────
  it('case 15 — ordered globs re-add after exclusion', () => {
    const r = resolve('[write]\nsrc/app/**\n!*.json\ndocs/**');
    // write: start empty, add src/app/**, remove *.json, add docs/**
    // src/app/data.json removed, but docs/api.json added back because docs/** comes after !*.json
    const expectedWrite = new Set([
      'src/app/main.ts', 'src/app/utils.ts', // app minus json
      'docs/readme.md', 'docs/guide.md', 'docs/api.json', 'docs/notes.yml', // all docs (re-added)
    ]);
    expect(r.write).toEqual(expectedWrite);
    // read includes write (downward closure)
    for (const f of expectedWrite) {
      expect(r.read.has(f)).toBe(true);
    }
    // list includes read
    for (const f of r.read) {
      expect(r.list.has(f)).toBe(true);
    }
  });
});

describe('resolver — cross-section negative propagation', () => {
  it('case 16 — negatives in [list] propagate to [read] and [write]', () => {
    // [list] excludes *.yml, so read and write shouldn't contain yml files
    const r = resolve(
      'docs/**\n!*.yml\n\n[read]\ndocs/**\n\n[write]\ndocs/**',
    );
    expect(r.list.has('docs/notes.yml')).toBe(false);
    // Cross-section propagation: list neg !*.yml applies to read and write
    expect(r.read.has('docs/notes.yml')).toBe(false);
    expect(r.write.has('docs/notes.yml')).toBe(false);
    // Non-yml files should be present
    expect(r.read.has('docs/readme.md')).toBe(true);
    expect(r.write.has('docs/readme.md')).toBe(true);
  });

  it('case 17 — negatives in [read] propagate to [write] but not to [list]', () => {
    const r = resolve(
      'docs/**\n\n[read]\ndocs/**\n!*.json\n\n[write]\ndocs/**',
    );
    // list should still have docs/api.json (negatives don't propagate down)
    expect(r.list.has('docs/api.json')).toBe(true);
    // read excludes json
    expect(r.read.has('docs/api.json')).toBe(false);
    // write should also exclude json (cross-section propagation from read)
    expect(r.write.has('docs/api.json')).toBe(false);
  });
});
