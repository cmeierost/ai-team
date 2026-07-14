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
  const maxDepth = 20;
  let depth = 0;

  while (depth < maxDepth) {
    const gitDir = join(currentDir, '.git');
    if (existsSync(gitDir)) {
      return currentDir;
    }

    const aiTeamDir = join(currentDir, '.ai-team');
    if (existsSync(aiTeamDir)) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
    depth++;
  }

  console.warn(`Warning: Could not find .ai-team or .git directory. Using: ${startDir}`);
  return startDir;
}
