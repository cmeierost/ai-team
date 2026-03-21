/**
 * Ripgrep integration — mirrors OpenCode's file/ripgrep.ts.
 *
 * Auto-discovers system `rg` on PATH, or downloads a platform binary to
 * ~/.ai-team/bin/ on first use. Provides:
 *   - Ripgrep.filepath()            — resolves the rg binary path
 *   - Ripgrep.files(input)          — async generator of file paths
 *   - Ripgrep.search(input)         — structured match objects
 *   - Ripgrep.tree(input)           — hierarchical directory tree string
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Download the platform ripgrep binary to `binDir`. Returns the binary path. */
async function downloadRipgrep(binDir: string, localRg: string): Promise<string> {
  const platformKey = `${process.arch}-${process.platform}`;
  const config = PLATFORM[platformKey];
  if (!config) {
    throw new Error(`Unsupported platform for ripgrep auto-download: ${platformKey}`);
  }

  await fs.mkdir(binDir, { recursive: true });

  const filename = `ripgrep-${RG_VERSION}-${config.platform}.${config.extension}`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/${filename}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ripgrep from ${url}: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const archivePath = path.join(binDir, filename);
  await fs.writeFile(archivePath, Buffer.from(arrayBuffer));

  if (config.extension === 'tar.gz') {
    await extractTarGz(archivePath, binDir, platformKey);
  } else {
    await extractZip(arrayBuffer, localRg);
  }

  try { await fs.unlink(archivePath); } catch {}

  if (!platformKey.endsWith('-win32')) {
    await fs.chmod(localRg, 0o755);
  }

  return localRg;
}

async function extractTarGz(archivePath: string, destDir: string, platformKey: string): Promise<void> {
  const args = ['tar', '-xzf', archivePath, '--strip-components=1'];
  if (platformKey.endsWith('-darwin')) args.push('--include=*/rg');
  if (platformKey.endsWith('-linux'))  args.push('--wildcards', '*/rg');

  const result = await runProcess(args, { cwd: destDir });
  if (result.code !== 0) {
    throw new Error(`Failed to extract ripgrep from ${archivePath}`);
  }
}

async function extractZip(archiveData: ArrayBuffer, destPath: string): Promise<void> {
  type ZipEntry = { filename: string; getData: (w: BlobWriter) => Promise<Blob> };
  const zipReader = new ZipReader(new BlobReader(new Blob([archiveData])));
  const rawEntries = (await zipReader.getEntries()) as unknown as ZipEntry[];
  const rgEntry = rawEntries.find((e) => e.filename.endsWith('rg.exe'));
  if (!rgEntry) {
    throw new Error('rg.exe not found in downloaded zip archive');
  }
  const rgBlob = await rgEntry.getData(new BlobWriter());
  await fs.writeFile(destPath, Buffer.from(await rgBlob.arrayBuffer()));
  await zipReader.close();
}
async function runProcess(
  args: string[],
  opts: { cwd: string; nothrow?: boolean },
): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    const [cmd, ...rest] = args;
    const proc = spawn(cmd, rest, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const chunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', () => {}); // swallow

    proc.on('error', (err) => {
      if (opts.nothrow) resolve({ code: 1, text: '' });
      else reject(err);
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, text: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

/** Spawn a process and stream stdout lines to `onLine`. */
function spawnStreaming(
  args: string[],
  opts: { cwd: string; signal?: AbortSignal },
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...rest] = args;
    const proc = spawn(cmd, rest, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => proc.kill());
    }

    let buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line) onLine(line);
      }
    });

    proc.on('error', reject);
    proc.on('close', () => {
      if (buffer) onLine(buffer);
      resolve();
    });
  });
}

/** Test whether `cmd` exists on PATH using the OS-native lookup command. */
async function which(cmd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const whereCmd = process.platform === 'win32' ? 'where' : 'which';
    const proc = spawn(whereCmd, [cmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0 || !out.trim()) { resolve(undefined); return; }
      resolve(out.trim().split(/\r?\n/)[0]);
    });
    proc.on('error', () => resolve(undefined));
  });
}

// ---------------------------------------------------------------------------
// Platform → download config
// ---------------------------------------------------------------------------

const PLATFORM: Record<string, { platform: string; extension: 'tar.gz' | 'zip' }> = {
  'arm64-darwin': { platform: 'aarch64-apple-darwin',       extension: 'tar.gz' },
  'arm64-linux':  { platform: 'aarch64-unknown-linux-gnu',  extension: 'tar.gz' },
  'x64-darwin':   { platform: 'x86_64-apple-darwin',        extension: 'tar.gz' },
  'x64-linux':    { platform: 'x86_64-unknown-linux-musl',  extension: 'tar.gz' },
  'x64-win32':    { platform: 'x86_64-pc-windows-msvc',     extension: 'zip' },
};

const RG_VERSION = '14.1.1';

// ---------------------------------------------------------------------------
// Zod schemas for ripgrep JSON output
// ---------------------------------------------------------------------------

const _Stats = z.object({
  elapsed:             z.object({ secs: z.number(), nanos: z.number(), human: z.string() }),
  searches:            z.number(),
  searches_with_match: z.number(),
  bytes_searched:      z.number(),
  bytes_printed:       z.number(),
  matched_lines:       z.number(),
  matches:             z.number(),
});

const _Begin = z.object({
  type: z.literal('begin'),
  data: z.object({ path: z.object({ text: z.string() }) }),
});

export const MatchSchema = z.object({
  type: z.literal('match'),
  data: z.object({
    path:            z.object({ text: z.string() }),
    lines:           z.object({ text: z.string() }),
    line_number:     z.number(),
    absolute_offset: z.number(),
    submatches: z.array(
      z.object({
        match: z.object({ text: z.string() }),
        start: z.number(),
        end:   z.number(),
      }),
    ),
  }),
});

const _End = z.object({
  type: z.literal('end'),
  data: z.object({
    path:          z.object({ text: z.string() }),
    binary_offset: z.number().nullable(),
    stats:         _Stats,
  }),
});

const _Summary = z.object({
  type: z.literal('summary'),
  data: z.object({
    elapsed_total: z.object({ human: z.string(), nanos: z.number(), secs: z.number() }),
    stats: _Stats,
  }),
});

const ResultSchema = z.union([_Begin, MatchSchema, _End, _Summary]);

export type RgMatch    = z.infer<typeof MatchSchema>;
export type RgResult   = z.infer<typeof ResultSchema>;

// ---------------------------------------------------------------------------
// Ripgrep namespace
// ---------------------------------------------------------------------------

export namespace Ripgrep {

  const binDir = path.join(os.homedir(), '.ai-team', 'bin');
  let cachedPath: string | undefined;

  /** Resolve the rg binary, downloading if necessary. */
  export async function filepath(): Promise<string> {
    if (cachedPath) return cachedPath;

    const localRg = path.join(binDir, process.platform === 'win32' ? 'rg.exe' : 'rg');

    const resolved = await trySystemRg() ?? await tryLocalRg(localRg) ?? await downloadRipgrep(binDir, localRg);
    cachedPath = resolved;
    return resolved;
  }

  async function trySystemRg(): Promise<string | undefined> {
    const systemRg = await which('rg');
    if (!systemRg) return undefined;
    try {
      const stat = await fs.stat(systemRg);
      return stat.isFile() ? systemRg : undefined;
    } catch {
      return undefined;
    }
  }

  async function tryLocalRg(localRgPath: string): Promise<string | undefined> {
    return fsSync.existsSync(localRgPath) ? localRgPath : undefined;
  }

  /** Async generator yielding file paths matching the given criteria. */
  export async function* files(input: {
    cwd: string;
    glob?: string[];
    hidden?: boolean;
    follow?: boolean;
    maxDepth?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<string> {
    input.signal?.throwIfAborted();

    const rg = await filepath();
    const args: string[] = [rg, '--files', '--glob=!.git/*'];

    if (input.follow !== false) args.push('--follow');
    if (input.hidden !== false) args.push('--hidden');
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`);
    if (input.glob) {
      for (const g of input.glob) args.push(`--glob=${g}`);
    }

    // Validate cwd
    const stat = await fs.stat(input.cwd).catch(() => undefined);
    if (!stat?.isDirectory()) {
      const err: NodeJS.ErrnoException = Object.assign(
        new Error(`No such file or directory: '${input.cwd}'`),
        { code: 'ENOENT', path: input.cwd },
      );
      throw err;
    }

    const lines: string[] = [];

    await spawnStreaming(args, { cwd: input.cwd, signal: input.signal }, (line) => {
      lines.push(line);
    });

    for (const line of lines) {
      input.signal?.throwIfAborted();
      yield line;
    }
  }

  /** Build a hierarchical directory tree string from ripgrep file listing. */
  export async function tree(input: {
    cwd: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const allFiles: string[] = [];
    for await (const file of Ripgrep.files({ cwd: input.cwd, signal: input.signal })) {
      allFiles.push(file);
    }

    interface Node {
      name: string;
      children: Map<string, Node>;
    }

    function dir(node: Node, name: string): Node {
      const existing = node.children.get(name);
      if (existing) return existing;
      const next: Node = { name, children: new Map() };
      node.children.set(name, next);
      return next;
    }

    const root: Node = { name: '', children: new Map() };
    for (const file of allFiles) {
      const sep = file.includes('/') ? '/' : path.sep;
      const parts = file.split(sep);
      if (parts.length < 2) continue;
      let node = root;
      for (const part of parts.slice(0, -1)) {
        node = dir(node, part);
      }
    }

    function count(node: Node): number {
      let total = 0;
      for (const child of node.children.values()) {
        total += 1 + count(child);
      }
      return total;
    }

    const total = count(root);
    const limit = input.limit ?? total;
    const lines: string[] = [];
    const queue: Array<{ node: Node; path: string }> = [];

    for (const child of [...root.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      queue.push({ node: child, path: child.name });
    }

    let used = 0;
    for (let i = 0; i < queue.length && used < limit; i++) {
      const { node, path: nodePath } = queue[i];
      lines.push(nodePath);
      used++;
      for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        queue.push({ node: child, path: `${nodePath}/${child.name}` });
      }
    }

    if (total > used) lines.push(`[${total - used} directories truncated]`);

    return lines.join('\n');
  }

  /** Search for a pattern and return structured match objects. */
  export async function search(input: {
    cwd: string;
    pattern: string;
    glob?: string[];
    limit?: number;
    follow?: boolean;
  }): Promise<RgMatch['data'][]> {
    const rg = await filepath();
    const args: string[] = [rg, '--json', '--hidden', '--glob=!.git/*'];

    if (input.follow) args.push('--follow');
    if (input.glob) {
      for (const g of input.glob) args.push(`--glob=${g}`);
    }
    if (input.limit) args.push(`--max-count=${input.limit}`);

    args.push('--', input.pattern);

    const result = await runProcess(args, { cwd: input.cwd, nothrow: true });
    if (result.code !== 0 && result.text.trim() === '') {
      return [];
    }

    const lines = result.text.trim().split(/\r?\n/).filter(Boolean);
    return lines
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .map((parsed) => {
        const r = ResultSchema.safeParse(parsed);
        return r.success ? r.data : null;
      })
      .filter((r): r is RgMatch => r !== null && r.type === 'match')
      .map((r) => r.data);
  }
}
