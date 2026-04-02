// Tests for dependency-cruiser adapter I/O functions (runDepCruiserAdapter and helpers)

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCruise = vi.fn();

vi.mock('dependency-cruiser', () => ({
  cruise: mockCruise,
}));

const mockRequireFunc = vi.fn();

vi.mock('node:module', () => ({
  createRequire: vi.fn(() => mockRequireFunc),
}));

const mockReaddirSync = vi.fn();

vi.mock('node:fs', () => ({
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  existsSync: vi.fn(() => false),
}));

import { runDepCruiserAdapter, type DepCruiserRawOutput } from './dep-cruiser.js';

function createMockRawOutput(overrides?: Partial<DepCruiserRawOutput>): DepCruiserRawOutput {
  return {
    modules: [
      {
        source: 'src/index.ts',
        dependencies: [
          {
            module: './service',
            resolved: 'src/service.ts',
            coreModule: false,
            dependencyTypes: ['local'],
            moduleSystem: 'es6',
            dynamic: false,
            exoticallyRequired: false,
            circular: false,
            valid: true,
            followable: true,
          },
        ],
      },
      {
        source: 'src/service.ts',
        dependencies: [],
      },
    ],
    summary: {
      violations: [],
      totalCruised: 2,
      totalDependenciesCruised: 1,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReaddirSync.mockReturnValue(['index.ts', 'service.ts']);
  mockRequireFunc.mockImplementation((specifier: string) => {
    if (specifier === 'dependency-cruiser/package.json') {
      return { version: '16.5.0' };
    }
    throw new Error(`Cannot find module '${specifier}'`);
  });
});

describe('runDepCruiserAdapter', () => {
  it('runs dep-cruiser and returns entities and relationships', async () => {
    const raw = createMockRawOutput();
    mockCruise.mockResolvedValueOnce({ output: JSON.stringify(raw) });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.entities).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.toolRun.tool).toBe('dependency-cruiser');
    expect(result.toolRun.version).toBe('16.5.0');
    expect(result.toolRun.aspect).toBe('dependencyGraph');
    expect(result.toolRun.exitCode).toBe(0);
    expect(typeof result.toolRun.duration).toBe('number');
  });

  it('passes file paths from custom srcDirs to cruise', async () => {
    mockCruise.mockResolvedValueOnce({
      output: JSON.stringify(createMockRawOutput()),
    });

    await runDepCruiserAdapter({
      rootDir: '/project',
      srcDirs: ['src', 'lib'],
    });

    const firstArg = mockCruise.mock.calls[0]![0] as string[];
    expect(firstArg).toEqual(expect.arrayContaining([
      'src/index.ts', 'src/service.ts',
      'lib/index.ts', 'lib/service.ts',
    ]));
    expect(firstArg).toHaveLength(4);
  });

  it('defaults to ["src"] when no srcDirs specified', async () => {
    mockCruise.mockResolvedValueOnce({
      output: JSON.stringify(createMockRawOutput()),
    });

    await runDepCruiserAdapter({ rootDir: '/project' });

    const firstArg = mockCruise.mock.calls[0]![0] as string[];
    expect(firstArg).toEqual(['src/index.ts', 'src/service.ts']);
  });

  it('forwards cruiseOptions', async () => {
    mockCruise.mockResolvedValueOnce({
      output: JSON.stringify(createMockRawOutput()),
    });

    await runDepCruiserAdapter({
      rootDir: '/project',
      cruiseOptions: { tsPreCompilationDeps: true },
    });

    expect(mockCruise).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        outputType: 'json',
        baseDir: '/project',
        tsPreCompilationDeps: true,
      }),
      undefined,
      undefined,
    );
  });

  it('handles object output from cruise (not string)', async () => {
    const raw = createMockRawOutput();
    mockCruise.mockResolvedValueOnce({ output: raw });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.entities).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
  });

  it('extracts circular dependency warnings', async () => {
    const raw = createMockRawOutput({
      modules: [
        {
          source: 'src/a.ts',
          dependencies: [
            {
              module: './b',
              resolved: 'src/b.ts',
              coreModule: false,
              dependencyTypes: ['local'],
              moduleSystem: 'es6',
              dynamic: false,
              exoticallyRequired: false,
              circular: true,
              valid: true,
              followable: true,
            },
          ],
        },
        {
          source: 'src/b.ts',
          dependencies: [
            {
              module: './a',
              resolved: 'src/a.ts',
              coreModule: false,
              dependencyTypes: ['local'],
              moduleSystem: 'es6',
              dynamic: false,
              exoticallyRequired: false,
              circular: true,
              valid: true,
              followable: true,
            },
          ],
        },
      ],
      summary: {
        violations: [
          {
            type: 'cycle',
            from: 'src/a.ts',
            to: 'src/b.ts',
            rule: { severity: 'warn', name: 'no-circular' },
          },
        ],
        totalCruised: 2,
        totalDependenciesCruised: 2,
      },
    });
    mockCruise.mockResolvedValueOnce({ output: JSON.stringify(raw) });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.toolRun.warnings).toContainEqual(
      expect.stringContaining('circular dependency'),
    );
  });

  it('extracts non-cycle violation warnings', async () => {
    const raw = createMockRawOutput({
      summary: {
        violations: [
          {
            type: 'dependency',
            from: 'src/a.ts',
            to: 'src/b.ts',
            rule: { severity: 'warn', name: 'not-to-dev-dep' },
          },
        ],
        totalCruised: 2,
        totalDependenciesCruised: 1,
      },
    });
    mockCruise.mockResolvedValueOnce({ output: JSON.stringify(raw) });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.toolRun.warnings).toContainEqual(
      expect.stringContaining('not-to-dev-dep'),
    );
  });

  it('skips cycle violations in warning extraction (captured as circular deps)', async () => {
    const raw = createMockRawOutput({
      summary: {
        violations: [
          {
            type: 'cycle',
            from: 'src/a.ts',
            to: 'src/b.ts',
            rule: { severity: 'warn', name: 'no-circular' },
          },
          {
            type: 'dependency',
            from: 'src/c.ts',
            to: 'src/d.ts',
            rule: { severity: 'warn', name: 'not-to-dev-dep' },
          },
        ],
        totalCruised: 4,
        totalDependenciesCruised: 2,
      },
    });
    mockCruise.mockResolvedValueOnce({ output: JSON.stringify(raw) });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    const nonCircularWarnings = result.toolRun.warnings.filter(
      (w) => w.includes('not-to-dev-dep'),
    );
    expect(nonCircularWarnings).toHaveLength(1);

    // cycle-type violations should NOT appear as violation warnings
    const cycleViolationWarnings = result.toolRun.warnings.filter(
      (w) => w.includes('no-circular:'),
    );
    expect(cycleViolationWarnings).toHaveLength(0);
  });

  it('sets exitCode 1 when error-severity violations exist', async () => {
    const raw = createMockRawOutput({
      summary: {
        violations: [
          {
            type: 'dependency',
            from: 'src/a.ts',
            to: 'src/b.ts',
            rule: { severity: 'error', name: 'no-restricted' },
          },
        ],
        totalCruised: 2,
        totalDependenciesCruised: 1,
      },
    });
    mockCruise.mockResolvedValueOnce({ output: JSON.stringify(raw) });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.toolRun.exitCode).toBe(1);
  });

  it('sets exitCode 0 when no error-severity violations', async () => {
    const raw = createMockRawOutput({
      summary: {
        violations: [
          {
            type: 'dependency',
            from: 'src/a.ts',
            to: 'src/b.ts',
            rule: { severity: 'warn', name: 'no-orphans' },
          },
        ],
        totalCruised: 2,
        totalDependenciesCruised: 1,
      },
    });
    mockCruise.mockResolvedValueOnce({ output: JSON.stringify(raw) });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.toolRun.exitCode).toBe(0);
  });

  it('forwards moduleBoundaries to normalizeDepCruiserOutput', async () => {
    const raw = createMockRawOutput();
    mockCruise.mockResolvedValueOnce({ output: JSON.stringify(raw) });

    const result = await runDepCruiserAdapter({
      rootDir: '/project',
      moduleBoundaries: [
        { moduleId: 'core', modulePath: 'src' },
      ],
    });

    expect(result.entities).toHaveLength(2);
  });

  it('returns version "unknown" when createRequire fails', async () => {
    mockRequireFunc.mockImplementation(() => {
      throw new Error('module not found');
    });

    mockCruise.mockResolvedValueOnce({
      output: JSON.stringify(createMockRawOutput()),
    });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.toolRun.version).toBe('unknown');
  });

  it('measures duration in toolRun', async () => {
    mockCruise.mockResolvedValueOnce({
      output: JSON.stringify(createMockRawOutput()),
    });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.toolRun.duration).toBeGreaterThanOrEqual(0);
  });

  it('handles empty modules array', async () => {
    const raw = createMockRawOutput({
      modules: [],
      summary: {
        violations: [],
        totalCruised: 0,
        totalDependenciesCruised: 0,
      },
    });
    mockCruise.mockResolvedValueOnce({ output: JSON.stringify(raw) });

    const result = await runDepCruiserAdapter({ rootDir: '/project' });

    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
    expect(result.toolRun.exitCode).toBe(0);
    expect(result.toolRun.warnings).toHaveLength(0);
  });
});
