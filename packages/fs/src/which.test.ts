import { describe, it, expect, vi, beforeEach } from 'vitest';
import { which, clearWhichCache } from './which.js';

// We mock child_process.execFileSync to avoid actually spawning processes.
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  clearWhichCache();
  mockExecFileSync.mockReset();
});

describe('which', () => {
  it('returns trimmed path when command is found', () => {
    mockExecFileSync.mockReturnValue('  /usr/bin/prettier  \n');
    expect(which('prettier')).toBe('/usr/bin/prettier');
  });

  it('returns first line when multiple lines (Windows "where")', () => {
    mockExecFileSync.mockReturnValue('C:\\tools\\node.exe\r\nC:\\other\\node.exe\r\n');
    expect(which('node')).toBe('C:\\tools\\node.exe');
  });

  it('returns null when command is not found (throws)', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
    expect(which('nonexistent')).toBeNull();
  });

  it('caches results across calls', () => {
    mockExecFileSync.mockReturnValue('/usr/bin/gofmt\n');
    which('gofmt');
    which('gofmt');
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('caches null results (negative cache)', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
    which('missing');
    which('missing');
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('clearWhichCache invalidates cached results', () => {
    mockExecFileSync.mockReturnValue('/usr/bin/ruff\n');
    which('ruff');
    clearWhichCache();
    which('ruff');
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it('uses "where" on win32 and "which" otherwise', () => {
    const originalPlatform = process.platform;
    // We can't easily change process.platform in a test, so just verify
    // the call was made with the correct lookup command for the current platform.
    mockExecFileSync.mockReturnValue('/usr/bin/test\n');
    which('test-cmd');
    const expectedCommand = originalPlatform === 'win32' ? 'where' : 'which';
    expect(mockExecFileSync).toHaveBeenCalledWith(
      expectedCommand,
      ['test-cmd'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });
});
