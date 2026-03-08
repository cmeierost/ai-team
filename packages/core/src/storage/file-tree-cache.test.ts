import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeFileTreeCache, listCachedWorkspaceFiles } from './file-tree-cache.js';

const createdDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-file-tree-cache-'));
  createdDirs.push(dir);
  return dir;
}

async function writeFile(root: string, relativePath: string, content = 'x'): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf-8');
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

afterEach(async () => {
  await disposeFileTreeCache();
  await Promise.all(
    createdDirs.splice(0, createdDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('file-tree-cache', () => {
  it('invalidates cached workspace file lists when files are added', async () => {
    const workspaceRoot = await createWorkspace();

    await writeFile(workspaceRoot, 'src/a.ts');

    const first = await listCachedWorkspaceFiles(workspaceRoot, {
      maxDepth: 10,
      filesOnly: true,
    });

    expect(first.map((entry) => entry.relativePath)).toContain('src/a.ts');
    expect(first.map((entry) => entry.relativePath)).not.toContain('src/b.ts');

    await writeFile(workspaceRoot, 'src/b.ts');

    await waitFor(async () => {
      const updated = await listCachedWorkspaceFiles(workspaceRoot, {
        maxDepth: 10,
        filesOnly: true,
      });
      return updated.some((entry) => entry.relativePath === 'src/b.ts');
    });
  });

  it('does not invalidate cache for gitignored file changes', async () => {
    const workspaceRoot = await createWorkspace();

    await writeFile(workspaceRoot, '.gitignore', 'dist/\n');
    await writeFile(workspaceRoot, 'src/a.ts');

    const first = await listCachedWorkspaceFiles(workspaceRoot, {
      maxDepth: 10,
      filesOnly: true,
    });

    expect(first.some((entry) => entry.relativePath === 'dist/ignored.ts')).toBe(false);

    await writeFile(workspaceRoot, 'dist/ignored.ts');

    // Give chokidar time to process events if they were not ignored.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const second = await listCachedWorkspaceFiles(workspaceRoot, {
      maxDepth: 10,
      filesOnly: true,
    });

    expect(second).toBe(first);
    expect(second.some((entry) => entry.relativePath === 'dist/ignored.ts')).toBe(false);
  });
});
