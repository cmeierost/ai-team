import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Find the workspace root by walking up the directory tree
 * looking for .ai-team or .git directory
 *
 * @param startDir - Starting directory (defaults to process.cwd())
 * @returns Absolute path to workspace root
 */
export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let currentDir = startDir;
  const maxDepth = 20; // Prevent infinite loops
  let depth = 0;

  while (depth < maxDepth) {
    // Check for .git directory first (most reliable indicator of project root)
    const gitDir = join(currentDir, '.git');
    if (existsSync(gitDir)) {
      return currentDir;
    }

    // Check for .ai-team directory as fallback (but could be nested)
    const aiTeamDir = join(currentDir, '.ai-team');
    if (existsSync(aiTeamDir)) {
      return currentDir;
    }

    // Move up one directory
    const parentDir = dirname(currentDir);

    // If we've reached the root, stop
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
    depth++;
  }

  // If nothing found, return the starting directory
  console.warn(`Warning: Could not find .ai-team or .git directory. Using: ${startDir}`);
  return startDir;
}

// ── Workspace overview ────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';

/**
 * Generate a lightweight workspace file tree (max depth 2, max 120 entries).
 * Used by the /overview slash command.
 */
export async function getWorkspaceOverview(workspaceRoot: string): Promise<string> {
  const ignoredDirs = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    '.next',
    '.turbo',
    '.pnpm-store',
  ]);
  const lines: string[] = [];
  const maxDepth = 2;
  const maxEntries = 120;
  let emitted = 0;

  async function walk(currentPath: string, relativePath: string, depth: number): Promise<void> {
    if (depth > maxDepth || emitted >= maxEntries) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      if (emitted >= maxEntries) break;
      if (entry.name.startsWith('.') && entry.name !== '.ai-team') continue;
      const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childAbs = `${currentPath}/${entry.name}`;
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        lines.push(`${'  '.repeat(depth)}- ${childRel}/`);
        emitted++;
        await walk(childAbs, childRel, depth + 1);
      } else {
        lines.push(`${'  '.repeat(depth)}- ${childRel}`);
        emitted++;
      }
    }
  }

  await walk(workspaceRoot, '', 0);
  return lines.join('\n');
}
