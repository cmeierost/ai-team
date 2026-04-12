/**
 * File read/write timing and write-lock system — mirrors OpenCode's file/time.ts.
 *
 * All tools that overwrite existing files should run their
 * assert/read/write/update sequence inside withLock(filepath, ...)
 * so concurrent writes to the same file are serialized.
 */
import fs from 'node:fs/promises';

export namespace FileTime {
  // Per-session recorded read times.
  const readTimes = new Map<string, Map<string, Date>>();

  // Per-file write locks (Promise-chaining mutex).
  const locks = new Map<string, Promise<void>>();

  function sessionMap(sessionId: string): Map<string, Date> {
    let m = readTimes.get(sessionId);
    if (!m) {
      m = new Map();
      readTimes.set(sessionId, m);
    }
    return m;
  }

  /**
   * Record that `sessionId` just read `filePath`.
   * Call this inside `fs_read` after a successful file read.
   */
  export function record(sessionId: string, filePath: string): void {
    sessionMap(sessionId).set(filePath, new Date());
  }

  /**
   * Return the last recorded read time for the given session + path,
   * or undefined if the file was never read in this session.
   */
  export function get(sessionId: string, filePath: string): Date | undefined {
    return sessionMap(sessionId).get(filePath);
  }

  /**
   * Serialize concurrent writes to the same file.
   * Any tool that modifies a file should wrap its write logic in this call.
   */
  export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = locks.get(filePath) ?? Promise.resolve();

    let release: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Chain: the new slot becomes available after currentLock resolves
    const chained = currentLock.then(() => nextLock);
    locks.set(filePath, chained);

    // Wait for our turn
    await currentLock;

    try {
      return await fn();
    } finally {
      release();
      // Clean up the map entry if no one else is waiting on this file
      if (locks.get(filePath) === chained) {
        locks.delete(filePath);
      }
    }
  }

  /**
   * Assert that `filePath` has not been modified externally since the last time
   * `sessionId` read it.
   *
   * - Throws if the file was never read in this session (force a fresh read first).
   * - Throws if the file's mtime is > last read time + 50ms (NTFS fuzziness tolerance).
   */
  export async function assert(sessionId: string, filePath: string): Promise<void> {
    const time = get(sessionId, filePath);
    if (!time) {
      throw new Error(`You must read ${filePath} before modifying it. Use the fs_read tool first.`);
    }

    let mtime: Date | undefined;
    try {
      const stat = await fs.stat(filePath);
      mtime = stat.mtime;
    } catch {
      // file might not exist yet — skip the check
    }

    if (mtime && mtime.getTime() > time.getTime() + 50) {
      throw new Error(
        `File ${filePath} was modified externally since it was last read.\n` +
          `Last read: ${time.toISOString()}\n` +
          `Last modified: ${mtime.toISOString()}\n` +
          `Read the file again before modifying it.`
      );
    }
  }
}
