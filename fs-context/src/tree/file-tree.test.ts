import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getFileTree, listWorkspaceFiles } from './file-tree.js';

const createdDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-file-tree-'));
  createdDirs.push(dir);
  return dir;
}

async function writeFile(root: string, relativePath: string, content = 'x'): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf-8');
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0, createdDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('file-tree', () => {
  it('rejects rootSubPath values outside the workspace root', async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(workspaceRoot, 'src/app.ts');

    await expect(getFileTree(workspaceRoot, { rootSubPath: '../outside' })).rejects.toThrow(
      'outside workspace root'
    );

    await expect(listWorkspaceFiles(workspaceRoot, { rootSubPath: '../outside' })).rejects.toThrow(
      'outside workspace root'
    );
  });

  it('returns deterministic flat ordering (dirs first, then relative path)', async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(workspaceRoot, 'b/2.txt');
    await writeFile(workspaceRoot, 'a/1.txt');
    await writeFile(workspaceRoot, 'z.md');
    await writeFile(workspaceRoot, 'a/z.ts');

    const first = await listWorkspaceFiles(workspaceRoot, { maxDepth: 10, includeHidden: false });
    const second = await listWorkspaceFiles(workspaceRoot, { maxDepth: 10, includeHidden: false });

    const firstOrder = first.map((entry) => `${entry.isDirectory ? 'd' : 'f'}:${entry.relativePath}`);
    const secondOrder = second.map((entry) => `${entry.isDirectory ? 'd' : 'f'}:${entry.relativePath}`);

    expect(secondOrder).toEqual(firstOrder);
    expect(firstOrder).toEqual([
      'd:a',
      'd:b',
      'f:a/1.txt',
      'f:a/z.ts',
      'f:b/2.txt',
      'f:z.md',
    ]);
  });
});
