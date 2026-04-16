/**
 * Cross-platform executable lookup with per-process caching.
 *
 * Uses `where` on Windows and `which` on Unix to locate a command.
 * Results are cached for the lifetime of the process — formatter
 * availability doesn't change during a session.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);
const cache = new Map<string, string | null>();

/**
 * Locate an executable by name. Returns the absolute path or `null`.
 *
 * Cached per process lifetime — calling `which('prettier')` twice
 * returns the same result without spawning a second process.
 */
export async function which(cmd: string): Promise<string | null> {
  const cached = cache.get(cmd);
  if (cached !== undefined) return cached;

  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = (await execFileAsync(command, [cmd], {
      encoding: 'utf8',
      timeout: 5_000,
    })) as { stdout: string; stderr: string };
    // `where` on Windows may return multiple lines — take the first.
    const first = stdout.trim().split(/\r?\n/)[0]?.trim() || null;
    cache.set(cmd, first);
    return first;
  } catch {
    cache.set(cmd, null);
    return null;
  }
}

/** Clear the which-cache. Mainly useful for testing. */
export function clearWhichCache(): void {
  cache.clear();
}
