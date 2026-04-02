/**
 * Coverage adapter — parses LCOV and Istanbul JSON coverage reports
 * into normalized coverageSignals.
 */

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Intermediate schema types
// ---------------------------------------------------------------------------

export interface CoverageFileFunction {
  name: string;
  line: number;
  executionCount: number;
}

export interface CoverageFile {
  filePath: string;
  linesCovered: number;
  linesTotal: number;
  branchesCovered: number | null;
  branchesTotal: number | null;
  functions: CoverageFileFunction[];
}

export interface CoverageSignalSource {
  tool: string;
  format: 'lcov' | 'istanbul';
  version: string;
}

export interface CoverageSignal {
  source: CoverageSignalSource;
  files: CoverageFile[];
}

// ---------------------------------------------------------------------------
// Adapter options / result
// ---------------------------------------------------------------------------

export interface CoverageAdapterOptions {
  rootDir: string;
  coveragePath: string;
  format?: 'lcov' | 'istanbul';
}

export interface CoverageToolRun {
  tool: string;
  version: string;
  aspect: 'coverage';
  exitCode: number;
  duration: number;
  warnings: string[];
}

export interface CoverageResult {
  coverageSignals: CoverageSignal[];
  toolRun: CoverageToolRun;
}

// ---------------------------------------------------------------------------
// Istanbul raw types (subset for parsing)
// ---------------------------------------------------------------------------

interface IstanbulPosition {
  line: number;
  column: number;
}

interface IstanbulRange {
  start: IstanbulPosition;
  end: IstanbulPosition;
}

interface IstanbulFnEntry {
  name: string;
  decl: IstanbulRange;
  loc: IstanbulRange;
}

interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<string, IstanbulRange>;
  fnMap: Record<string, IstanbulFnEntry>;
  branchMap: Record<string, { loc: IstanbulRange; type: string; locations: IstanbulRange[] }>;
  s: Record<string, number>;
  f: Record<string, number>;
  b: Record<string, number[]>;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function relativize(filePath: string, rootDir: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const root = rootDir.replace(/\\/g, '/');

  // If the path starts with the rootDir, make it relative
  const rel = relative(resolve(rootDir), resolve(filePath));
  return rel.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// LCOV parser
// ---------------------------------------------------------------------------

export function parseLcov(content: string, rootDir: string): CoverageSignal {
  const files: CoverageFile[] = [];

  let currentFilePath: string | null = null;
  let lines: Map<number, number> = new Map();
  let fnDefs: Map<string, number> = new Map(); // name → line
  let fnCounts: Map<string, number> = new Map(); // name → count
  let branchesFound: number | null = null;
  let branchesHit: number | null = null;

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('SF:')) {
      currentFilePath = relativize(trimmed.slice(3), rootDir);
      lines = new Map();
      fnDefs = new Map();
      fnCounts = new Map();
      branchesFound = null;
      branchesHit = null;
    } else if (trimmed.startsWith('FN:') && currentFilePath !== null) {
      const comma = trimmed.indexOf(',', 3);
      if (comma !== -1) {
        const lineNum = parseInt(trimmed.slice(3, comma), 10);
        const name = trimmed.slice(comma + 1);
        fnDefs.set(name, lineNum);
      }
    } else if (trimmed.startsWith('FNDA:') && currentFilePath !== null) {
      const comma = trimmed.indexOf(',', 5);
      if (comma !== -1) {
        const count = parseInt(trimmed.slice(5, comma), 10);
        const name = trimmed.slice(comma + 1);
        fnCounts.set(name, count);
      }
    } else if (trimmed.startsWith('DA:') && currentFilePath !== null) {
      const parts = trimmed.slice(3).split(',');
      if (parts.length >= 2) {
        const lineNum = parseInt(parts[0], 10);
        const count = parseInt(parts[1], 10);
        lines.set(lineNum, count);
      }
    } else if (trimmed.startsWith('BRF:') && currentFilePath !== null) {
      branchesFound = parseInt(trimmed.slice(4), 10);
    } else if (trimmed.startsWith('BRH:') && currentFilePath !== null) {
      branchesHit = parseInt(trimmed.slice(4), 10);
    } else if (trimmed === 'end_of_record' && currentFilePath !== null) {
      const functions: CoverageFileFunction[] = [];
      for (const [name, line] of fnDefs) {
        functions.push({
          name,
          line,
          executionCount: fnCounts.get(name) ?? 0,
        });
      }

      files.push({
        filePath: currentFilePath,
        linesCovered: [...lines.values()].filter((c) => c > 0).length,
        linesTotal: lines.size,
        branchesCovered: branchesHit,
        branchesTotal: branchesFound,
        functions,
      });

      currentFilePath = null;
    }
  }

  return {
    source: { tool: 'lcov', format: 'lcov', version: '1.0' },
    files,
  };
}

// ---------------------------------------------------------------------------
// Istanbul parser
// ---------------------------------------------------------------------------

export function parseIstanbul(content: string, rootDir: string): CoverageSignal {
  const raw = JSON.parse(content) as Record<string, IstanbulFileCoverage>;
  const files: CoverageFile[] = [];

  for (const entry of Object.values(raw)) {
    const filePath = relativize(entry.path, rootDir);

    // Statements → line coverage
    const stmtKeys = Object.keys(entry.s);
    const linesTotal = stmtKeys.length;
    const linesCovered = stmtKeys.filter((k) => entry.s[k] > 0).length;

    // Branches
    const branchEntries = Object.keys(entry.b);
    let branchesTotal: number | null = null;
    let branchesCovered: number | null = null;
    if (branchEntries.length > 0) {
      branchesTotal = 0;
      branchesCovered = 0;
      for (const counts of Object.values(entry.b)) {
        for (const count of counts) {
          branchesTotal++;
          if (count > 0) branchesCovered++;
        }
      }
    }

    // Functions
    const functions: CoverageFileFunction[] = [];
    for (const [key, fnEntry] of Object.entries(entry.fnMap)) {
      functions.push({
        name: fnEntry.name,
        line: fnEntry.decl.start.line,
        executionCount: entry.f[key] ?? 0,
      });
    }

    files.push({
      filePath,
      linesCovered,
      linesTotal,
      branchesCovered,
      branchesTotal,
      functions,
    });
  }

  return {
    source: { tool: 'istanbul', format: 'istanbul', version: '1.0' },
    files,
  };
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function detectFormat(coveragePath: string): 'lcov' | 'istanbul' {
  if (coveragePath.endsWith('.json')) return 'istanbul';
  return 'lcov';
}

// ---------------------------------------------------------------------------
// Public: run the full adapter
// ---------------------------------------------------------------------------

export async function runCoverageAdapter(
  options: CoverageAdapterOptions,
): Promise<CoverageResult> {
  const start = Date.now();
  const warnings: string[] = [];

  const rootDir = resolve(options.rootDir);
  const coveragePath = resolve(options.coveragePath);
  const format = options.format ?? detectFormat(coveragePath);

  let content: string;
  try {
    content = await readFile(coveragePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read coverage file at ${coveragePath}: ${String(err)}`,
    );
  }

  let signal: CoverageSignal;
  if (format === 'lcov') {
    signal = parseLcov(content, rootDir);
  } else {
    signal = parseIstanbul(content, rootDir);
  }

  const duration = Date.now() - start;
  const tool = format === 'lcov' ? 'lcov' : 'istanbul';

  return {
    coverageSignals: [signal],
    toolRun: {
      tool,
      version: '1.0',
      aspect: 'coverage',
      exitCode: 0,
      duration,
      warnings,
    },
  };
}
