/**
 * File-system CRUD primitives — exists, info, create, write, delete, mkdir.
 *
 * These are pure filesystem operations with no access-layer dependency.
 * The tool layer in @ai-team/core wraps them with access checks.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStat } from './file-read.js';

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
  opts?: { createDirectories?: boolean },
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
export async function writeFile(
  absolutePath: string,
  content: string,
): Promise<WriteFileResult> {
  await fs.writeFile(absolutePath, content, 'utf8');
  return { bytes: Buffer.byteLength(content, 'utf8') };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/** Delete a file or directory. */
export async function deletePath(
  absolutePath: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  await fs.rm(absolutePath, { recursive: opts?.recursive ?? true, force: false });
}

// ─── Mkdir ────────────────────────────────────────────────────────────────────

/** Create a directory. */
export async function createDirectory(
  absolutePath: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  await fs.mkdir(absolutePath, { recursive: opts?.recursive ?? true });
}
