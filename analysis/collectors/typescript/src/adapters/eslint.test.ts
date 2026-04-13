// @aspect/collector-typescript — eslint adapter tests

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEslintOutput } from './eslint.js';
import type { EslintRawOutput } from './eslint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..', '__fixtures__', 'eslint-output.json');
const ROOT_DIR = '/projects/my-app';

async function loadFixture(): Promise<EslintRawOutput[]> {
  const raw = await readFile(FIXTURE_PATH, 'utf-8');
  return JSON.parse(raw) as EslintRawOutput[];
}

describe('normalizeEslintOutput', () => {
  // -------------------------------------------------------------------
  // Fixture-based normalization
  // -------------------------------------------------------------------

  it('produces a valid LintSignal from the fixture', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    expect(signal.source).toEqual({
      tool: 'eslint',
      version: '9.17.0',
      ruleSet: 'default',
    });

    // Fixture has: 3 + 3 + 2 messages across 3 files with issues,
    // minus 1 null-ruleId message = 7 results
    expect(signal.results).toHaveLength(7);
  });

  // -------------------------------------------------------------------
  // Severity mapping
  // -------------------------------------------------------------------

  it('maps eslint severity 2 to "error"', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    const noUnusedVars = signal.results.find((r) => r.ruleId === 'no-unused-vars');
    expect(noUnusedVars).toBeDefined();
    expect(noUnusedVars!.severity).toBe('error');
  });

  it('maps eslint severity 1 to "warning"', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    const noConsole = signal.results.find((r) => r.ruleId === 'no-console');
    expect(noConsole).toBeDefined();
    expect(noConsole!.severity).toBe('warning');
  });

  // -------------------------------------------------------------------
  // File path relativization
  // -------------------------------------------------------------------

  it('converts absolute file paths to rootDir-relative paths with forward slashes', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    const paths = [...new Set(signal.results.map((r) => r.filePath))];
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/utils/helpers.ts');
    expect(paths).toContain('src/components/Button.tsx');

    // No absolute paths should remain
    for (const r of signal.results) {
      expect(r.filePath).not.toMatch(/^\//);
      expect(r.filePath).not.toContain('\\');
    }
  });

  it('handles Windows-style rootDir and paths', () => {
    const raw: EslintRawOutput[] = [
      {
        filePath: 'C:\\Users\\dev\\project\\src\\app.ts',
        messages: [
          {
            ruleId: 'no-var',
            severity: 2,
            message: 'Unexpected var, use let or const instead.',
            line: 1,
            column: 1,
            endLine: 1,
            endColumn: 4,
          },
        ],
        suppressedMessages: [],
        errorCount: 1,
        warningCount: 0,
        fixableErrorCount: 1,
        fixableWarningCount: 0,
      },
    ];

    const signal = normalizeEslintOutput(raw, 'C:\\Users\\dev\\project', '9.17.0', 'default');
    expect(signal.results[0].filePath).toBe('src/app.ts');
  });

  // -------------------------------------------------------------------
  // Null ruleId handling
  // -------------------------------------------------------------------

  it('skips messages where ruleId is null', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    // The fixture has one message with null ruleId — it must not appear
    const nullRuleIds = signal.results.filter((r) => r.ruleId === null || r.ruleId === undefined);
    expect(nullRuleIds).toHaveLength(0);
  });

  it('skips only the null-ruleId message and keeps others from the same file', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    // src/index.ts has 3 messages, one with null ruleId → 2 results
    const indexResults = signal.results.filter((r) => r.filePath === 'src/index.ts');
    expect(indexResults).toHaveLength(2);
  });

  // -------------------------------------------------------------------
  // End location handling
  // -------------------------------------------------------------------

  it('includes endLine/endColumn when present', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    const withEnd = signal.results.find((r) => r.ruleId === 'no-unused-vars');
    expect(withEnd).toBeDefined();
    expect(withEnd!.endLine).toBe(3);
    expect(withEnd!.endColumn).toBe(10);
  });

  it('returns null for endLine/endColumn when not present in raw output', () => {
    const raw: EslintRawOutput[] = [
      {
        filePath: '/projects/my-app/src/loose.ts',
        messages: [
          {
            ruleId: 'semi',
            severity: 1,
            message: 'Missing semicolon.',
            line: 5,
            column: 20,
            // no endLine / endColumn
          },
        ],
        suppressedMessages: [],
        errorCount: 0,
        warningCount: 1,
        fixableErrorCount: 0,
        fixableWarningCount: 1,
      },
    ];

    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');
    expect(signal.results[0].endLine).toBeNull();
    expect(signal.results[0].endColumn).toBeNull();
  });

  // -------------------------------------------------------------------
  // Empty results
  // -------------------------------------------------------------------

  it('returns empty results array when all files have no issues', () => {
    const raw: EslintRawOutput[] = [
      {
        filePath: '/projects/my-app/src/clean.ts',
        messages: [],
        suppressedMessages: [],
        errorCount: 0,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
      },
    ];

    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');
    expect(signal.results).toEqual([]);
  });

  it('returns empty results for an empty eslint output array', () => {
    const signal = normalizeEslintOutput([], ROOT_DIR, '9.17.0', 'default');
    expect(signal.results).toEqual([]);
    expect(signal.source.tool).toBe('eslint');
  });

  // -------------------------------------------------------------------
  // Multiple files
  // -------------------------------------------------------------------

  it('includes results from all files that have issues', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    const fileSet = new Set(signal.results.map((r) => r.filePath));
    // 3 files have issues; types.ts has none
    expect(fileSet.size).toBe(3);
    expect(fileSet.has('src/types.ts')).toBe(false);
  });

  // -------------------------------------------------------------------
  // Rule ID preservation
  // -------------------------------------------------------------------

  it('preserves complex rule IDs exactly', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    const ruleIds = signal.results.map((r) => r.ruleId);
    expect(ruleIds).toContain('@typescript-eslint/no-explicit-any');
    expect(ruleIds).toContain('@typescript-eslint/no-floating-promises');
    expect(ruleIds).toContain('react/jsx-no-target-blank');
    expect(ruleIds).toContain('no-unused-vars');
    expect(ruleIds).toContain('eqeqeq');
  });

  // -------------------------------------------------------------------
  // Source metadata
  // -------------------------------------------------------------------

  it('propagates version and ruleSet into source', () => {
    const signal = normalizeEslintOutput([], ROOT_DIR, '8.56.0', '/path/to/.eslintrc.json');
    expect(signal.source).toEqual({
      tool: 'eslint',
      version: '8.56.0',
      ruleSet: '/path/to/.eslintrc.json',
    });
  });

  // -------------------------------------------------------------------
  // Line / column accuracy
  // -------------------------------------------------------------------

  it('preserves line and column numbers exactly', async () => {
    const raw = await loadFixture();
    const signal = normalizeEslintOutput(raw, ROOT_DIR, '9.17.0', 'default');

    const floatingPromise = signal.results.find(
      (r) => r.ruleId === '@typescript-eslint/no-floating-promises',
    );
    expect(floatingPromise).toBeDefined();
    expect(floatingPromise!.line).toBe(35);
    expect(floatingPromise!.column).toBe(3);
  });
});
