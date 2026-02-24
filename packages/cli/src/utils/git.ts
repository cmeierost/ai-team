import { execSync } from 'child_process';

/**
 * Read the user's name from local git config, if available.
 */
export function getGitUserName(): string | undefined {
  try {
    return execSync('git config user.name', { encoding: 'utf-8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}
