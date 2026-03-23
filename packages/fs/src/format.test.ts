import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findFormatters,
  formatFile,
  initFormatOnWrite,
  getFormatterStatus,
  type FormatterInfo,
} from './format.js';
import {
  emitFileEdited,
  removeAllFileEventListeners,
} from './file-events.js';

// Mock child_process.execFile so formatFile never actually spawns.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execFile } from 'node:child_process';
const mockExecFile = vi.mocked(execFile);

// Mock which so we control which formatters appear enabled.
vi.mock('./which.js', () => ({
  which: vi.fn(() => null),
  clearWhichCache: vi.fn(),
}));

import { which } from './which.js';
const mockWhich = vi.mocked(which);

beforeEach(() => {
  removeAllFileEventListeners();
  mockExecFile.mockReset();
  mockWhich.mockReset();
  mockWhich.mockReturnValue(null);
});

// ─── Test formatters ──────────────────────────────────────────────────────────

const fakePrettier: FormatterInfo = {
  name: 'fake-prettier',
  command: ['prettier', '--write', '$FILE'],
  extensions: ['.ts', '.js'],
  enabled: () => true,
};

const fakeGofmt: FormatterInfo = {
  name: 'fake-gofmt',
  command: ['gofmt', '-w', '$FILE'],
  extensions: ['.go'],
  enabled: () => true,
};

const disabledFormatter: FormatterInfo = {
  name: 'disabled',
  command: ['nope', '$FILE'],
  extensions: ['.ts'],
  enabled: () => false,
};

const testFormatters: FormatterInfo[] = [fakePrettier, fakeGofmt, disabledFormatter];

// ─── findFormatters ───────────────────────────────────────────────────────────

describe('findFormatters', () => {
  it('returns matching enabled formatters by extension', () => {
    const result = findFormatters('/project/src/app.ts', testFormatters);
    expect(result.map(f => f.name)).toEqual(['fake-prettier']);
  });

  it('returns empty array for unknown extensions', () => {
    expect(findFormatters('/project/src/data.bin', testFormatters)).toEqual([]);
  });

  it('excludes disabled formatters', () => {
    const result = findFormatters('/project/src/app.ts', testFormatters);
    expect(result.map(f => f.name)).not.toContain('disabled');
  });

  it('returns empty array for files without extensions', () => {
    expect(findFormatters('/project/Makefile', testFormatters)).toEqual([]);
  });
});

// ─── formatFile ───────────────────────────────────────────────────────────────

describe('formatFile', () => {
  it('returns formatted: false when no formatter matches', async () => {
    const result = await formatFile('/project/data.bin', testFormatters);
    expect(result).toEqual({ formatted: false });
  });

  it('spawns the formatter with $FILE replaced and returns success', async () => {
    // Make execFile call the callback with no error.
    mockExecFile.mockImplementation((_bin, _args, _opts, cb: any) => {
      cb(null, '', '');
      return {} as any;
    });

    const result = await formatFile('/project/src/app.ts', testFormatters);
    expect(result).toEqual({ formatted: true, formatter: 'fake-prettier' });
    expect(mockExecFile).toHaveBeenCalledWith(
      'prettier',
      ['--write', '/project/src/app.ts'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns error when formatter fails', async () => {
    mockExecFile.mockImplementation((_bin, _args, _opts, cb: any) => {
      cb(new Error('formatter crashed'), '', '');
      return {} as any;
    });

    const result = await formatFile('/project/src/app.ts', testFormatters);
    expect(result.formatted).toBe(false);
    expect(result.formatter).toBe('fake-prettier');
    expect(result.error).toContain('formatter crashed');
  });
});

// ─── initFormatOnWrite ────────────────────────────────────────────────────────

describe('initFormatOnWrite', () => {
  it('subscribes to file.edited events', async () => {
    mockExecFile.mockImplementation((_bin, _args, _opts, cb: any) => {
      cb(null, '', '');
      return {} as any;
    });

    const dispose = initFormatOnWrite(testFormatters);

    emitFileEdited('/project/src/app.ts');

    // Give the fire-and-forget promise a tick to resolve.
    await new Promise((r) => setTimeout(r, 10));

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('dispose stops responding to events', async () => {
    mockExecFile.mockImplementation((_bin, _args, _opts, cb: any) => {
      cb(null, '', '');
      return {} as any;
    });

    const dispose = initFormatOnWrite(testFormatters);
    dispose();

    emitFileEdited('/project/src/app.ts');
    await new Promise((r) => setTimeout(r, 10));

    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

// ─── getFormatterStatus ───────────────────────────────────────────────────────

describe('getFormatterStatus', () => {
  it('returns enabled/disabled status of all formatters', () => {
    const status = getFormatterStatus(testFormatters);
    expect(status).toEqual([
      { name: 'fake-prettier', extensions: ['.ts', '.js'], enabled: true },
      { name: 'fake-gofmt', extensions: ['.go'], enabled: true },
      { name: 'disabled', extensions: ['.ts'], enabled: false },
    ]);
  });
});

// ─── BUILT_IN_FORMATTERS via which mock ───────────────────────────────────────

describe('BUILT_IN_FORMATTERS integration', () => {
  it('built-in prettier is disabled when prettier is not on PATH', async () => {
    mockWhich.mockReturnValue(null);
    const { BUILT_IN_FORMATTERS } = await import('./format.js');
    const prettier = BUILT_IN_FORMATTERS.find((f) => f.name === 'prettier');
    expect(prettier!.enabled()).toBe(false);
  });

  it('built-in prettier is enabled when which returns a path', async () => {
    mockWhich.mockReturnValue('/usr/bin/prettier');
    const { BUILT_IN_FORMATTERS } = await import('./format.js');
    const prettier = BUILT_IN_FORMATTERS.find((f) => f.name === 'prettier');
    expect(prettier!.enabled()).toBe(true);
  });
});
