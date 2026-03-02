import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface SystemInfo {
  workspace: string;
  branch: string | null;
  package: {
    name: string | null;
    version: string | null;
    description: string | null;
  } | null;
}

/**
 * Get system information for the current workspace
 * 
 * @param workspaceRoot - Workspace root directory
 * @returns System info including workspace path, git branch, and package.json details
 */
export function getSystemInfo(workspaceRoot: string): SystemInfo {
  // Get current git branch
  let branch: string | null = null;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    // Not a git repo or git not available
  }

  // Read package.json
  let packageInfo: SystemInfo['package'] = null;
  try {
    const packageJsonPath = join(workspaceRoot, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageData = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      packageInfo = {
        name: packageData.name || null,
        version: packageData.version || null,
        description: packageData.description || null
      };
    }
  } catch (error) {
    // Package.json not found or invalid
  }

  return {
    workspace: workspaceRoot,
    branch,
    package: packageInfo
  };
}
