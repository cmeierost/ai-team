import { execSync } from 'child_process';

export function getGitUserName(): string | undefined {
  try {
    return execSync('git config user.name', { encoding: 'utf-8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert developer name from git config (e.g., "Clemens Meier") to ID format (e.g., "clemens-meier").
 * Matches the agent ID format for consistency.
 */
export function developerNameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
