import { describe, it, expect, beforeEach } from 'vitest';
import { DiffBuilder } from './diff-builder.js';

describe('DiffBuilder', () => {
  let diffBuilder: DiffBuilder;

  beforeEach(() => {
    diffBuilder = new DiffBuilder();
  });

  describe('createDiff', () => {
    it('should create diff for simple change', () => {
      const oldContent = 'Hello World';
      const newContent = 'Hello TypeScript';

      const diff = diffBuilder.createDiff('test.ts', oldContent, newContent);

      expect(diff.filePath).toBe('test.ts');
      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(1);
      expect(diff.hunks.length).toBeGreaterThan(0);
      expect(diff.unifiedDiff).toContain('-Hello World');
      expect(diff.unifiedDiff).toContain('+Hello TypeScript');
    });

    it('should handle no changes', () => {
      const content = 'No changes here';

      const diff = diffBuilder.createDiff('test.ts', content, content);

      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(0);
      expect(diff.hunks).toHaveLength(0);
      // Note: diff library may include header (--- and +++) even with no changes
      // but there should be no actual change lines (those start with + or - after @@)
    });

    it('should handle multiple hunks', () => {
      const oldContent = `line1
line2
line3
line4
line5
line6
line7
line8
line9
line10`;

      const newContent = `line1
CHANGED2
line3
line4
line5
line6
line7
CHANGED8
line9
line10`;

      const diff = diffBuilder.createDiff('test.ts', oldContent, newContent);

      expect(diff.hunks.length).toBeGreaterThanOrEqual(1);
      expect(diff.additions).toBe(2);
      expect(diff.deletions).toBe(2);
    });

    it('should respect context option', () => {
      const oldContent = 'line1\nline2\nline3';
      const newContent = 'line1\nCHANGED\nline3';

      const diff = diffBuilder.createDiff('test.ts', oldContent, newContent, {
        context: 1,
      });

      expect(diff.hunks).toHaveLength(1);
      expect(diff.unifiedDiff).toContain('line1');
      expect(diff.unifiedDiff).toContain('line3');
    });

    it('should use custom labels', () => {
      const oldContent = 'test';
      const newContent = 'changed';

      const diff = diffBuilder.createDiff('test.ts', oldContent, newContent, {
        oldLabel: 'original',
        newLabel: 'modified',
      });

      expect(diff.unifiedDiff).toContain('original');
      expect(diff.unifiedDiff).toContain('modified');
    });
  });

  describe('createMultiFileDiff', () => {
    it('should create diffs for multiple files', () => {
      const files = [
        {
          filePath: 'file1.ts',
          oldContent: 'content1',
          newContent: 'changed1',
        },
        {
          filePath: 'file2.ts',
          oldContent: 'content2',
          newContent: 'changed2',
        },
      ];

      const diffs = diffBuilder.createMultiFileDiff(files);

      expect(diffs).toHaveLength(2);
      expect(diffs[0].filePath).toBe('file1.ts');
      expect(diffs[1].filePath).toBe('file2.ts');
      expect(diffs[0].additions).toBeGreaterThan(0);
      expect(diffs[1].additions).toBeGreaterThan(0);
    });
  });

  describe('applyDiff', () => {
    it('should apply diff to content', () => {
      const oldContent = 'Hello World';
      const newContent = 'Hello TypeScript';

      const diff = diffBuilder.createDiff('test.ts', oldContent, newContent);
      const result = diffBuilder.applyDiff(oldContent, diff.unifiedDiff);

      expect(result).toBeDefined();
      // Result should contain the new content
      expect(result).toContain('TypeScript');
      expect(result).not.toContain('World');
    });

    it('should return original content for invalid diff', () => {
      const original = 'content';
      const result = diffBuilder.applyDiff(original, 'invalid diff');

      // Returns original content when diff cannot be parsed
      expect(result).toBe(original);
    });

    it('should handle multiline changes', () => {
      const oldContent = `function test() {
  console.log('old');
  return 1;
}`;

      const newContent = `function test() {
  console.log('new');
  return 2;
}`;

      const diff = diffBuilder.createDiff('test.ts', oldContent, newContent);
      const result = diffBuilder.applyDiff(oldContent, diff.unifiedDiff);

      expect(result).toBeDefined();
      expect(result).toContain('new');
      expect(result).toContain('return 2');
    });
  });

  describe('formatForTerminal', () => {
    it('should format diff with ANSI colors', () => {
      const oldContent = 'Hello World';
      const newContent = 'Hello TypeScript';

      const diff = diffBuilder.createDiff('test.ts', oldContent, newContent);
      const formatted = diffBuilder.formatForTerminal(diff);

      expect(formatted).toContain('diff --git');
      expect(formatted).toContain('test.ts');
      expect(formatted).toContain('@@');
      expect(formatted).toMatch(/\x1b\[\d+m/); // Contains ANSI codes
    });

    it('should include summary', () => {
      const oldContent = 'line1\nline2';
      const newContent = 'line1\nchanged';

      const diff = diffBuilder.createDiff('test.ts', oldContent, newContent);
      const formatted = diffBuilder.formatForTerminal(diff);

      expect(formatted).toContain('Summary');
      expect(formatted).toContain('additions');
      expect(formatted).toContain('deletions');
    });
  });

  describe('getSummary', () => {
    it('should summarize multiple diffs', () => {
      const diffs = [
        diffBuilder.createDiff('file1.ts', 'a', 'b'),
        diffBuilder.createDiff('file2.ts', 'x\ny', 'x\nz\nw'),
      ];

      const summary = diffBuilder.getSummary(diffs);

      expect(summary.filesChanged).toBe(2);
      expect(summary.totalAdditions).toBeGreaterThan(0);
      expect(summary.totalDeletions).toBeGreaterThan(0);
      expect(summary.files).toContain('file1.ts');
      expect(summary.files).toContain('file2.ts');
    });
  });

  describe('hasChanges', () => {
    it('should return true when diff has changes', () => {
      const diff = diffBuilder.createDiff('test.ts', 'old', 'new');

      expect(diffBuilder.hasChanges(diff)).toBe(true);
    });

    it('should return false when no changes', () => {
      const diff = diffBuilder.createDiff('test.ts', 'same', 'same');

      expect(diffBuilder.hasChanges(diff)).toBe(false);
    });
  });

  describe('filterEmptyDiffs', () => {
    it('should filter out diffs with no changes', () => {
      const diffs = [
        diffBuilder.createDiff('changed.ts', 'old', 'new'),
        diffBuilder.createDiff('unchanged.ts', 'same', 'same'),
        diffBuilder.createDiff('also-changed.ts', 'a', 'b'),
      ];

      const filtered = diffBuilder.filterEmptyDiffs(diffs);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(d => d.filePath)).not.toContain('unchanged.ts');
    });
  });
});
