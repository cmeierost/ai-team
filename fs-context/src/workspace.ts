import fs from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Find the workspace root by walking up the directory tree
 * looking for .ai-team or .git directory
 *
 * @param startDir - Starting directory (defaults to process.cwd())
 * @returns Absolute path to workspace root
 */
export async function findWorkspaceRoot(startDir: string = process.cwd()): Promise<string> {
  let currentDir = startDir;
  const maxDepth = 20; // Prevent infinite loops
  let depth = 0;

  while (depth < maxDepth) {
    // Check for .ai-team directory first (most specific)
    const aiTeamDir = join(currentDir, '.ai-team');
    if (await pathExists(aiTeamDir)) {
      return currentDir;
    }

    // Check for .git directory (indicates git root)
    const gitDir = join(currentDir, '.git');
    if (await pathExists(gitDir)) {
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
