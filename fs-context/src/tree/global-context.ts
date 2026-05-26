import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import type { CheapFileMeta, FileIndex, GlobalContext } from '../permission/types.js';
import { normalizeWorkspaceRelativePath as toPosix } from '../paths.js';

async function walkDir(
  root: string,
  dir: string,
  ig: ReturnType<typeof ignore>,
  index: FileIndex
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const tasks: Promise<void>[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = toPosix(path.relative(root, fullPath));

    if (ig.ignores(relPath + (entry.isDirectory() ? '/' : ''))) continue;

    if (entry.isDirectory()) {
      tasks.push(walkDir(root, fullPath, ig, index));
      continue;
    }

    const ext = path.extname(entry.name);
    const fileType = entry.isSymbolicLink() ? ('symlink' as const) : ('file' as const);
    const meta: CheapFileMeta = {
      path: relPath,
      name: entry.name,
      ext,
      type: fileType,
    };

    index.byPath.set(relPath, meta);

    const dirKey = toPosix(path.dirname(relPath));
    const dirList = index.byDir.get(dirKey);
    if (dirList) dirList.push(relPath);
    else index.byDir.set(dirKey, [relPath]);

    if (ext) {
      const extList = index.byExt.get(ext);
      if (extList) extList.push(relPath);
      else index.byExt.set(ext, [relPath]);
    }

    const baseName = entry.name;
    const baseList = index.byBaseName.get(baseName);
    if (baseList) baseList.push(relPath);
    else index.byBaseName.set(baseName, [relPath]);
  }

  await Promise.all(tasks);
}

async function loadIgnorePatterns(workspaceRoot: string, ignoreFiles: string[]): Promise<string[]> {
  const patterns: string[] = [];
  for (const file of ignoreFiles) {
    const filePath = path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed);
        }
      }
    } catch {
      // Ignore missing files
    }
  }
  return patterns;
}

export function createEmptyFileIndex(): FileIndex {
  return {
    byPath: new Map(),
    byDir: new Map(),
    byExt: new Map(),
    byBaseName: new Map(),
  };
}

export async function buildGlobalContext(
  workspaceRoot: string,
  ignoreFiles: string[] = ['.gitignore']
): Promise<{ global: GlobalContext; index: FileIndex }> {
  const patterns = await loadIgnorePatterns(workspaceRoot, ignoreFiles);
  const ig = ignore().add(patterns);

  const index = createEmptyFileIndex();
  await walkDir(workspaceRoot, workspaceRoot, ig, index);

  const files = new Set(index.byPath.keys());

  return { global: { files }, index };
}
