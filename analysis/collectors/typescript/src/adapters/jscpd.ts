/**
 * jscpd adapter — runs jscpd and normalizes output into duplicationSignals.
 */

import { execFile } from 'node:child_process';
import { readFile, mkdir, rm, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Raw jscpd JSON types
// ---------------------------------------------------------------------------

export interface JscpdRawFileLoc {
  line: number;
  column: number;
}

export interface JscpdRawFileRef {
  name: string;
  start: number;
  end: number;
  startLoc?: JscpdRawFileLoc;
  endLoc?: JscpdRawFileLoc;
}

export interface JscpdRawDuplicate {
  format: string;
  lines: number;
  tokens: number;
  firstFile: JscpdRawFileRef;
  secondFile: JscpdRawFileRef;
  fragment?: string;
}

export interface JscpdRawFormatStats {
  sources: number;
  duplicatedLines: number;
  lines: number;
  tokens: number;
  duplicatedTokens: number;
  clones: number;
  percentage: string;
}

export interface JscpdRawStatistics {
  detectionDate: string;
  formats: Record<string, JscpdRawFormatStats>;
  total: {
    sources: number;
    lines: number;
    tokens: number;
    duplicatedLines: number;
    duplicatedTokens: number;
    clones: number;
    percentage: string;
  };
}

export interface JscpdRawOutput {
  duplicates: JscpdRawDuplicate[];
  statistics: JscpdRawStatistics;
}

// ---------------------------------------------------------------------------
// Intermediate schema types (local definitions)
// ---------------------------------------------------------------------------

export interface DuplicationFileRef {
  filePath: string;
  startLine: number;
  endLine: number;
  startCol: number | null;
  endCol: number | null;
}

export interface DuplicationClone {
  id: string;
  format: string;
  tokenCount: number;
  lineCount: number;
  fragment: string | null;
  firstFile: DuplicationFileRef;
  secondFile: DuplicationFileRef;
}

export interface DuplicationStatistics {
  totalLines: number;
  totalTokens: number;
  totalSources: number;
  duplicatedLines: number;
  duplicatedTokens: number;
}

export interface DuplicationSignal {
  source: {
    tool: 'jscpd';
    version: string;
  };
  clones: DuplicationClone[];
  statistics: DuplicationStatistics;
}

// ---------------------------------------------------------------------------
// Adapter options / result
// ---------------------------------------------------------------------------

export interface JscpdAdapterOptions {
  /** Root directory to analyze */
  rootDir: string;
  /** Source directories (relative to rootDir) to scan */
  srcDirs?: string[];
  /** Glob patterns to include */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Minimum tokens for clone detection (default: 50) */
  minTokens?: number;
  /** Minimum lines for clone detection (default: 5) */
  minLines?: number;
  /** Max lines per file before skipping (default: 5000) */
  maxLines?: number;
  /** Language formats to scan (default: ['typescript']) */
  formats?: string[];
}

export interface JscpdToolRun {
  tool: 'jscpd';
  version: string;
  aspect: 'duplication';
  exitCode: number;
  duration: number;
  warnings: string[];
}

export interface JscpdResult {
  duplicationSignals: DuplicationSignal[];
  toolRun: JscpdToolRun;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Normalize a file path: forward slashes, strip leading "./" */
export function normalizePath(filePath: string): string {
  let p = filePath.replace(/\\/g, '/');
  if (p.startsWith('./')) {
    p = p.slice(2);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Clone ID generation
// ---------------------------------------------------------------------------

export function buildCloneId(first: JscpdRawFileRef, second: JscpdRawFileRef): string {
  const a = normalizePath(first.name);
  const b = normalizePath(second.name);
  return `clone:${a}:L${first.start}-${b}:L${second.start}`;
}

// ---------------------------------------------------------------------------
// Normalize a single raw file ref → DuplicationFileRef
// ---------------------------------------------------------------------------

function normalizeFileRef(raw: JscpdRawFileRef): DuplicationFileRef {
  return {
    filePath: normalizePath(raw.name),
    startLine: raw.start,
    endLine: raw.end,
    startCol: raw.startLoc?.column ?? null,
    endCol: raw.endLoc?.column ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pure normalization: raw jscpd JSON → DuplicationSignal
// ---------------------------------------------------------------------------

export function normalizeJscpdOutput(
  rawOutput: JscpdRawOutput,
  toolVersion: string
): DuplicationSignal {
  const clones: DuplicationClone[] = rawOutput.duplicates.map((dup) => ({
    id: buildCloneId(dup.firstFile, dup.secondFile),
    format: dup.format,
    tokenCount: dup.tokens,
    lineCount: dup.lines,
    fragment: dup.fragment ?? null,
    firstFile: normalizeFileRef(dup.firstFile),
    secondFile: normalizeFileRef(dup.secondFile),
  }));

  const total = rawOutput.statistics.total;

  return {
    source: { tool: 'jscpd', version: toolVersion },
    clones,
    statistics: {
      totalLines: total.lines,
      totalTokens: total.tokens,
      totalSources: total.sources,
      duplicatedLines: total.duplicatedLines,
      duplicatedTokens: total.duplicatedTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Resolve jscpd bin script (the JS file, not the shell shim)
// ---------------------------------------------------------------------------

function resolveJscpdBinScript(): string {
  // Resolve the main entry, then navigate to the bin script.
  // jscpd's package.json `exports` doesn't expose `./package.json`, so we
  // resolve the main entry and derive the bin path from there.
  const req = createRequire(import.meta.url);
  const jscpdMain = req.resolve('jscpd'); // e.g. .../jscpd/dist/src/index.js
  const distDir = dirname(dirname(jscpdMain)); // .../jscpd/dist
  return join(distDir, 'bin', 'jscpd');
}

// ---------------------------------------------------------------------------
// Get jscpd version
// ---------------------------------------------------------------------------

function getJscpdVersion(binScript: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [binScript, '--version'], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        reject(new Error(`Failed to get jscpd version: ${String(err.message)}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Run jscpd CLI via node
// ---------------------------------------------------------------------------

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runJscpdCli(binScript: string, args: string[], cwd: string): Promise<CliRunResult> {
  return new Promise((resolve) => {
    // Run the bin script with node so it works on all platforms (the .bin
    // shims are shell/cmd scripts that don't work with execFile portably).
    execFile(
      process.execPath,
      [binScript, ...args],
      { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // jscpd may exit non-zero when duplicates are found — that's not an error
        const exitCode = err && 'code' in err ? (err.code as number) : 0;
        resolve({ exitCode: typeof exitCode === 'number' ? exitCode : 1, stdout, stderr });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Public: run the full adapter
// ---------------------------------------------------------------------------

export async function runJscpdAdapter(options: JscpdAdapterOptions): Promise<JscpdResult> {
  const start = Date.now();
  const warnings: string[] = [];

  const binScript = resolveJscpdBinScript();
  const version = await getJscpdVersion(binScript).catch(() => {
    warnings.push('Could not determine jscpd version');
    return 'unknown';
  });

  const rootDir = resolve(options.rootDir);
  const outputDir = join(rootDir, '.jscpd-report');

  // Resolve scan paths — either explicit srcDirs or the rootDir itself
  const scanPaths =
    (options.srcDirs ?? []).length > 0
      ? options.srcDirs!.map((d) => resolve(rootDir, d))
      : [rootDir];

  // Build CLI args
  const args: string[] = [
    ...scanPaths,
    '--reporters',
    'json',
    '--output',
    outputDir,
    '--format',
    (options.formats ?? ['typescript']).join(','),
    '--min-tokens',
    String(options.minTokens ?? 50),
    '--min-lines',
    String(options.minLines ?? 5),
    '--max-lines',
    String(options.maxLines ?? 5000),
    '--silent',
  ];

  const include = options.include ?? ['**/*.ts', '**/*.tsx'];
  for (const pattern of include) {
    args.push('--pattern', pattern);
  }

  const exclude = options.exclude ?? ['**/node_modules/**', '**/dist/**'];
  args.push('--ignore', exclude.join(','));

  // Ensure output dir exists
  await mkdir(outputDir, { recursive: true });

  const cliResult = await runJscpdCli(binScript, args, rootDir);

  if (cliResult.stderr) {
    warnings.push(cliResult.stderr.trim());
  }

  // Read JSON report
  const reportPath = join(outputDir, 'jscpd-report.json');
  let rawOutput: JscpdRawOutput;
  try {
    await access(reportPath);
  } catch {
    const detail = cliResult.stderr ? `\nCLI stderr: ${cliResult.stderr.trim()}` : '';
    throw new Error(
      `jscpd did not produce a report at ${reportPath} (exit code ${cliResult.exitCode}).${detail}`
    );
  }
  try {
    const content = await readFile(reportPath, 'utf-8');
    rawOutput = JSON.parse(content) as JscpdRawOutput;
  } catch (readErr) {
    throw new Error(`Failed to read jscpd report at ${reportPath}: ${String(readErr)}`);
  }

  // Clean up report directory
  await rm(outputDir, { recursive: true, force: true }).catch(() => {
    warnings.push('Could not clean up jscpd report directory');
  });

  const signal = normalizeJscpdOutput(rawOutput, version);
  const duration = Date.now() - start;

  return {
    duplicationSignals: [signal],
    toolRun: {
      tool: 'jscpd',
      version,
      aspect: 'duplication',
      exitCode: cliResult.exitCode,
      duration,
      warnings,
    },
  };
}
