import { existsSync } from 'fs';
import { dirname, join } from 'path';

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
