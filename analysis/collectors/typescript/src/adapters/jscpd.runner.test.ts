// Tests for jscpd adapter I/O functions (runJscpdAdapter and helpers)

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  access: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('node:module', () => ({
  createRequire: vi.fn(() => ({
    resolve: vi.fn(() => { throw new Error('not found'); }),
  })),
}));

import { execFile } from 'node:child_process';
import { readFile, mkdir, rm, access } from 'node:fs/promises';
import { runJscpdAdapter } from './jscpd.js';
import type { JscpdRawOutput } from './jscpd.js';

const mockExecFile = vi.mocked(execFile);
const mockReadFile = vi.mocked(readFile);
const mockMkdir = vi.mocked(mkdir);
const mockRm = vi.mocked(rm);
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

function createMockJscpdOutput(): JscpdRawOutput {
  return {
    duplicates: [
      {
        format: 'typescript',
        lines: 10,
        tokens: 80,
        firstFile: { name: 'src/a.ts', start: 1, end: 10 },
        secondFile: { name: 'src/b.ts', start: 20, end: 29 },
        fragment: 'duplicated code here',
      },
    ],
    statistics: {
      detectionDate: '2025-01-01T00:00:00.000Z',
      formats: {},
      total: {
        sources: 5,
        lines: 500,
        tokens: 4000,
        duplicatedLines: 10,
        duplicatedTokens: 80,
        clones: 1,
        percentage: '2.00',
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined as never);
  mockRm.mockResolvedValue(undefined as never);
  mockAccess.mockResolvedValue(undefined as never);
});

describe('runJscpdAdapter', () => {
  it('runs jscpd and returns normalized duplication signals', async () => {
    const mockOutput = createMockJscpdOutput();
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(mockOutput) as never);

    const result = await runJscpdAdapter({ rootDir: '/project' });

    expect(result.toolRun.tool).toBe('jscpd');
    expect(result.toolRun.version).toBe('4.0.5');
    expect(result.toolRun.aspect).toBe('duplication');
    expect(typeof result.toolRun.duration).toBe('number');
    expect(result.duplicationSignals).toHaveLength(1);
    expect(result.duplicationSignals[0].clones).toHaveLength(1);
  });

  it('creates output directory before running', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    await runJscpdAdapter({ rootDir: '/project' });

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('.jscpd-report'),
      { recursive: true },
    );
  });

  it('cleans up report directory after reading', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    await runJscpdAdapter({ rootDir: '/project' });

    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('.jscpd-report'),
      { recursive: true, force: true },
    );
  });

  it('adds warning when version detection fails', async () => {
    mockExecFileResponses([
      { error: new Error('not found') as Error & { code?: number } },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    const result = await runJscpdAdapter({ rootDir: '/project' });

    expect(result.toolRun.version).toBe('unknown');
    expect(result.toolRun.warnings).toContainEqual(
      expect.stringContaining('Could not determine jscpd version'),
    );
  });

  it('records stderr as warnings', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      { stderr: 'jscpd warning message\n' },
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    const result = await runJscpdAdapter({ rootDir: '/project' });

    expect(result.toolRun.warnings).toContain('jscpd warning message');
  });

  it('throws when report file does not exist', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    await expect(runJscpdAdapter({ rootDir: '/project' }))
      .rejects.toThrow(/jscpd did not produce a report/);
  });

  it('throws when report file cannot be parsed', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce('not json' as never);

    await expect(runJscpdAdapter({ rootDir: '/project' }))
      .rejects.toThrow(/Failed to read jscpd report/);
  });

  it('includes stderr in error when report is missing', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      { stderr: 'Error: cannot find tsconfig\n' },
    ]);
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    await expect(runJscpdAdapter({ rootDir: '/project' }))
      .rejects.toThrow(/cannot find tsconfig/);
  });

  it('adds warning when cleanup fails but does not throw', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);
    mockRm.mockRejectedValueOnce(new Error('EPERM'));

    const result = await runJscpdAdapter({ rootDir: '/project' });

    expect(result.toolRun.warnings).toContainEqual(
      expect.stringContaining('Could not clean up'),
    );
  });

  it('passes custom minTokens and minLines', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    await runJscpdAdapter({
      rootDir: '/project',
      minTokens: 100,
      minLines: 10,
    });

    const cliArgs = mockExecFile.mock.calls[1]![1] as string[];
    const minTokensIdx = cliArgs.indexOf('--min-tokens');
    expect(cliArgs[minTokensIdx + 1]).toBe('100');
    const minLinesIdx = cliArgs.indexOf('--min-lines');
    expect(cliArgs[minLinesIdx + 1]).toBe('10');
  });

  it('uses custom include/exclude patterns', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    await runJscpdAdapter({
      rootDir: '/project',
      include: ['**/*.tsx'],
      exclude: ['**/vendor/**'],
    });

    const cliArgs = mockExecFile.mock.calls[1]![1] as string[];
    expect(cliArgs).toContain('**/*.tsx');
    expect(cliArgs).toContain('**/vendor/**');
  });

  it('uses default include/exclude when not specified', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    await runJscpdAdapter({ rootDir: '/project' });

    const cliArgs = mockExecFile.mock.calls[1]![1] as string[];
    expect(cliArgs).toContain('**/*.ts');
    expect(cliArgs).toContain('**/*.tsx');
    expect(cliArgs).toContain('**/node_modules/**');
    expect(cliArgs).toContain('**/dist/**');
  });

  it('records CLI exit code', async () => {
    const err = Object.assign(new Error('duplicates found'), { code: 1 });
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      { error: err },
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    const result = await runJscpdAdapter({ rootDir: '/project' });

    expect(result.toolRun.exitCode).toBe(1);
  });

  it('handles non-numeric exit code from CLI', async () => {
    const err = Object.assign(new Error('signal'), { code: 'SIGKILL' as unknown as number });
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      { error: err },
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    const result = await runJscpdAdapter({ rootDir: '/project' });

    expect(result.toolRun.exitCode).toBe(1);
  });

  it('passes --silent flag and --reporters json', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    await runJscpdAdapter({ rootDir: '/project' });

    const cliArgs = mockExecFile.mock.calls[1]![1] as string[];
    expect(cliArgs).toContain('--silent');
    expect(cliArgs).toContain('--reporters');
    expect(cliArgs).toContain('json');
  });

  it('normalizes the duplication signal from raw output', async () => {
    const output = createMockJscpdOutput();
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(output) as never);

    const result = await runJscpdAdapter({ rootDir: '/project' });

    const signal = result.duplicationSignals[0];
    expect(signal.source.tool).toBe('jscpd');
    expect(signal.source.version).toBe('4.0.5');
    expect(signal.statistics.totalLines).toBe(500);
    expect(signal.statistics.duplicatedLines).toBe(10);
    expect(signal.clones[0].format).toBe('typescript');
  });

  it('uses default minTokens=50 and minLines=5', async () => {
    mockExecFileResponses([
      { stdout: '4.0.5\n' },
      {},
    ]);
    mockReadFile.mockResolvedValueOnce(JSON.stringify(createMockJscpdOutput()) as never);

    await runJscpdAdapter({ rootDir: '/project' });

    const cliArgs = mockExecFile.mock.calls[1]![1] as string[];
    const minTokensIdx = cliArgs.indexOf('--min-tokens');
    expect(cliArgs[minTokensIdx + 1]).toBe('50');
    const minLinesIdx = cliArgs.indexOf('--min-lines');
    expect(cliArgs[minLinesIdx + 1]).toBe('5');
  });
});
