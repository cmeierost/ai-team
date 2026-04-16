/**
 * File-system CRUD primitives — exists, info, create, write, delete, mkdir,
 * move, copy, rename, hash, temp, symlink.
 *
 * These are pure filesystem operations with no access-layer dependency.
 * The tool layer in @ai-team/core wraps them with access checks.
 */
import fs, { readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { safeStat } from './file-read.js';

const execFileAsync = promisify(execFileCb);

// ─── Exists ───────────────────────────────────────────────────────────────────

/** Check whether a path exists on disk. */
export async function existsPath(absolutePath: string): Promise<boolean> {
  return (await safeStat(absolutePath)) !== null;
}

// ─── Path info ────────────────────────────────────────────────────────────────

export interface PathInfo {
  type: 'file' | 'directory' | 'other';
  size: number;
  modifiedAt: string;
  createdAt: string;
}

/** Get metadata for a path, or null if it does not exist. */
export async function getPathInfo(absolutePath: string): Promise<PathInfo | null> {
  const stat = await safeStat(absolutePath);
  if (!stat) return null;
  return {
    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  };
}

// ─── Create (exclusive — fails if file already exists) ────────────────────────

export interface CreateFileResult {
  bytes: number;
}

/** Create a new file. Throws if file already exists (wx flag). */
export async function createFile(
  absolutePath: string,
  content: string,
  opts?: { createDirectories?: boolean }
): Promise<CreateFileResult> {
  if (opts?.createDirectories) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  }
  await fs.writeFile(absolutePath, content, { encoding: 'utf8', flag: 'wx' });
  return { bytes: Buffer.byteLength(content, 'utf8') };
}

// ─── Write (overwrite) ───────────────────────────────────────────────────────

export interface WriteFileResult {
  bytes: number;
}

/** Write content to a file, overwriting if it exists. */
export async function writeFile(absolutePath: string, content: string): Promise<WriteFileResult> {
  await fs.writeFile(absolutePath, content, 'utf8');
  return { bytes: Buffer.byteLength(content, 'utf8') };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/** Delete a file or directory. */
export async function deletePath(
  absolutePath: string,
  opts?: { recursive?: boolean }
): Promise<void> {
  await fs.rm(absolutePath, { recursive: opts?.recursive ?? true, force: false });
}

// ─── Mkdir ────────────────────────────────────────────────────────────────────

/** Create a directory. */
export async function createDirectory(
  absolutePath: string,
  opts?: { recursive?: boolean }
): Promise<void> {
  await fs.mkdir(absolutePath, { recursive: opts?.recursive ?? true });
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

/** Check whether a path is inside a git working tree. */
async function isInsideGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = (await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      timeout: 5_000,
    })) as { stdout: string; stderr: string };
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/** Run `git mv` and return true on success. */
async function gitMv(src: string, dest: string, cwd: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['mv', src, dest], { cwd, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Move ─────────────────────────────────────────────────────────────────────

export interface MoveResult {
  from: string;
  to: string;
  usedGit: boolean;
}

/**
 * Move (or rename) a file or directory.
 *
 * - Attempts `git mv` first when the source is inside a git repo.
 * - Falls back to `fs.rename` (same device) then copy-and-delete (cross device).
 * - Automatically creates destination directories when needed.
 */
export async function moveFile(
  absoluteSrc: string,
  absoluteDest: string,
  opts?: { createDirectories?: boolean }
): Promise<MoveResult> {
  const stat = await safeStat(absoluteSrc);
  if (!stat) throw new Error(`Source does not exist: ${absoluteSrc}`);

  if (opts?.createDirectories) {
    await fs.mkdir(path.dirname(absoluteDest), { recursive: true });
  }

  // Try git mv first
  const cwd = path.dirname(absoluteSrc);
  if (await isInsideGitRepo(cwd)) {
    if (await gitMv(absoluteSrc, absoluteDest, cwd)) {
      return { from: absoluteSrc, to: absoluteDest, usedGit: true };
    }
  }

  // Fallback: fs.rename (fast, same-device)
  try {
    await fs.rename(absoluteSrc, absoluteDest);
  } catch (err: unknown) {
    // EXDEV = cross-device link; fall back to copy + delete
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.cp(absoluteSrc, absoluteDest, { recursive: true });
      await fs.rm(absoluteSrc, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return { from: absoluteSrc, to: absoluteDest, usedGit: false };
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

export interface CopyResult {
  from: string;
  to: string;
}

/** Default concurrency for parallel directory copies. */
const COPY_CONCURRENCY = 16;

/**
 * Copy a file or directory.
 *
 * For directories the copy runs with up to {@link COPY_CONCURRENCY} parallel
 * file copies to saturate I/O. For single files falls back to `fs.copyFile`.
 *
 * Throws if source does not exist or destination already exists (no silent overwrite).
 */
export async function copyFile(
  absoluteSrc: string,
  absoluteDest: string,
  opts?: { createDirectories?: boolean; overwrite?: boolean; concurrency?: number }
): Promise<CopyResult> {
  const srcStat = await safeStat(absoluteSrc);
  if (!srcStat) throw new Error(`Source does not exist: ${absoluteSrc}`);

  if (!opts?.overwrite && (await safeStat(absoluteDest))) {
    throw new Error(`Destination already exists: ${absoluteDest}`);
  }

  if (opts?.createDirectories) {
    await fs.mkdir(path.dirname(absoluteDest), { recursive: true });
  }

  if (srcStat.isDirectory()) {
    await copyDirParallel(absoluteSrc, absoluteDest, opts?.concurrency ?? COPY_CONCURRENCY);
  } else {
    await fs.copyFile(absoluteSrc, absoluteDest);
  }
  return { from: absoluteSrc, to: absoluteDest };
}

// ─── Parallel directory copy ──────────────────────────────────────────────────

/**
 * Walk `src` recursively, creating mirror directories and copying files with
 * up to `concurrency` parallel I/O operations.
 */
async function copyDirParallel(src: string, dest: string, concurrency: number): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  // Collect all (srcPath, destPath) pairs via BFS
  const filePairs: Array<[string, string]> = [];
  const dirQueue: Array<[string, string]> = [[src, dest]];

  while (dirQueue.length > 0) {
    const batch = dirQueue.splice(0);
    // Read all directories in this BFS level concurrently
    const reads = batch.map(async ([srcDir, destDir]) => {
      const entries = await readdir(srcDir, { withFileTypes: true });
      const subDirs: Array<[string, string]> = [];
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          subDirs.push([srcPath, destPath]);
        } else {
          filePairs.push([srcPath, destPath]);
        }
      }
      return subDirs;
    });
    const nestedDirs = await Promise.all(reads);
    for (const dirs of nestedDirs) dirQueue.push(...dirs);
  }

  // Create all destination directories first (deduped, parallel)
  const uniqueDirs = [...new Set(filePairs.map(([, d]) => path.dirname(d)))];
  await Promise.all(uniqueDirs.map((d) => fs.mkdir(d, { recursive: true })));

  // Copy files with bounded concurrency
  let idx = 0;
  const next = async (): Promise<void> => {
    while (idx < filePairs.length) {
      const i = idx++;
      const [s, d] = filePairs[i]!;
      await fs.copyFile(s, d);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, filePairs.length) }, () => next());
  await Promise.all(workers);
}

// ─── Rename ───────────────────────────────────────────────────────────────────

export interface RenameResult {
  from: string;
  to: string;
  usedGit: boolean;
}

/**
 * Rename a file or directory (same parent directory, new name).
 *
 * Delegates to `moveFile` so git history is preserved when possible.
 */
export async function renameFile(absolutePath: string, newName: string): Promise<RenameResult> {
  if (newName.includes('/') || newName.includes('\\')) {
    throw new Error('newName must be a simple filename, not a path');
  }
  const dest = path.join(path.dirname(absolutePath), newName);
  const result = await moveFile(absolutePath, dest);
  return { from: result.from, to: result.to, usedGit: result.usedGit };
}

// ─── Hash ─────────────────────────────────────────────────────────────────────

export type HashAlgorithm = 'sha256' | 'sha1' | 'md5';

export interface HashResult {
  hash: string;
  algorithm: HashAlgorithm;
  sizeBytes: number;
}

/** Compute a hex-encoded hash of a file using streaming I/O. */
export async function hashFile(
  absolutePath: string,
  algorithm: HashAlgorithm = 'sha256'
): Promise<HashResult> {
  const stat = await safeStat(absolutePath);
  if (!stat) throw new Error(`File does not exist: ${absolutePath}`);

  const hash = createHash(algorithm);
  const stream = createReadStream(absolutePath);

  return new Promise<HashResult>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve({ hash: hash.digest('hex'), algorithm, sizeBytes: stat.size }));
    stream.on('error', reject);
  });
}

// ─── Temp files ───────────────────────────────────────────────────────────────

export interface TempResult {
  path: string;
  cleanup: () => Promise<void>;
}

/** Create a temporary directory. Returns path and a cleanup function. */
export async function createTempDir(prefix = 'ai-team-'): Promise<TempResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

/** Write content to a new temporary file. Returns path and a cleanup function. */
export async function createTempFile(
  content: string,
  opts?: { prefix?: string; suffix?: string }
): Promise<TempResult> {
  const { path: dir, cleanup: cleanupDir } = await createTempDir(opts?.prefix);
  const filePath = path.join(dir, `tmp${opts?.suffix ?? '.txt'}`);
  await fs.writeFile(filePath, content, 'utf8');
  return { path: filePath, cleanup: cleanupDir };
}

// ─── Symlinks ─────────────────────────────────────────────────────────────────

/** Create a symbolic link at `linkPath` pointing to `target`. */
export async function createSymlink(target: string, linkPath: string): Promise<void> {
  await fs.symlink(target, linkPath);
}

/** Read the target of a symbolic link. */
export async function readSymlinkTarget(absolutePath: string): Promise<string> {
  return fs.readlink(absolutePath);
}
