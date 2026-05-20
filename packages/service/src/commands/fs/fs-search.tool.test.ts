import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupWorkspaces,
  createWorkspace,
  ctx,
  makeSearchAgent,
  setupManager,
  toolPayload,
} from './__test-utils__/fs-tool-harness.js';

afterEach(async () => {
  await cleanupWorkspaces();
});

describe('fs_search_* access filtering', () => {
  it('searches broadly then filters fs_search_content matches via @ai-team/permission', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'allowed.ts'),
      'const token = "needle";',
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'docs', 'blocked.md'),
      'needle in blocked docs',
      'utf8'
    );

    const a = makeSearchAgent('a', ['src/**']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(
      a,
      'fs_search_content',
      { path: '.', query: 'needle' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = toolPayload(result);
    expect(payload.access.allowed).toBe(true);
    expect(payload.matches.some((m: { path: string }) => m.path.includes('src/allowed.ts'))).toBe(
      true
    );
    expect(payload.matches.some((m: { path: string }) => m.path.includes('docs/blocked.md'))).toBe(
      false
    );
  });

  it('filters fs_search_metadata matches via @ai-team/permission before returning', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src', 'needle-zone'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs', 'needle-zone'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'needle-zone', 'a.ts'), 'x', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'needle-zone', 'b.md'), 'x', 'utf8');

    const a = makeSearchAgent('a', ['src/**']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(
      a,
      'fs_search_metadata',
      { pattern: '**/needle-zone/**' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = toolPayload(result);
    expect(payload.access.allowed).toBe(true);
    expect(payload.matches.some((m: { path: string }) => m.path.startsWith('src/'))).toBe(true);
    expect(payload.matches.some((m: { path: string }) => m.path.startsWith('docs/'))).toBe(false);
  });
});

describe('fs_search_* with subtree-only access', () => {
  it('finds matches in accessible files when searching from root without root-level access', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'secret'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'const PORT = 290420;', 'utf8');
    await fs.writeFile(
      path.join(workspaceRoot, 'secret', 'config.ts'),
      'const PORT = 290420;',
      'utf8'
    );

    const a = makeSearchAgent('search-subtree', ['src/**']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(
      a,
      'fs_search_content',
      { path: '.', query: '290420' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = toolPayload(result);
    expect(payload.access.allowed).toBe(true);
    expect(payload.matches.some((m: any) => m.path === 'src/app.ts')).toBe(true);
    expect(payload.matches.some((m: any) => m.path === 'secret/config.ts')).toBe(false);
    expect(payload.denied).toBeGreaterThan(0);
  });

  it('reports denied files when no accessible files match the glob', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'private'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'private', 'hidden.ts'), 'y', 'utf8');

    const a = makeSearchAgent('meta-denied', ['src/**']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(
      a,
      'fs_search_metadata',
      { pattern: '**/*.ts' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = toolPayload(result);
    expect(payload.access.allowed).toBe(false);
    expect(payload.matches).toEqual([]);
    expect(payload.denied).toBeGreaterThan(0);
  });
});
