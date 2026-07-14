// @aspect/collector-typescript — eslint adapter

import { execFile } from 'node:child_process';
import { resolve, relative, join, win32 } from 'node:path';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

// ---------------------------------------------------------------------------
// Intermediate schema types
// ---------------------------------------------------------------------------

export interface LintSignalSource {
  tool: 'eslint';
  version: string;
  ruleSet: string;
}

export interface LintSignalResult {
  filePath: string;
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line: number;
  column: number;
  endLine: number | null;
  endColumn: number | null;
}

export interface LintSignal {
  source: LintSignalSource;
  results: LintSignalResult[];
}

// ---------------------------------------------------------------------------
// Raw eslint JSON types
// ---------------------------------------------------------------------------

export interface EslintRawMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  nodeType?: string | null;
  messageId?: string;
  fix?: { range: [number, number]; text: string };
  suggestions?: Array<{ messageId: string; fix: { range: [number, number]; text: string } }>;
}

export interface EslintRawOutput {
  filePath: string;
  messages: EslintRawMessage[];
  suppressedMessages: unknown[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
  source?: string;
  usedDeprecatedRules?: unknown[];
}

// ---------------------------------------------------------------------------
// Adapter options / result
// ---------------------------------------------------------------------------

export interface EslintAdapterOptions {
  /** Root directory to analyze */
  rootDir: string;
  /** Source directories/patterns relative to rootDir */
  patterns?: string[];
  /** Path to eslint config file (optional — uses project's config if omitted) */
  configPath?: string;
  /** Extra eslint CLI flags */
  extraArgs?: string[];
}

export interface EslintResult {
  lintSignals: LintSignal[];
  toolRun: {
    tool: 'eslint';
    version: string;
    aspect: 'lint';
    exitCode: number;
    duration: number;
    warnings: string[];
  };
}

// ---------------------------------------------------------------------------
// Pure normalization (no I/O — safe for unit testing with fixtures)
// ---------------------------------------------------------------------------

function mapSeverity(severity: 1 | 2): 'error' | 'warning' {
  return severity === 2 ? 'error' : 'warning';
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

function relativizeFilePath(rootDir: string, filePath: string): string {
  const normalizedRootDir = toForwardSlash(rootDir);
  const normalizedFilePath = toForwardSlash(filePath);
  const isWindowsAbsolutePath = /^[A-Za-z]:\//;

  if (
    isWindowsAbsolutePath.test(normalizedRootDir) &&
    isWindowsAbsolutePath.test(normalizedFilePath)
  ) {
    return toForwardSlash(win32.relative(normalizedRootDir, normalizedFilePath));
  }

  return toForwardSlash(relative(rootDir, filePath));
}

export function normalizeEslintOutput(
  rawOutput: EslintRawOutput[],
  rootDir: string,
  toolVersion: string,
  ruleSet: string
): LintSignal {
  const results: LintSignalResult[] = [];

  for (const file of rawOutput) {
    for (const msg of file.messages) {
      // Skip messages without a ruleId (parse errors, fatal issues)
      if (msg.ruleId === null) continue;

      const relPath = relativizeFilePath(rootDir, file.filePath);

      results.push({
        filePath: relPath,
        ruleId: msg.ruleId,
        severity: mapSeverity(msg.severity),
        message: msg.message,
        line: msg.line,
        column: msg.column,
        endLine: msg.endLine ?? null,
        endColumn: msg.endColumn ?? null,
      });
    }
  }

  return {
    source: {
      tool: 'eslint',
      version: toolVersion,
      ruleSet,
    },
    results,
  };
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function execFileAsync(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { ...options, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode =
        error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode });
    });
  });
}

async function findEslintBinary(rootDir: string): Promise<string> {
  const candidates = [
    join(rootDir, 'node_modules', '.bin', 'eslint'),
    join(rootDir, 'node_modules', '.bin', 'eslint.cmd'),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  // Fall back — if neither exists with X_OK, try the .cmd variant on Windows
  // or the plain binary otherwise and let execFile report the real error.
  return candidates[0];
}

async function getEslintVersion(binary: string, cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(binary, ['--version'], { cwd, timeout: 15_000 });
  // eslint --version prints "v8.56.0\n" — strip the leading "v" and trim
  return stdout.trim().replace(/^v/i, '');
}

// ---------------------------------------------------------------------------
// Main adapter entry point
// ---------------------------------------------------------------------------

export async function runEslintAdapter(options: EslintAdapterOptions): Promise<EslintResult> {
  const { rootDir, patterns, configPath, extraArgs } = options;
  const absRoot = resolve(rootDir);
  const warnings: string[] = [];

  // 1. Find eslint binary in the target project
  const binary = await findEslintBinary(absRoot);

  // 2. Get eslint version
  const version = await getEslintVersion(binary, absRoot);

  // 3. Build arguments
  const args: string[] = ['--format', 'json'];

  if (configPath) {
    args.push('--config', configPath);
  }

  if (extraArgs) {
    args.push(...extraArgs);
  }

  if (patterns && patterns.length > 0) {
    args.push(...patterns);
  } else {
    args.push('.');
  }

  // 4. Run eslint
  const startTime = performance.now();
  const { stdout, stderr, exitCode } = await execFileAsync(binary, args, {
    cwd: absRoot,
    timeout: 5 * 60 * 1000,
  });
  const duration = Math.round(performance.now() - startTime);

  // 5. Collect warnings from stderr
  if (stderr.trim()) {
    warnings.push(stderr.trim());
  }

  // Exit code 2 means config / fatal error — still try to parse what we got
  if (exitCode === 2) {
    warnings.push(`eslint exited with code 2 (configuration or fatal error)`);
  }

  // 6. Parse JSON output
  let rawOutput: EslintRawOutput[];
  try {
    rawOutput = JSON.parse(stdout) as EslintRawOutput[];
  } catch {
    return {
      lintSignals: [],
      toolRun: {
        tool: 'eslint',
        version,
        aspect: 'lint',
        exitCode,
        duration,
        warnings: [...warnings, 'Failed to parse eslint JSON output'],
      },
    };
  }

  // 7. Normalize
  const ruleSet = configPath ?? 'default';
  const lintSignal = normalizeEslintOutput(rawOutput, absRoot, version, ruleSet);

  return {
    lintSignals: [lintSignal],
    toolRun: {
      tool: 'eslint',
      version,
      aspect: 'lint',
      exitCode,
      duration,
      warnings,
    },
  };
}
