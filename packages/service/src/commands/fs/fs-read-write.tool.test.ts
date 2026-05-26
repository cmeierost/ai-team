import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupWorkspaces,
  createWorkspace,
  ctx,
  makeFullFsAgent,
  setupManager,
  toolPayload,
} from './__test-utils__/fs-tool-harness.js';

afterEach(async () => {
  await cleanupWorkspaces();
});

describe('remaining fs tool execution', () => {
  it('supports fs_read and fs_read_lines for allowed paths', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'file.txt'), 'line1\nline2\nline3', 'utf8');

    const a = makeFullFsAgent('a');
    const manager = await setupManager(workspaceRoot);

    const full = await manager.execute(
      a,
      'fs_read',
      { filePath: 'src/file.txt' },
      ctx(a, workspaceRoot)
    );
    const lines = await manager.execute(
      a,
      'fs_read_lines',
      { filePath: 'src/file.txt', startLine: 2, endLine: 3 },
      ctx(a, workspaceRoot)
    );

    expect(full.ok).toBe(true);
    const fullPayload = toolPayload(full);
    expect(fullPayload.content).toBe('line1\nline2\nline3');
    expect(fullPayload.startLine).toBe(1);
    expect(fullPayload.endLine).toBe(3);
    expect(fullPayload.isFullFile).toBe(true);

    expect(lines.ok).toBe(true);
    const linesPayload = toolPayload(lines);
    expect(linesPayload.content).toBe('line2\nline3');
    expect(linesPayload.startLine).toBe(2);
    expect(linesPayload.endLine).toBe(3);
    expect(linesPayload.isFullFile).toBe(false);
    expect(linesPayload.lines).toEqual(['line2', 'line3']);
  });

  it('supports fs_write_file, fs_create and fs_mkdir', async () => {
    const workspaceRoot = await createWorkspace();
    const a = makeFullFsAgent('a');
    const manager = await setupManager(workspaceRoot);

    const mkdir = await manager.execute(
      a,
      'fs_mkdir',
      { path: 'tmp/nested' },
      ctx(a, workspaceRoot)
    );
    const created = await manager.execute(
      a,
      'fs_create',
      { filePath: 'tmp/nested/new.txt', content: 'hello', createDirectories: true },
      ctx(a, workspaceRoot)
    );
    const written = await manager.execute(
      a,
      'fs_write_file',
      { filePath: 'tmp/nested/new.txt', content: 'updated' },
      ctx(a, workspaceRoot)
    );

    expect(mkdir.ok).toBe(true);
    expect(toolPayload(mkdir).created).toBe(true);
    expect(created.ok).toBe(true);
    expect(toolPayload(created).created).toBe(true);
    expect(written.ok).toBe(true);

    const writtenPayload = toolPayload(written);
    expect(writtenPayload.written).toBe(true);
    expect(writtenPayload._fileChanges).toHaveLength(1);

    const disk = await fs.readFile(path.join(workspaceRoot, 'tmp', 'nested', 'new.txt'), 'utf8');
    expect(disk).toBe('updated');
  });

  it('supports fs_list and fs_delete_path', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'tmp', 'dir'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'tmp', 'dir', 'a.txt'), 'a', 'utf8');

    const a = makeFullFsAgent('a');
    const manager = await setupManager(workspaceRoot);

    const listed = await manager.execute(a, 'fs_list', { path: 'tmp' }, ctx(a, workspaceRoot));
    expect(listed.ok).toBe(true);
    expect(toolPayload(listed).entries.some((e: { name: string }) => e.name === 'dir')).toBe(true);

    const deleted = await manager.execute(
      a,
      'fs_delete_path',
      { path: 'tmp/dir', recursive: true },
      ctx(a, workspaceRoot)
    );
    expect(deleted.ok).toBe(true);
    expect(toolPayload(deleted).deleted).toBe(true);
  });
});
