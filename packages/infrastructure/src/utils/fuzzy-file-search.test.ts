import { describe, it, expect } from 'vitest';
import { findSimilarFiles, rankSimilarFiles } from './fuzzy-file-search.js';

describe('findSimilarFiles', () => {
  const allowedFiles = [
    'docs/architecture/overview.md',
    'docs/architecture/implementation-entry-points.md',
    'docs/architecture/orchestrator-overview.md',
    'docs/api/contracts.md',
    'docs/api/overview.md',
    'packages/core/src/index.ts',
    'packages/service/src/commands/fs/fs-read-file.tool.ts',
    'packages/service/src/commands/fs/fs-tools-helpers.ts',
    'packages/infrastructure/src/context/fuzzy-file-search-service.ts',
    'packages/infrastructure/src/utils/str.ts',
    'packages/infrastructure/src/utils/fuzzy-file-search.ts',
    'README.md',
    'AGENTS.md',
    'ARCHITECTURE.md',
    'COPILOT-CONTEXT.md',
  ];

  it('returns exact match with score 1.0', () => {
    const results = findSimilarFiles('README.md', allowedFiles, 10);
    expect(results).toContain('README.md');
    expect(results[0]).toBe('README.md');
  });

  it('suggests files in same directory for typo', () => {
    const results = findSimilarFiles('docs/architecture.md', allowedFiles, 10);
    // Should suggest docs/architecture/* files
    const architectureMatches = results.filter(r => r.includes('architecture'));
    expect(architectureMatches.length).toBeGreaterThan(0);
    // All suggestions should be from allowed files
    for (const r of results) {
      expect(allowedFiles).toContain(r);
    }
  });

  it('suggests similar filenames across workspace', () => {
    const results = findSimilarFiles('packages/service/src/commands/fs/fs-read.tool.ts', allowedFiles, 10);
    // Should find fs-read-file.tool.ts
    expect(results.some(r => r.includes('fs-read-file'))).toBe(true);
  });

  it('respects maxResults limit', () => {
    const results = findSimilarFiles('docs/architecture.md', allowedFiles, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('filters out low similarity scores', () => {
    const results = findSimilarFiles('xyz_nonexistent_file.md', allowedFiles, 10, 0.5);
    // Should return empty or very few results for completely unrelated name
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for empty allowed list', () => {
    const results = findSimilarFiles('some/file.ts', [], 10);
    expect(results).toEqual([]);
  });

  it('prefers same directory matches', () => {
    const results = findSimilarFiles('packages/infrastructure/src/context/fuzzy-search.ts', allowedFiles, 10);
    // Should prefer files in same directory
    const sameDir = results.filter(r => r.includes('packages/infrastructure/src/context/'));
    expect(sameDir.length).toBeGreaterThan(0);
    // First result should be from same directory or very close
    expect(results[0]).toMatch(/packages\/infrastructure/);
  });

  it('is case insensitive', () => {
    const results = findSimilarFiles('readme.md', allowedFiles, 10);
    expect(results[0]).toBe('README.md');
  });

  it('only returns files from allowed list', () => {
    const results = findSimilarFiles('docs/architecture.md', allowedFiles, 10);
    for (const r of results) {
      expect(allowedFiles).toContain(r);
    }
  });

  it('handles paths without separators without truncating directory comparisons', () => {
    const results = rankSimilarFiles('README.md', ['README.md', 'readme-old.md'], 0.1);
    expect(results[0]?.path).toBe('README.md');
    expect(results[0]?.score).toBe(1);
  });

  it('returns ranked matches with stable descending score order', () => {
    const ranked = rankSimilarFiles('workflow.ts', [
      'src/workflow.ts',
      'src/workflow.test.ts',
      'docs/workflow.md',
    ]);

    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });
});
