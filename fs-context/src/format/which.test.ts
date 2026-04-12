import { describe, it, expect, vi, beforeEach } from 'vitest';
import { which, clearWhichCache } from './which.js';
import { promisify } from 'node:util';

// State shared between mock and test code.
const state = { stdout: '', reject: false, error: new Error('not found') };
let callCount = 0;
let lastArgs: any[] = [];

// vi.mock factory is hoisted above imports, so we use Symbol.for to reference
// util.promisify.custom without importing 'node:util' inside the factory.
const customSymbol = Symbol.for('nodejs.util.promisify.custom');

vi.mock('node:child_process', () => {
  const fn: any = vi.fn();
  fn[Symbol.for('nodejs.util.promisify.custom')] = async (...args: any[]) => {
    callCount++;
    lastArgs = args;
    if (state.reject) throw state.error;
    return { stdout: state.stdout, stderr: '' };
  };
  return { execFile: fn };
});

/** Helper: set promisified execFile to resolve with the given stdout. */
function setStdout(stdout: string) {
  state.reject = false;
  state.stdout = stdout;
}

/** Helper: set promisified execFile to reject with an error. */
function setError(msg = 'not found') {
  state.reject = true;
  state.error = new Error(msg);
}

beforeEach(() => {
  clearWhichCache();
  callCount = 0;
  lastArgs = [];
  state.stdout = '';
  state.reject = false;
});

describe('which', () => {
  it('returns trimmed path when command is found', async () => {
    setStdout('  /usr/bin/prettier  \n');
    expect(await which('prettier')).toBe('/usr/bin/prettier');
  });

  it('returns first line when multiple lines (Windows "where")', async () => {
    setStdout('C:\\tools\\node.exe\r\nC:\\other\\node.exe\r\n');
    expect(await which('node')).toBe('C:\\tools\\node.exe');
  });

  it('returns null when command is not found (throws)', async () => {
    setError();
    expect(await which('nonexistent')).toBeNull();
  });

  it('caches results across calls', async () => {
    setStdout('/usr/bin/gofmt\n');
    await which('gofmt');
    await which('gofmt');
    expect(callCount).toBe(1);
  });

  it('caches null results (negative cache)', async () => {
    setError();
    await which('missing');
    await which('missing');
    expect(callCount).toBe(1);
  });

  it('clearWhichCache invalidates cached results', async () => {
    setStdout('/usr/bin/ruff\n');
    await which('ruff');
    clearWhichCache();
    await which('ruff');
    expect(callCount).toBe(2);
  });

  it('uses "where" on win32 and "which" otherwise', async () => {
    const originalPlatform = process.platform;
    setStdout('/usr/bin/test\n');
    await which('test-cmd');
    const expectedCommand = originalPlatform === 'win32' ? 'where' : 'which';
    expect(lastArgs[0]).toBe(expectedCommand);
    expect(lastArgs[1]).toEqual(['test-cmd']);
  });
});
