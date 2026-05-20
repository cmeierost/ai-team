import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupWorkspaces,
  createWorkspace,
  ctx,
  makeAgent,
  setupManager,
  toolPayload,
} from './__test-utils__/fs-tool-harness.js';

afterEach(async () => {
  await cleanupWorkspaces();
});

describe('fs_exists/fs_info tool execution', () => {
  it('returns access denied for fs_exists when agent lacks permission', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'readme.md'), '# docs', 'utf8');

    const a = makeAgent('a', ['src/**/*']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(
      a,
      'fs_exists',
      { path: 'docs/readme.md' },
      ctx(a, workspaceRoot)
    );

    expect(result.ok).toBe(true);
    const payload = toolPayload(result);
    expect(payload.exists).toBe(false);
    expect(payload.access.allowed).toBe(false);
  });

  it('returns metadata for allowed fs_info', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const x = 1;', 'utf8');

    const a = makeAgent('a', ['src/**/*']);
    const manager = await setupManager(workspaceRoot);

    const result = await manager.execute(
      a,
      'fs_info',
      { path: 'src/app.ts' },
      ctx(a, workspaceRoot)
    );

    expect(result.ok).toBe(true);
    const payload = toolPayload(result);
    expect(payload.exists).toBe(true);
    expect(payload.access.allowed).toBe(true);
    expect(payload.info).toBeTruthy();
    expect(payload.info.type).toBe('file');
    expect(typeof payload.info.size).toBe('number');
  });
});
