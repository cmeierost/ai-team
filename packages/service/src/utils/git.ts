import { execSync } from 'child_process';

export function getGitUserName(): string | undefined {
  try {
    return execSync('git config user.name', { encoding: 'utf-8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}
