import { describe, it, expect, beforeEach } from 'vitest';
import { parsePermFile } from './parser.js';
import { resolveContext } from './resolver.js';
import { ContextRuntime } from './context-runtime.js';
import type { GlobalContext, ResolvedContext } from './types.js';

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

function registerCtx(
  runtime: ContextRuntime,
  id: string,
  content: string,
): ResolvedContext {
  const perm = parsePermFile(content, '');
  const resolved = resolveContext(perm, makeGlobal());
  runtime.register(id, resolved);
  return resolved;
}

describe('ContextRuntime — access checks', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerCtx(runtime, 'web', '[read]\nsrc/web/**\n\n[write]\nsrc/web/index.ts');
    registerCtx(runtime, 'docs', '[read]\ndocs/**');
  });

  it('canWrite returns true for writable file', () => {
    expect(runtime.canWrite('web', 'src/web/index.ts')).toBe(true);
  });

  it('canWrite returns false for read-only file', () => {
    expect(runtime.canWrite('web', 'src/web/app.tsx')).toBe(false);
  });

  it('canRead returns true for readable file', () => {
    expect(runtime.canRead('web', 'src/web/app.tsx')).toBe(true);
  });

  it('canRead returns false for unlisted file', () => {
    expect(runtime.canRead('web', 'docs/readme.md')).toBe(false);
  });

  it('canList returns true for listable file', () => {
    // web context has no [list] section, so list = global
    expect(runtime.canList('web', 'package.json')).toBe(true);
  });

  it('canList returns false for unknown context', () => {
    expect(runtime.canList('nonexistent', 'package.json')).toBe(false);
  });

  it('canRead returns false for unknown context', () => {
    expect(runtime.canRead('nonexistent', 'package.json')).toBe(false);
  });

  it('canWrite returns false for unknown context', () => {
    expect(runtime.canWrite('nonexistent', 'package.json')).toBe(false);
  });
});

describe('ContextRuntime — listing', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerCtx(runtime, 'web', '[read]\nsrc/web/**\n\n[write]\nsrc/web/index.ts');
    registerCtx(runtime, 'docs', '[read]\ndocs/**');
  });

  it('listWritable returns only writable files', () => {
    expect(runtime.listWritable('web')).toEqual(['src/web/index.ts']);
  });

  it('listReadable includes writable files (downward closure)', () => {
    const readable = runtime.listReadable('web');
    expect(readable).toContain('src/web/index.ts');
    expect(readable).toContain('src/web/app.tsx');
    expect(readable).toContain('src/web/styles.css');
  });

  it('listListable returns all listable files', () => {
    const listable = runtime.listListable('web');
    expect(listable.length).toBeGreaterThan(0);
    expect(listable).toContain('package.json');
  });

  it('list functions return empty for unknown context', () => {
    expect(runtime.listWritable('nonexistent')).toEqual([]);
    expect(runtime.listReadable('nonexistent')).toEqual([]);
    expect(runtime.listListable('nonexistent')).toEqual([]);
  });
});

describe('ContextRuntime — reverse lookups', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerCtx(runtime, 'web', '[read]\nsrc/web/**\n\n[write]\nsrc/web/index.ts');
    registerCtx(runtime, 'docs', '[read]\ndocs/**');
    registerCtx(runtime, 'all-src', '[read]\nsrc/**');
  });

  it('contextsThatCanRead returns correct contexts', () => {
    const ctxs = runtime.contextsThatCanRead('src/web/index.ts');
    expect(ctxs).toContain('web');
    expect(ctxs).toContain('all-src');
    expect(ctxs).not.toContain('docs');
  });

  it('contextsThatCanWrite returns only write-capable contexts', () => {
    const ctxs = runtime.contextsThatCanWrite('src/web/index.ts');
    expect(ctxs).toContain('web');
    expect(ctxs).not.toContain('all-src');
  });

  it('contextsThatCanList returns contexts that list the file', () => {
    // All contexts without [list] sections have list = global
    const ctxs = runtime.contextsThatCanList('package.json');
    expect(ctxs).toContain('web');
    expect(ctxs).toContain('docs');
    expect(ctxs).toContain('all-src');
  });

  it('returns empty for file in no context', () => {
    expect(runtime.contextsThatCanRead('unknown/file.txt')).toEqual([]);
    expect(runtime.contextsThatCanWrite('unknown/file.txt')).toEqual([]);
  });
});

describe('ContextRuntime — register/unregister', () => {
  it('unregister removes context and cleans reverse index', () => {
    const runtime = new ContextRuntime();
    registerCtx(runtime, 'web', '[read]\nsrc/web/**');
    expect(runtime.contextsThatCanRead('src/web/index.ts')).toContain('web');

    runtime.unregister('web');
    expect(runtime.contextsThatCanRead('src/web/index.ts')).not.toContain('web');
    expect(runtime.getResolved('web')).toBeUndefined();
  });

  it('re-registering same ID replaces old context', () => {
    const runtime = new ContextRuntime();
    registerCtx(runtime, 'ctx', '[read]\ndocs/**');
    expect(runtime.canRead('ctx', 'docs/readme.md')).toBe(true);
    expect(runtime.canRead('ctx', 'src/web/index.ts')).toBe(false);

    registerCtx(runtime, 'ctx', '[read]\nsrc/web/**');
    expect(runtime.canRead('ctx', 'docs/readme.md')).toBe(false);
    expect(runtime.canRead('ctx', 'src/web/index.ts')).toBe(true);
  });

  it('unregister of nonexistent context is safe', () => {
    const runtime = new ContextRuntime();
    expect(() => runtime.unregister('nope')).not.toThrow();
  });
});

describe('ContextRuntime — searchByFilenameGlob', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerCtx(runtime, 'web', '[read]\nsrc/web/**');
  });

  it('finds files by extension glob', () => {
    const result = runtime.searchByFilenameGlob('web', '*.ts', 'read');
    expect(result).toContain('src/web/index.ts');
    expect(result).not.toContain('src/web/styles.css');
  });

  it('returns empty for unknown context', () => {
    expect(runtime.searchByFilenameGlob('nonexistent', '*.ts')).toEqual([]);
  });

  it('finds by exact basename (no globs)', () => {
    const result = runtime.searchByFilenameGlob('web', 'index.ts', 'read');
    expect(result).toContain('src/web/index.ts');
  });
});

describe('ContextRuntime — matrix and tree', () => {
  let runtime: ContextRuntime;

  beforeEach(() => {
    runtime = new ContextRuntime();
    registerCtx(runtime, 'web', '[read]\nsrc/web/**\n\n[write]\nsrc/web/index.ts');
    registerCtx(runtime, 'docs', '[read]\ndocs/**');
  });

  it('listFilesWithRightsByContext returns rows with rights', () => {
    const rows = runtime.listFilesWithRightsByContext('read');
    expect(rows.length).toBeGreaterThan(0);

    const webIndex = rows.find((r) => r.path === 'src/web/index.ts');
    expect(webIndex).toBeDefined();

    const webCtxRights = webIndex!.rights.find((r) => r.contextId === 'web');
    expect(webCtxRights?.canRead).toBe(true);
    expect(webCtxRights?.canWrite).toBe(true);

    const docsCtxRights = webIndex!.rights.find((r) => r.contextId === 'docs');
    expect(docsCtxRights?.canRead).toBe(false);
  });

  it('getContextRightsFileTree builds hierarchical tree', () => {
    const tree = runtime.getContextRightsFileTree();
    expect(tree.length).toBeGreaterThan(0);

    // Find the src dir
    const srcDir = tree.find((n) => n.name === 'src');
    expect(srcDir?.type).toBe('dir');
    expect(srcDir?.children?.length).toBeGreaterThan(0);
  });

  it('getContextRightsFileTree can filter by root', () => {
    const tree = runtime.getContextRightsFileTree({ root: 'docs/' });
    // All leaf files in the tree should be under docs/
    const leafFiles: string[] = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.type === 'file') leafFiles.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    expect(leafFiles.length).toBeGreaterThan(0);
    for (const f of leafFiles) {
      expect(f.startsWith('docs/')).toBe(true);
    }
  });

  it('getContextRightsFileTree includes rights by default', () => {
    const tree = runtime.getContextRightsFileTree();
    const flatFiles: typeof tree = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.type === 'file') flatFiles.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    expect(flatFiles.length).toBeGreaterThan(0);
    expect(flatFiles[0].rightsByContext).toBeDefined();
    expect(flatFiles[0].rightsByContext!.length).toBe(2); // web + docs
  });

  it('getContextRightsFileTree respects includeRights=false', () => {
    const tree = runtime.getContextRightsFileTree({ includeRights: false });
    const flatFiles: typeof tree = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.type === 'file') flatFiles.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    expect(flatFiles[0].rightsByContext).toBeUndefined();
  });
});

describe('ContextRuntime — allContexts / getResolved', () => {
  it('getResolved returns the stored context', () => {
    const runtime = new ContextRuntime();
    const resolved = registerCtx(runtime, 'web', '[read]\nsrc/web/**');
    expect(runtime.getResolved('web')).toBe(resolved);
  });

  it('allContexts returns a snapshot', () => {
    const runtime = new ContextRuntime();
    registerCtx(runtime, 'web', '[read]\nsrc/web/**');
    registerCtx(runtime, 'docs', '[read]\ndocs/**');
    const all = runtime.allContexts();
    expect(all.size).toBe(2);
    expect(all.has('web')).toBe(true);
    expect(all.has('docs')).toBe(true);
  });
});
