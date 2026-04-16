// Tests for eslint adapter I/O functions (runEslintAdapter and helpers)

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { runEslintAdapter } from './eslint.js';
import type { EslintRawOutput } from './eslint.js';

const mockExecFile = vi.mocked(execFile);
const mockAccess = vi.mocked(access);

function mockExecFileResponses(
  responses: Array<{
    stdout?: string;
    stderr?: string;
    error?: (Error & { code?: number | string }) | null;
  }>,
) {
  let callIndex = 0;
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const resp = responses[callIndex++] ?? {};
    cb(resp.error ?? null, resp.stdout ?? '', resp.stderr ?? '');
    return {} as ReturnType<typeof execFile>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockRejectedValue(new Error('ENOENT'));
});

describe('runEslintAdapter', () => {
  it('runs eslint and returns normalized results', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);

    const rawOutput: EslintRawOutput[] = [
      {
        filePath: '/root/src/app.ts',
        messages: [
          { ruleId: 'no-var', severity: 2, message: 'Use let', line: 1, column: 1, endLine: 1, endColumn: 4 },
        ],
        suppressedMessages: [],
        errorCount: 1,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
      },
    ];

    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: JSON.stringify(rawOutput) },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.toolRun.tool).toBe('eslint');
    expect(result.toolRun.version).toBe('9.0.0');
    expect(result.toolRun.aspect).toBe('lint');
    expect(result.toolRun.exitCode).toBe(0);
    expect(typeof result.toolRun.duration).toBe('number');
    expect(result.lintSignals).toHaveLength(1);
    expect(result.lintSignals[0].results).toHaveLength(1);
    expect(result.lintSignals[0].results[0].ruleId).toBe('no-var');
  });

  it('passes --config when configPath is provided', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]' },
    ]);

    await runEslintAdapter({ rootDir: '/root', configPath: '/root/.eslintrc.json' });

    const eslintArgs = mockExecFile.mock.calls[1]![1] as string[];
    expect(eslintArgs).toContain('--config');
    expect(eslintArgs).toContain('/root/.eslintrc.json');
  });

  it('passes extraArgs to eslint CLI', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]' },
    ]);

    await runEslintAdapter({ rootDir: '/root', extraArgs: ['--max-warnings', '0'] });

    const eslintArgs = mockExecFile.mock.calls[1]![1] as string[];
    expect(eslintArgs).toContain('--max-warnings');
    expect(eslintArgs).toContain('0');
  });

  it('passes source patterns when provided', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]' },
    ]);

    await runEslintAdapter({ rootDir: '/root', patterns: ['src/**/*.ts'] });

    const eslintArgs = mockExecFile.mock.calls[1]![1] as string[];
    expect(eslintArgs).toContain('src/**/*.ts');
    expect(eslintArgs).not.toContain('.');
  });

  it('defaults to "." when no patterns given', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]' },
    ]);

    await runEslintAdapter({ rootDir: '/root' });

    const eslintArgs = mockExecFile.mock.calls[1]![1] as string[];
    expect(eslintArgs).toContain('.');
  });

  it('collects stderr as warnings', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]', stderr: 'Some deprecation warning\n' },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.toolRun.warnings).toContain('Some deprecation warning');
  });

  it('records exit code 2 as config error warning', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    const err = Object.assign(new Error('config'), { code: 2 });
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]', error: err },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.toolRun.exitCode).toBe(2);
    expect(result.toolRun.warnings).toContainEqual(
      expect.stringContaining('code 2'),
    );
  });

  it('returns empty signals on JSON parse failure', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: 'NOT VALID JSON' },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.lintSignals).toEqual([]);
    expect(result.toolRun.warnings).toContainEqual(
      expect.stringContaining('Failed to parse'),
    );
  });

  it('falls back to first candidate binary when neither is accessible', async () => {
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]' },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.toolRun.tool).toBe('eslint');
    expect(mockAccess).toHaveBeenCalledTimes(2);
  });

  it('finds .cmd binary when first candidate is not accessible', async () => {
    mockAccess
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(undefined as never);

    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]' },
    ]);

    await runEslintAdapter({ rootDir: '/root' });

    const binaryUsed = mockExecFile.mock.calls[0]![0] as string;
    expect(binaryUsed).toMatch(/eslint\.cmd$/);
  });

  it('handles error with non-numeric code', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    const err = Object.assign(new Error('SIGTERM'), { code: 'SIGTERM' as unknown as number });
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]', error: err },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.toolRun.exitCode).toBe(1);
  });

  it('uses "default" as ruleSet when no configPath', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      {
        stdout: JSON.stringify([
          {
            filePath: '/root/src/a.ts',
            messages: [{ ruleId: 'semi', severity: 1, message: 'Missing', line: 1, column: 1 }],
            suppressedMessages: [],
            errorCount: 0,
            warningCount: 1,
            fixableErrorCount: 0,
            fixableWarningCount: 0,
          },
        ] satisfies EslintRawOutput[]),
      },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.lintSignals[0].source.ruleSet).toBe('default');
  });

  it('uses configPath as ruleSet when provided', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      {
        stdout: JSON.stringify([
          {
            filePath: '/root/src/a.ts',
            messages: [{ ruleId: 'semi', severity: 1, message: 'Missing', line: 1, column: 1 }],
            suppressedMessages: [],
            errorCount: 0,
            warningCount: 1,
            fixableErrorCount: 0,
            fixableWarningCount: 0,
          },
        ] satisfies EslintRawOutput[]),
      },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root', configPath: '/custom/.eslintrc' });

    expect(result.lintSignals[0].source.ruleSet).toBe('/custom/.eslintrc');
  });

  it('strips leading v from version string', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    mockExecFileResponses([
      { stdout: 'v8.56.0\n' },
      { stdout: '[]' },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.toolRun.version).toBe('8.56.0');
  });

  it('handles exit code 1 (lint errors found) as normal', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    const err = Object.assign(new Error('Lint errors'), { code: 1 });
    const rawOutput: EslintRawOutput[] = [
      {
        filePath: '/root/src/a.ts',
        messages: [
          { ruleId: 'no-unused-vars', severity: 2, message: 'Unused', line: 5, column: 10 },
        ],
        suppressedMessages: [],
        errorCount: 1,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
      },
    ];
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: JSON.stringify(rawOutput), error: err },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.toolRun.exitCode).toBe(1);
    expect(result.lintSignals).toHaveLength(1);
    expect(result.lintSignals[0].results).toHaveLength(1);
  });

  it('combines stderr warning with exit code 2 warning', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);
    const err = Object.assign(new Error('config'), { code: 2 });
    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]', stderr: 'Oops: cannot read config file\n', error: err },
    ]);

    const result = await runEslintAdapter({ rootDir: '/root' });

    expect(result.toolRun.warnings).toHaveLength(2);
    expect(result.toolRun.warnings[0]).toContain('cannot read config file');
    expect(result.toolRun.warnings[1]).toContain('code 2');
  });

  it('finds first binary when it is accessible', async () => {
    mockAccess.mockResolvedValueOnce(undefined as never);

    mockExecFileResponses([
      { stdout: 'v9.0.0\n' },
      { stdout: '[]' },
    ]);

    await runEslintAdapter({ rootDir: '/root' });

    // Only the first access should be called (not the .cmd variant)
    expect(mockAccess).toHaveBeenCalledTimes(1);
    const binaryUsed = mockExecFile.mock.calls[0]![0] as string;
    expect(binaryUsed).not.toMatch(/\.cmd$/);
  });
});
