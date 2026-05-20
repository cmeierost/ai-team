import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupWorkspaces,
  createWorkspace,
  ctx,
  makeTreeAgent,
  setupManager,
  toolPayload,
} from './__test-utils__/fs-tool-harness.js';

afterEach(async () => {
  await cleanupWorkspaces();
});

describe('fs_tree with subtree-only access', () => {
  it('returns accessible subtree files when called from root without root-level list access', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const x = 1;', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'readme.md'), '# Docs', 'utf8');

    const a = makeTreeAgent('subtree-a', ['src/**']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(a, 'fs_tree', { path: '.' }, ctx(a, workspaceRoot));
    expect(result.ok).toBe(true);

    const payload = toolPayload(result);
    expect(payload.access.allowed).toBe(true);
    expect(payload.tree).not.toBeNull();
    expect(payload.tree.children?.find((c: any) => c.name === 'src')).toBeTruthy();
    expect(payload.tree.children?.find((c: any) => c.name === 'docs')).toBeFalsy();
  });

  it('returns null tree when agent has no accessible files', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const x = 1;', 'utf8');

    const a = makeTreeAgent('no-access', ['__deny_all__']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(a, 'fs_tree', { path: '.' }, ctx(a, workspaceRoot));
    expect(result.ok).toBe(true);

    const payload = toolPayload(result);
    expect(payload.tree).toBeNull();
    expect(payload.access.allowed).toBe(false);
  });
});

describe('fs_list with subtree-only access', () => {
  it('lists only accessible entries when listing root without root-level list access', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'allowed-dir'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'blocked-dir'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'allowed-dir', 'a.ts'), 'x', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'blocked-dir', 'b.ts'), 'y', 'utf8');

    const a = makeTreeAgent('list-subtree', ['allowed-dir/**']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(a, 'fs_list', { path: '.' }, ctx(a, workspaceRoot));
    expect(result.ok).toBe(true);

    const payload = toolPayload(result);
    expect(payload.entries.some((e: any) => e.name === 'allowed-dir')).toBe(true);
    expect(payload.entries.some((e: any) => e.name === 'blocked-dir')).toBe(false);
  });
});
