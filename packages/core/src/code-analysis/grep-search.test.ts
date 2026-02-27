import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrepSearch } from './grep-search.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GrepSearch', () => {
  let grep: GrepSearch;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    grep = new GrepSearch();
    testDir = join(tmpdir(), `grep-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testFile = join(testDir, 'test.ts');

    const testContent = `
export function hello(name: string): string {
  console.log('Hello, ' + name);
  return 'Hello, ' + name;
}

// TODO: Improve error handling
function processData(data: any) {
  // FIXME: Validate input
  return data.map(item => item.value);
}

const API_KEY = 'secret-key-123';
const DEBUG = true;
`;

    await writeFile(testFile, testContent, 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('searchFile', () => {
    it('should find simple text pattern', async () => {
      const matches = await grep.searchFile(testFile, 'console.log');

      expect(matches).toHaveLength(1);
      expect(matches[0].line).toBe(3);
      expect(matches[0].matchedText).toBe('console.log');
      expect(matches[0].lineText).toContain('console.log');
    });

    it('should find regex pattern', async () => {
      const matches = await grep.searchFile(testFile, /TODO|FIXME/);

      expect(matches).toHaveLength(2);
      expect(matches[0].matchedText).toBe('TODO');
      expect(matches[1].matchedText).toBe('FIXME');
    });

    it('should support case-insensitive search', async () => {
      const matches = await grep.searchFile(testFile, 'HELLO', {
        caseInsensitive: true,
      });

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.lineText.toLowerCase().includes('hello'))).toBe(true);
    });

    it('should support whole word matching', async () => {
      const matches = await grep.searchFile(testFile, 'name', {
        wholeWord: true,
      });

      // Should match "name" as whole word, not "name)" or other variants
      expect(matches.length).toBeGreaterThan(0);
      matches.forEach(match => {
        expect(match.matchedText).toBe('name');
      });
    });

    it('should limit matches per file', async () => {
      const matches = await grep.searchFile(testFile, 'name', {
        maxMatchesPerFile: 2,
      });

      expect(matches).toHaveLength(2);
    });

    it('should return empty array when pattern not found', async () => {
      const matches = await grep.searchFile(testFile, 'nonexistent-pattern');

      expect(matches).toHaveLength(0);
    });

    it('should include column position', async () => {
      const matches = await grep.searchFile(testFile, 'export');

      expect(matches).toHaveLength(1);
      expect(matches[0].column).toBeGreaterThanOrEqual(0);
      expect(matches[0].lineText.substring(matches[0].column)).toMatch(/^export/);
    });
  });

  describe('searchFiles', () => {
    let secondFile: string;

    beforeEach(async () => {
      secondFile = join(testDir, 'test2.ts');
      await writeFile(
        secondFile,
        'function test() { console.log("test"); }',
        'utf-8'
      );
    });

    it('should search across multiple files', async () => {
      const matches = await grep.searchFiles([testFile, secondFile], 'console.log');

      expect(matches.length).toBeGreaterThanOrEqual(2);
      const files = new Set(matches.map(m => m.filePath));
      expect(files.size).toBe(2);
    });

    it('should skip files that cannot be read', async () => {
      const matches = await grep.searchFiles(
        [testFile, 'nonexistent.ts'],
        'console.log'
      );

      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('countOccurrences', () => {
    it('should count pattern occurrences', async () => {
      const count = await grep.countOccurrences([testFile], 'name');

      expect(count).toBeGreaterThan(0);
    });

    it('should return 0 for non-matching pattern', async () => {
      const count = await grep.countOccurrences([testFile], 'nonexistent');

      expect(count).toBe(0);
    });
  });

  describe('getFilesWithPattern', () => {
    let fileWithPattern: string;
    let fileWithoutPattern: string;

    beforeEach(async () => {
      fileWithPattern = join(testDir, 'with-pattern.ts');
      fileWithoutPattern = join(testDir, 'without-pattern.ts');

      await writeFile(fileWithPattern, 'const x = SPECIAL_MARKER;', 'utf-8');
      await writeFile(fileWithoutPattern, 'const y = 42;', 'utf-8');
    });

    it('should return only files containing pattern', async () => {
      const files = await grep.getFilesWithPattern(
        [fileWithPattern, fileWithoutPattern],
        'SPECIAL_MARKER'
      );

      expect(files).toHaveLength(1);
      expect(files[0]).toBe(fileWithPattern);
    });

    it('should return empty array when no files match', async () => {
      const files = await grep.getFilesWithPattern(
        [fileWithPattern, fileWithoutPattern],
        'NONEXISTENT'
      );

      expect(files).toHaveLength(0);
    });
  });

  describe('searchMultiplePatterns', () => {
    it('should search for multiple patterns', async () => {
      const results = await grep.searchMultiplePatterns(
        [testFile],
        ['TODO', 'FIXME', 'console.log']
      );

      expect(results.size).toBe(3);
      expect(results.get('TODO')?.length).toBeGreaterThan(0);
      expect(results.get('FIXME')?.length).toBeGreaterThan(0);
      expect(results.get('console.log')?.length).toBeGreaterThan(0);
    });
  });
});
