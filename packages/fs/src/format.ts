/**
 * Format-on-write subsystem.
 *
 * Subscribes to `file.edited` events and runs the first matching external
 * formatter for the written file. Formatters are auto-detected by checking
 * whether their executable is on `$PATH`.
 *
 * Usage:
 *   const dispose = initFormatOnWrite();
 *   // ... later, during shutdown ...
 *   dispose();
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { which } from './which.js';
import { onFileEdited, type FileEditedEvent } from './file-events.js';

// ─── Formatter definition ─────────────────────────────────────────────────────

export interface FormatterInfo {
  /** Human-readable name (e.g. "prettier"). */
  name: string;
  /**
   * Command + arguments. The literal `$FILE` is replaced with the absolute
   * file path at execution time.
   */
  command: string[];
  /** Optional environment variables merged into the child process env. */
  environment?: Record<string, string>;
  /** File extensions this formatter handles (including the dot, e.g. ".ts"). */
  extensions: string[];
  /** Check whether the formatter is available on this machine. */
  enabled(): boolean;
}

// ─── Built-in formatters ──────────────────────────────────────────────────────

/**
 * Registry of built-in formatters. Order matters — the first enabled
 * formatter whose extensions match the file wins.
 */
export const BUILT_IN_FORMATTERS: readonly FormatterInfo[] = [
  {
    name: 'prettier',
    command: ['prettier', '--write', '$FILE'],
    extensions: [
      '.js', '.jsx', '.mjs', '.cjs',
      '.ts', '.tsx', '.mts', '.cts',
      '.html', '.htm', '.css', '.scss', '.sass', '.less',
      '.vue', '.svelte',
      '.json', '.jsonc', '.yaml', '.yml', '.toml',
      '.md', '.mdx', '.graphql', '.gql',
    ],
    enabled: () => which('prettier') !== null,
  },
  {
    name: 'biome',
    command: ['biome', 'check', '--write', '$FILE'],
    extensions: [
      '.js', '.jsx', '.mjs', '.cjs',
      '.ts', '.tsx', '.mts', '.cts',
      '.json', '.jsonc',
    ],
    enabled: () => which('biome') !== null,
  },
  {
    name: 'gofmt',
    command: ['gofmt', '-w', '$FILE'],
    extensions: ['.go'],
    enabled: () => which('gofmt') !== null,
  },
  {
    name: 'rustfmt',
    command: ['rustfmt', '$FILE'],
    extensions: ['.rs'],
    enabled: () => which('rustfmt') !== null,
  },
  {
    name: 'ruff',
    command: ['ruff', 'format', '$FILE'],
    extensions: ['.py', '.pyi'],
    enabled: () => which('ruff') !== null,
  },
  {
    name: 'clang-format',
    command: ['clang-format', '-i', '$FILE'],
    extensions: ['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx'],
    enabled: () => which('clang-format') !== null,
  },
  {
    name: 'shfmt',
    command: ['shfmt', '-w', '$FILE'],
    extensions: ['.sh', '.bash'],
    enabled: () => which('shfmt') !== null,
  },
  {
    name: 'dart',
    command: ['dart', 'format', '$FILE'],
    extensions: ['.dart'],
    enabled: () => which('dart') !== null,
  },
  {
    name: 'zig',
    command: ['zig', 'fmt', '$FILE'],
    extensions: ['.zig', '.zon'],
    enabled: () => which('zig') !== null,
  },
  {
    name: 'mix',
    command: ['mix', 'format', '$FILE'],
    extensions: ['.ex', '.exs'],
    enabled: () => which('mix') !== null,
  },
];

// ─── findFormatters ───────────────────────────────────────────────────────────

/**
 * Return all enabled formatters whose extension list includes the given file.
 * The first match in the returned array has highest priority.
 */
export function findFormatters(
  filePath: string,
  formatters: readonly FormatterInfo[] = BUILT_IN_FORMATTERS,
): FormatterInfo[] {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return [];
  return formatters.filter(f => f.enabled() && f.extensions.includes(ext));
}

// ─── formatFile ───────────────────────────────────────────────────────────────

export interface FormatFileResult {
  formatted: boolean;
  formatter?: string;
  error?: string;
}

/**
 * Run the first matching formatter on `filePath`.
 *
 * Returns `{ formatted: true, formatter }` on success, or
 * `{ formatted: false }` when no formatter matches.
 * Formatter failures are caught and returned as `{ formatted: false, error }`.
 */
export async function formatFile(
  filePath: string,
  formatters: readonly FormatterInfo[] = BUILT_IN_FORMATTERS,
): Promise<FormatFileResult> {
  const candidates = findFormatters(filePath, formatters);
  if (candidates.length === 0) return { formatted: false };

  const formatter = candidates[0]!;
  const args = formatter.command.map(arg =>
    arg === '$FILE' ? filePath : arg,
  );
  const bin = args[0]!;
  const rest = args.slice(1);

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        bin,
        rest,
        {
          timeout: 30_000,
          env: formatter.environment
            ? { ...process.env, ...formatter.environment }
            : undefined,
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
    return { formatted: true, formatter: formatter.name };
  } catch (err) {
    return {
      formatted: false,
      formatter: formatter.name,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── initFormatOnWrite ────────────────────────────────────────────────────────

/**
 * Subscribe to `file.edited` events and auto-format written files.
 *
 * Returns an unsubscribe function to stop formatting.
 */
export function initFormatOnWrite(
  formatters: readonly FormatterInfo[] = BUILT_IN_FORMATTERS,
): () => void {
  return onFileEdited((event: FileEditedEvent) => {
    // Fire-and-forget — we don't block the tool response on formatting.
    formatFile(event.filePath, formatters).catch(() => {
      /* best effort — formatting failures are non-fatal */
    });
  });
}

// ─── getFormatterStatus ───────────────────────────────────────────────────────

export interface FormatterStatus {
  name: string;
  extensions: string[];
  enabled: boolean;
}

/** Return the enabled/disabled status of all built-in formatters. */
export function getFormatterStatus(
  formatters: readonly FormatterInfo[] = BUILT_IN_FORMATTERS,
): FormatterStatus[] {
  return formatters.map(f => ({
    name: f.name,
    extensions: f.extensions,
    enabled: f.enabled(),
  }));
}
