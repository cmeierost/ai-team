import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeJscpdOutput,
  normalizePath,
  buildCloneId,
  type JscpdRawOutput,
  type JscpdRawFileRef,
  type DuplicationSignal,
} from './jscpd.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadFixture(): Promise<JscpdRawOutput> {
  const fixturePath = join(__dirname, '..', '__fixtures__', 'jscpd-output.json');
  const content = await readFile(fixturePath, 'utf-8');
  return JSON.parse(content) as JscpdRawOutput;
}

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\services\\userService.ts')).toBe(
      'src/services/userService.ts',
    );
  });

  it('strips leading "./"', () => {
    expect(normalizePath('./src/index.ts')).toBe('src/index.ts');
  });

  it('handles mixed separators with leading "./"', () => {
    expect(normalizePath('.\\src\\file.ts')).toBe('src/file.ts');
  });

  it('returns already-clean paths unchanged', () => {
    expect(normalizePath('src/utils/validate.ts')).toBe(
      'src/utils/validate.ts',
    );
  });
});

// ---------------------------------------------------------------------------
// buildCloneId
// ---------------------------------------------------------------------------

describe('buildCloneId', () => {
  it('produces a deterministic id from file refs', () => {
    const first: JscpdRawFileRef = {
      name: 'src/a.ts',
      start: 10,
      end: 20,
    };
    const second: JscpdRawFileRef = {
      name: 'src/b.ts',
      start: 30,
      end: 40,
    };
    expect(buildCloneId(first, second)).toBe('clone:src/a.ts:L10-src/b.ts:L30');
  });

  it('normalizes backslashes in file names', () => {
    const first: JscpdRawFileRef = {
      name: 'src\\services\\a.ts',
      start: 5,
      end: 15,
    };
    const second: JscpdRawFileRef = {
      name: '.\\src\\services\\b.ts',
      start: 20,
      end: 30,
    };
    expect(buildCloneId(first, second)).toBe(
      'clone:src/services/a.ts:L5-src/services/b.ts:L20',
    );
  });

  it('is stable across repeated calls', () => {
    const first: JscpdRawFileRef = { name: 'x.ts', start: 1, end: 5 };
    const second: JscpdRawFileRef = { name: 'y.ts', start: 2, end: 6 };
    const a = buildCloneId(first, second);
    const b = buildCloneId(first, second);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Fixture-based normalization
// ---------------------------------------------------------------------------

describe('normalizeJscpdOutput', () => {
  const TOOL_VERSION = '4.0.5';

  it('returns correct source metadata', async () => {
    const raw = await loadFixture();
    const signal = normalizeJscpdOutput(raw, TOOL_VERSION);
    expect(signal.source).toEqual({ tool: 'jscpd', version: TOOL_VERSION });
  });

  it('produces correct number of clones from fixture', async () => {
    const raw = await loadFixture();
    const signal = normalizeJscpdOutput(raw, TOOL_VERSION);
    expect(signal.clones).toHaveLength(4);
  });

  // -- Clone normalization ------------------------------------------------

  describe('clone normalization', () => {
    let signal: DuplicationSignal;

    it('loads fixture and normalizes', async () => {
      const raw = await loadFixture();
      signal = normalizeJscpdOutput(raw, TOOL_VERSION);
    });

    it('maps format correctly', () => {
      expect(signal.clones[0].format).toBe('typescript');
      expect(signal.clones[2].format).toBe('javascript');
    });

    it('maps tokenCount and lineCount', () => {
      const clone = signal.clones[0];
      expect(clone.tokenCount).toBe(85);
      expect(clone.lineCount).toBe(12);
    });

    it('builds deterministic clone IDs', () => {
      expect(signal.clones[0].id).toBe(
        'clone:src/services/userService.ts:L10-src/services/adminService.ts:L25',
      );
      expect(signal.clones[2].id).toBe(
        'clone:src/legacy/parser.js:L44-src/legacy/transformer.js:L100',
      );
    });

    it('normalizes firstFile and secondFile paths', () => {
      expect(signal.clones[0].firstFile.filePath).toBe(
        'src/services/userService.ts',
      );
      expect(signal.clones[0].secondFile.filePath).toBe(
        'src/services/adminService.ts',
      );
    });

    it('maps startLine and endLine', () => {
      const first = signal.clones[0].firstFile;
      expect(first.startLine).toBe(10);
      expect(first.endLine).toBe(21);
    });
  });

  // -- Fragment handling --------------------------------------------------

  describe('fragment handling', () => {
    it('includes fragment text when present', async () => {
      const raw = await loadFixture();
      const signal = normalizeJscpdOutput(raw, TOOL_VERSION);
      expect(signal.clones[0].fragment).toContain('fetchUser');
      expect(typeof signal.clones[0].fragment).toBe('string');
    });

    it('sets fragment to null when absent', async () => {
      const raw = await loadFixture();
      const signal = normalizeJscpdOutput(raw, TOOL_VERSION);
      // 4th clone in fixture has no fragment
      expect(signal.clones[3].fragment).toBeNull();
    });
  });

  // -- Column info --------------------------------------------------------

  describe('column info', () => {
    it('extracts startCol and endCol from startLoc/endLoc', async () => {
      const raw = await loadFixture();
      const signal = normalizeJscpdOutput(raw, TOOL_VERSION);
      const first = signal.clones[0].firstFile;
      expect(first.startCol).toBe(0);
      expect(first.endCol).toBe(1);
    });

    it('sets columns to null when startLoc/endLoc are missing', async () => {
      const raw = await loadFixture();
      const signal = normalizeJscpdOutput(raw, TOOL_VERSION);
      // 4th clone has no startLoc/endLoc
      const first = signal.clones[3].firstFile;
      expect(first.startCol).toBeNull();
      expect(first.endCol).toBeNull();
      const second = signal.clones[3].secondFile;
      expect(second.startCol).toBeNull();
      expect(second.endCol).toBeNull();
    });
  });

  // -- Statistics mapping -------------------------------------------------

  describe('statistics mapping', () => {
    it('maps total statistics from raw output', async () => {
      const raw = await loadFixture();
      const signal = normalizeJscpdOutput(raw, TOOL_VERSION);
      expect(signal.statistics).toEqual({
        totalLines: 820,
        totalTokens: 6000,
        totalSources: 8,
        duplicatedLines: 41,
        duplicatedTokens: 309,
      });
    });
  });

  // -- Empty results ------------------------------------------------------

  describe('empty results', () => {
    it('returns empty clones and zero statistics for no duplicates', () => {
      const raw: JscpdRawOutput = {
        duplicates: [],
        statistics: {
          detectionDate: '2025-01-15T00:00:00.000Z',
          formats: {},
          total: {
            sources: 5,
            lines: 100,
            tokens: 800,
            duplicatedLines: 0,
            duplicatedTokens: 0,
            clones: 0,
            percentage: '0.00',
          },
        },
      };
      const signal = normalizeJscpdOutput(raw, '4.0.5');

      expect(signal.clones).toEqual([]);
      expect(signal.statistics.duplicatedLines).toBe(0);
      expect(signal.statistics.duplicatedTokens).toBe(0);
      expect(signal.statistics.totalLines).toBe(100);
      expect(signal.statistics.totalSources).toBe(5);
    });
  });

  // -- Multiple formats ---------------------------------------------------

  describe('multiple formats', () => {
    it('preserves distinct format tags across clones', async () => {
      const raw = await loadFixture();
      const signal = normalizeJscpdOutput(raw, TOOL_VERSION);
      const formats = new Set(signal.clones.map((c) => c.format));
      expect(formats.has('typescript')).toBe(true);
      expect(formats.has('javascript')).toBe(true);
    });
  });

  // -- Windows path normalization -----------------------------------------

  describe('windows path normalization', () => {
    it('normalizes backslash paths in file refs', () => {
      const raw: JscpdRawOutput = {
        duplicates: [
          {
            format: 'typescript',
            lines: 5,
            tokens: 40,
            firstFile: {
              name: 'src\\models\\user.ts',
              start: 1,
              end: 5,
              startLoc: { line: 1, column: 0 },
              endLoc: { line: 5, column: 1 },
            },
            secondFile: {
              name: '.\\src\\models\\admin.ts',
              start: 10,
              end: 14,
              startLoc: { line: 10, column: 0 },
              endLoc: { line: 14, column: 1 },
            },
          },
        ],
        statistics: {
          detectionDate: '2025-01-15T00:00:00.000Z',
          formats: {},
          total: {
            sources: 2,
            lines: 50,
            tokens: 400,
            duplicatedLines: 5,
            duplicatedTokens: 40,
            clones: 1,
            percentage: '10.00',
          },
        },
      };
      const signal = normalizeJscpdOutput(raw, '4.0.5');
      expect(signal.clones[0].firstFile.filePath).toBe('src/models/user.ts');
      expect(signal.clones[0].secondFile.filePath).toBe('src/models/admin.ts');
      expect(signal.clones[0].id).toBe(
        'clone:src/models/user.ts:L1-src/models/admin.ts:L10',
      );
    });
  });
});
