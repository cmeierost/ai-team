/**
 * File reading primitives — binary/MIME detection, directory listing,
 * streaming text reads, and similar-name lookups.
 *
 * These are pure filesystem operations with no access-layer dependency.
 * The tool layer in @ai-team/core wraps them with access checks.
 */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

// ─── Constants ────────────────────────────────────────────────────────────────

export const READ_DEFAULT_LIMIT = 2000;
export const READ_MAX_LINE_LENGTH = 2000;
export const READ_MAX_BYTES = 50 * 1024; // 50 KB

const BINARY_EXTENSIONS = new Set([
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.class',
  '.jar',
  '.war',
  '.ear',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.bin',
  '.dat',
  '.obj',
  '.o',
  '.a',
  '.lib',
  '.wasm',
  '.pyc',
  '.pyo',
  '.db',
  '.sqlite',
  '.sqlite3',
]);

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
};

// ─── Detection helpers ────────────────────────────────────────────────────────

/** Fast binary check by file extension alone. */
export function isBinaryByExtension(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Return the MIME type for known image/PDF extensions, or null. */
export function getMimeType(filePath: string): string | null {
  return IMAGE_MIME[path.extname(filePath).toLowerCase()] ?? null;
}

/** Probe up to 4096 bytes for binary content (null bytes or >30% non-printable). */
export async function isBinaryByContent(absolutePath: string, fileSize: number): Promise<boolean> {
  if (fileSize === 0) return false;
  const PROBE_SIZE = 4096;
  const probeBuf = Buffer.alloc(Math.min(PROBE_SIZE, fileSize));
  const fd = await fs.open(absolutePath, 'r');
  try {
    await fd.read(probeBuf, 0, probeBuf.length, 0);
  } finally {
    await fd.close();
  }

  if (probeBuf.includes(0)) return true;

  let nonPrintable = 0;
  for (const b of probeBuf) {
    if (b < 9 || (b > 13 && b < 32)) nonPrintable++;
  }
  return nonPrintable / probeBuf.length > 0.3;
}

/**
 * Detect the content kind of a file by extension and byte-probing.
 *
 * Returns one of:
 * - `{ kind: 'image' | 'pdf', mimeType }` — media passthrough
 * - `{ kind: 'binary' }` — opaque binary
 * - `{ kind: 'text' }` — safe for streaming text read
 */
export type FileContentKind =
  | { kind: 'media'; mimeType: string }
  | { kind: 'binary' }
  | { kind: 'text' };

export async function detectContentKind(
  absolutePath: string,
  fileSize: number
): Promise<FileContentKind> {
  const mime = getMimeType(absolutePath);
  if (mime) return { kind: 'media', mimeType: mime };
  if (isBinaryByExtension(absolutePath)) return { kind: 'binary' };
  if (await isBinaryByContent(absolutePath, fileSize)) return { kind: 'binary' };
  return { kind: 'text' };
}

// ─── Directory listing ────────────────────────────────────────────────────────

export interface DirectoryPage {
  entries: string[];
  totalEntries: number;
}

/** Read directory entries with symlink resolution and pagination. */
export async function readDirectoryPaginated(
  absolutePath: string,
  offset: number,
  limit: number
): Promise<DirectoryPage> {
  const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(
      async (d: { isDirectory: () => boolean; name: string; isSymbolicLink: () => boolean }) => {
        if (d.isDirectory()) return `${d.name}/`;
        if (d.isSymbolicLink()) {
          const target = await fs.stat(path.join(absolutePath, d.name)).catch(() => null);
          if (target?.isDirectory()) return `${d.name}/`;
        }
        return d.name;
      }
    )
  );
  entries.sort((a: string, b: string) => a.localeCompare(b));
  const startIdx = offset - 1;
  return { entries: entries.slice(startIdx, startIdx + limit), totalEntries: entries.length };
}

// ─── Streaming text read ──────────────────────────────────────────────────────

export interface StreamReadResult {
  /** Lines read (raw, without line-number prefix). */
  raw: string[];
  /** Total line count in the file. */
  totalLines: number;
  /** True when the byte budget was exhausted before `limit` lines were read. */
  truncatedByBytes: boolean;
  /** True when more lines exist beyond those returned. */
  hasMoreLines: boolean;
}

/** Stream a text file line-by-line, applying line/byte caps. */
export async function streamTextFile(
  absolutePath: string,
  offset: number,
  limit: number,
  opts?: { maxLineLength?: number; maxBytes?: number }
): Promise<StreamReadResult> {
  const maxLineLen = opts?.maxLineLength ?? READ_MAX_LINE_LENGTH;
  const maxBytes = opts?.maxBytes ?? READ_MAX_BYTES;

  const stream = createReadStream(absolutePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const startLine = offset - 1;
  const raw: string[] = [];
  let bytes = 0;
  let totalLines = 0;
  let truncatedByBytes = false;
  let hasMoreLines = false;

  try {
    for await (const text of rl) {
      totalLines++;
      if (totalLines <= startLine) continue;

      if (raw.length >= limit) {
        hasMoreLines = true;
        continue;
      }

      const line =
        text.length > maxLineLen ? text.substring(0, maxLineLen) + '... (line truncated)' : text;
      const lineBytes = Buffer.byteLength(line, 'utf8') + (raw.length > 0 ? 1 : 0);

      if (bytes + lineBytes > maxBytes) {
        truncatedByBytes = true;
        hasMoreLines = true;
        break;
      }

      raw.push(line);
      bytes += lineBytes;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { raw, totalLines, truncatedByBytes, hasMoreLines };
}

// ─── Similar-name lookup ──────────────────────────────────────────────────────

/**
 * Find filenames in the same directory that are similar to the given path.
 * Returns workspace-relative paths (forward-slash). No access filtering — the
 * caller is responsible for checking permissions.
 */
export async function findSimilarNames(
  absolutePath: string,
  workspaceRoot: string,
  maxResults = 5
): Promise<string[]> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath).toLowerCase();
  const results: string[] = [];
  try {
    const siblings = await fs.readdir(dir);
    for (const entry of siblings) {
      const lower = entry.toLowerCase();
      if (lower.includes(base) || base.includes(lower)) {
        results.push(path.relative(workspaceRoot, path.join(dir, entry)).replaceAll('\\', '/'));
        if (results.length >= maxResults) break;
      }
    }
  } catch {
    /* parent dir may not exist */
  }
  return results;
}

// ─── Image/PDF read ───────────────────────────────────────────────────────────

export interface MediaReadResult {
  mimeType: string;
  base64: string;
  sizeBytes: number;
}

/** Read an image or PDF file as base64. */
export async function readMediaFile(absolutePath: string): Promise<MediaReadResult> {
  const mime = getMimeType(absolutePath);
  if (!mime) throw new Error(`Not a recognized media file: ${absolutePath}`);
  const buf = await fs.readFile(absolutePath);
  return { mimeType: mime, base64: buf.toString('base64'), sizeBytes: buf.length };
}

// ─── Stat with ENOENT → null ──────────────────────────────────────────────────

import type { Stats } from 'node:fs';

/** Like fs.stat but returns null for ENOENT instead of throwing. */
export async function safeStat(absolutePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ─── High-level read orchestrator ─────────────────────────────────────────────

/**
 * Discriminated-union result returned by {@link readFile}.
 *
 * - `not-found` — file does not exist; includes similar-name suggestions
 * - `directory` — path is a directory; includes paginated listing
 * - `media` — image/PDF passthrough as base64
 * - `binary` — opaque binary; only size is returned
 * - `text` — streamed text with start/end line metadata
 * - `offset-out-of-range` — requested offset exceeds total lines
 */
export type ReadFileResult =
  | { kind: 'not-found'; suggestions: string[] }
  | {
      kind: 'directory';
      entries: string[];
      totalEntries: number;
      offset: number;
      limit: number;
      hasMore: boolean;
    }
  | { kind: 'media'; mimeType: string; base64: string; sizeBytes: number }
  | { kind: 'binary'; sizeBytes: number }
  | {
      kind: 'text';
      content: string;
      totalLines: number;
      startLine: number;
      endLine: number;
      isFullFile: boolean;
      offset: number;
      limit: number;
      hasMore: boolean;
      truncatedByBytes: boolean;
      nextOffset?: number;
    }
  | { kind: 'offset-out-of-range'; totalLines: number; offset: number };

export interface ReadFileOptions {
  /** 1-based start line (default 1). */
  offset?: number;
  /** Max lines to return (default READ_DEFAULT_LIMIT). */
  limit?: number;
  /** Workspace root — needed for similar-name lookup on ENOENT. */
  workspaceRoot: string;
}

/**
 * Read any file or directory, routing to the appropriate strategy.
 *
 * Pure FS — no access-layer dependency.  The core tool layer wraps this
 * with access checks and injects access metadata into the response.
 */
export async function readFile(
  absolutePath: string,
  opts: ReadFileOptions
): Promise<ReadFileResult> {
  const offset = opts.offset ?? 1;
  const limit = opts.limit ?? READ_DEFAULT_LIMIT;
  const stat = await safeStat(absolutePath);

  if (!stat) {
    const suggestions = await findSimilarNames(absolutePath, opts.workspaceRoot);
    return { kind: 'not-found', suggestions };
  }

  if (stat.isDirectory()) {
    const page = await readDirectoryPaginated(absolutePath, offset, limit);
    return {
      kind: 'directory',
      entries: page.entries,
      totalEntries: page.totalEntries,
      offset,
      limit,
      hasMore: offset - 1 + limit < page.totalEntries,
    };
  }

  const contentKind = await detectContentKind(absolutePath, stat.size);

  if (contentKind.kind === 'media') {
    const media = await readMediaFile(absolutePath);
    return { kind: 'media', ...media };
  }

  if (contentKind.kind === 'binary') {
    return { kind: 'binary', sizeBytes: stat.size };
  }

  return readTextContent(absolutePath, offset, limit);
}

/** Internal: stream text and build a result with explicit line-range metadata. */
async function readTextContent(
  absolutePath: string,
  offset: number,
  limit: number
): Promise<ReadFileResult> {
  const { raw, totalLines, truncatedByBytes, hasMoreLines } = await streamTextFile(
    absolutePath,
    offset,
    limit
  );

  if (totalLines < offset && !(totalLines === 0 && offset === 1)) {
    return { kind: 'offset-out-of-range', totalLines, offset };
  }

  const content = raw.join('\n');
  const nextOffset = offset + raw.length;
  const hasMore = hasMoreLines || truncatedByBytes;
  const endLine = offset + raw.length - 1;

  return {
    kind: 'text',
    content,
    totalLines,
    startLine: offset,
    endLine,
    isFullFile: offset === 1 && !hasMore,
    offset,
    limit,
    hasMore,
    truncatedByBytes,
    ...(hasMore ? { nextOffset } : {}),
  };
}

// ─── Batch read ───────────────────────────────────────────────────────────────

const BATCH_READ_CONCURRENCY = 16;

export interface BatchReadEntry {
  path: string;
  result: ReadFileResult;
}

/**
 * Read multiple files in parallel with bounded concurrency.
 *
 * Returns results in the same order as the input paths.
 * Failures are returned as `not-found` results rather than throwing.
 */
export async function batchReadFiles(
  absolutePaths: string[],
  opts: ReadFileOptions
): Promise<BatchReadEntry[]> {
  const out: BatchReadEntry[] = new Array(absolutePaths.length);
  let idx = 0;

  const next = async (): Promise<void> => {
    while (idx < absolutePaths.length) {
      const i = idx++;
      const absPath = absolutePaths[i]!;
      try {
        out[i] = { path: absPath, result: await readFile(absPath, opts) };
      } catch {
        out[i] = { path: absPath, result: { kind: 'not-found', suggestions: [] } };
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(BATCH_READ_CONCURRENCY, absolutePaths.length) },
    () => next()
  );
  await Promise.all(workers);
  return out;
}
