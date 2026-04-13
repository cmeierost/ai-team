import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseLcov,
  parseIstanbul,
  runCoverageAdapter,
} from './coverage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '..', '__fixtures__');
const ROOT_DIR = '/projects/myapp';

async function loadLcovFixture(): Promise<string> {
  return readFile(join(fixturesDir, 'coverage-lcov.info'), 'utf-8');
}

async function loadIstanbulFixture(): Promise<string> {
  return readFile(join(fixturesDir, 'coverage-istanbul.json'), 'utf-8');
}

// ---------------------------------------------------------------------------
// LCOV parser
// ---------------------------------------------------------------------------

describe('parseLcov', () => {
  it('parses a simple single-file LCOV record', () => {
    const lcov = `SF:/root/src/file.ts
FN:1,hello
FNDA:3,hello
DA:1,3
DA:2,3
DA:3,0
DA:4,1
DA:5,0
LF:5
LH:3
end_of_record
`;
    const signal = parseLcov(lcov, '/root');
    expect(signal.files).toHaveLength(1);
    expect(signal.files[0].filePath).toBe('src/file.ts');
    expect(signal.files[0].linesTotal).toBe(5);
    expect(signal.files[0].linesCovered).toBe(3);
    expect(signal.files[0].functions).toHaveLength(1);
    expect(signal.files[0].functions[0]).toEqual({
      name: 'hello',
      line: 1,
      executionCount: 3,
    });
  });

  it('parses multiple files from fixture', async () => {
    const content = await loadLcovFixture();
    const signal = parseLcov(content, ROOT_DIR);
    expect(signal.files).toHaveLength(3);
  });

  it('skips FN lines without comma delimiter', () => {
    const lcov = `SF:/root/src/file.ts
FN:malformed_no_comma
DA:1,1
end_of_record
`;
    const signal = parseLcov(lcov, '/root');
    expect(signal.files[0].functions).toHaveLength(0);
  });

  it('skips FNDA lines without comma delimiter', () => {
    const lcov = `SF:/root/src/file.ts
FN:1,myFunc
FNDA:malformed_no_comma
DA:1,1
end_of_record
`;
    const signal = parseLcov(lcov, '/root');
    expect(signal.files[0].functions[0].executionCount).toBe(0);
  });

  it('skips DA lines with insufficient parts', () => {
    const lcov = `SF:/root/src/file.ts
DA:malformed
DA:1,3
end_of_record
`;
    const signal = parseLcov(lcov, '/root');
    expect(signal.files[0].linesTotal).toBe(1);
  });

  it('defaults function count to 0 when FNDA is missing for a function', () => {
    const lcov = `SF:/root/src/file.ts
FN:5,coveredFunc
FN:10,uncoveredFunc
FNDA:3,coveredFunc
DA:5,3
DA:10,0
end_of_record
`;
    const signal = parseLcov(lcov, '/root');
    const uncovered = signal.files[0].functions.find(f => f.name === 'uncoveredFunc');
    expect(uncovered).toBeDefined();
    expect(uncovered!.executionCount).toBe(0);
  });

  it('extracts correct line coverage counts', async () => {
    const content = await loadLcovFixture();
    const signal = parseLcov(content, ROOT_DIR);
    const userService = signal.files[0];
    expect(userService.linesTotal).toBe(40);
    expect(userService.linesCovered).toBe(30);
  });

  it('extracts branch coverage from BRF/BRH', async () => {
    const content = await loadLcovFixture();
    const signal = parseLcov(content, ROOT_DIR);
    const userService = signal.files[0];
    expect(userService.branchesTotal).toBe(6);
    expect(userService.branchesCovered).toBe(4);
  });

  it('returns null for branches when BRF/BRH absent', async () => {
    const content = await loadLcovFixture();
    const signal = parseLcov(content, ROOT_DIR);
    const indexFile = signal.files[2];
    expect(indexFile.branchesTotal).toBeNull();
    expect(indexFile.branchesCovered).toBeNull();
  });

  it('extracts function execution counts via FNDA', async () => {
    const content = await loadLcovFixture();
    const signal = parseLcov(content, ROOT_DIR);
    const userService = signal.files[0];
    expect(userService.functions).toHaveLength(3);

    const createUser = userService.functions.find((f) => f.name === 'createUser');
    expect(createUser).toEqual({ name: 'createUser', line: 5, executionCount: 12 });

    const deleteUser = userService.functions.find((f) => f.name === 'deleteUser');
    expect(deleteUser).toEqual({ name: 'deleteUser', line: 20, executionCount: 0 });
  });

  it('handles zero coverage (all counts = 0)', () => {
    const lcov = `SF:/root/src/dead.ts
DA:1,0
DA:2,0
DA:3,0
LF:3
LH:0
end_of_record
`;
    const signal = parseLcov(lcov, '/root');
    expect(signal.files[0].linesCovered).toBe(0);
    expect(signal.files[0].linesTotal).toBe(3);
  });

  it('relativizes absolute paths to rootDir', () => {
    const lcov = `SF:/projects/myapp/src/deep/nested/file.ts
DA:1,1
end_of_record
`;
    const signal = parseLcov(lcov, '/projects/myapp');
    expect(signal.files[0].filePath).toBe('src/deep/nested/file.ts');
  });

  it('returns empty files array for empty LCOV content', () => {
    const signal = parseLcov('', '/root');
    expect(signal.files).toEqual([]);
    expect(signal.source.format).toBe('lcov');
  });

  it('normalizes Windows backslash paths', () => {
    const lcov = `SF:C:\\projects\\myapp\\src\\file.ts
DA:1,5
DA:2,3
end_of_record
`;
    const signal = parseLcov(lcov, 'C:\\projects\\myapp');
    expect(signal.files[0].filePath).toBe('src/file.ts');
    expect(signal.files[0].filePath).not.toContain('\\');
  });

  it('handles duplicate function names (overloads)', () => {
    const lcov = `SF:/root/src/overloads.ts
FN:1,process
FN:10,process
FNDA:5,process
DA:1,5
end_of_record
`;
    const signal = parseLcov(lcov, '/root');
    // Map-based dedup: last FN wins for line, FNDA applies to that key
    expect(signal.files[0].functions).toHaveLength(1);
    expect(signal.files[0].functions[0].name).toBe('process');
    expect(signal.files[0].functions[0].executionCount).toBe(5);
  });

  it('sets source metadata correctly', () => {
    const signal = parseLcov('', '/root');
    expect(signal.source).toEqual({
      tool: 'lcov',
      format: 'lcov',
      version: '1.0',
    });
  });
});

// ---------------------------------------------------------------------------
// Istanbul parser
// ---------------------------------------------------------------------------

describe('parseIstanbul', () => {
  it('parses Istanbul JSON with correct file count', async () => {
    const content = await loadIstanbulFixture();
    const signal = parseIstanbul(content, ROOT_DIR);
    expect(signal.files).toHaveLength(2);
  });

  it('extracts correct statement-based line coverage', async () => {
    const content = await loadIstanbulFixture();
    const signal = parseIstanbul(content, ROOT_DIR);
    const auth = signal.files.find((f) => f.filePath.includes('authController'));
    expect(auth).toBeDefined();
    expect(auth!.linesTotal).toBe(10);
    // s: { "0": 1, "1": 1, "2": 8, "3": 8, "4": 5, "5": 8, "6": 3, "7": 3, "8": 3, "9": 0 }
    // 9 out of 10 have count > 0
    expect(auth!.linesCovered).toBe(9);
  });

  it('extracts branch coverage from branchMap', async () => {
    const content = await loadIstanbulFixture();
    const signal = parseIstanbul(content, ROOT_DIR);
    const auth = signal.files.find((f) => f.filePath.includes('authController'));
    expect(auth).toBeDefined();
    // b: { "0": [5, 3], "1": [3, 0] } → 4 total, 3 covered
    expect(auth!.branchesTotal).toBe(4);
    expect(auth!.branchesCovered).toBe(3);
  });

  it('returns null branches when branchMap is empty', async () => {
    const content = await loadIstanbulFixture();
    const signal = parseIstanbul(content, ROOT_DIR);
    const userModel = signal.files.find((f) => f.filePath.includes('user'));
    expect(userModel).toBeDefined();
    expect(userModel!.branchesTotal).toBeNull();
    expect(userModel!.branchesCovered).toBeNull();
  });

  it('extracts function names and lines from fnMap', async () => {
    const content = await loadIstanbulFixture();
    const signal = parseIstanbul(content, ROOT_DIR);
    const auth = signal.files.find((f) => f.filePath.includes('authController'));
    expect(auth).toBeDefined();
    expect(auth!.functions).toHaveLength(3);

    const login = auth!.functions.find((f) => f.name === 'login');
    expect(login).toEqual({ name: 'login', line: 5, executionCount: 8 });

    const refresh = auth!.functions.find((f) => f.name === 'refreshToken');
    expect(refresh).toEqual({ name: 'refreshToken', line: 22, executionCount: 0 });
  });

  it('relativizes file paths to rootDir', async () => {
    const content = await loadIstanbulFixture();
    const signal = parseIstanbul(content, ROOT_DIR);
    for (const file of signal.files) {
      expect(file.filePath).not.toMatch(/^\//);
      expect(file.filePath).not.toContain('\\');
    }
  });

  it('sets source metadata correctly', async () => {
    const content = await loadIstanbulFixture();
    const signal = parseIstanbul(content, ROOT_DIR);
    expect(signal.source).toEqual({
      tool: 'istanbul',
      format: 'istanbul',
      version: '1.0',
    });
  });

  it('handles empty Istanbul JSON', () => {
    const signal = parseIstanbul('{}', '/root');
    expect(signal.files).toEqual([]);
  });

  it('defaults function execution count to 0 when f entry is missing', () => {
    const istanbul = JSON.stringify({
      '/root/src/test.ts': {
        path: '/root/src/test.ts',
        s: { '0': 1 },
        b: {},
        f: {},
        fnMap: {
          '0': {
            name: 'orphanFunc',
            decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
            loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
          },
        },
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        branchMap: {},
      },
    });
    const signal = parseIstanbul(istanbul, '/root');
    expect(signal.files[0].functions[0].executionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runCoverageAdapter integration
// ---------------------------------------------------------------------------

describe('runCoverageAdapter', () => {
  it('reads and parses an LCOV file from disk', async () => {
    const result = await runCoverageAdapter({
      rootDir: ROOT_DIR,
      coveragePath: join(fixturesDir, 'coverage-lcov.info'),
      format: 'lcov',
    });
    expect(result.coverageSignals).toHaveLength(1);
    expect(result.coverageSignals[0].files).toHaveLength(3);
    expect(result.toolRun.aspect).toBe('coverage');
    expect(result.toolRun.tool).toBe('lcov');
    expect(result.toolRun.exitCode).toBe(0);
    expect(result.toolRun.duration).toBeGreaterThanOrEqual(0);
  });

  it('reads and parses an Istanbul JSON file from disk', async () => {
    const result = await runCoverageAdapter({
      rootDir: ROOT_DIR,
      coveragePath: join(fixturesDir, 'coverage-istanbul.json'),
      format: 'istanbul',
    });
    expect(result.coverageSignals).toHaveLength(1);
    expect(result.coverageSignals[0].files).toHaveLength(2);
    expect(result.toolRun.tool).toBe('istanbul');
  });

  it('auto-detects LCOV format from .info extension', async () => {
    const result = await runCoverageAdapter({
      rootDir: ROOT_DIR,
      coveragePath: join(fixturesDir, 'coverage-lcov.info'),
    });
    expect(result.coverageSignals[0].source.format).toBe('lcov');
  });

  it('auto-detects Istanbul format from .json extension', async () => {
    const result = await runCoverageAdapter({
      rootDir: ROOT_DIR,
      coveragePath: join(fixturesDir, 'coverage-istanbul.json'),
    });
    expect(result.coverageSignals[0].source.format).toBe('istanbul');
  });

  it('throws on missing coverage file', async () => {
    await expect(
      runCoverageAdapter({
        rootDir: ROOT_DIR,
        coveragePath: join(fixturesDir, 'nonexistent.info'),
        format: 'lcov',
      }),
    ).rejects.toThrow('Failed to read coverage file');
  });
});
