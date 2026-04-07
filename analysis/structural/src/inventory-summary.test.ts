import { describe, it, expect } from 'vitest';
import { computeInventorySummary, type FileInventoryInput } from './inventory-summary.js';

describe('computeInventorySummary', () => {
  it('returns zeroed summary for empty inventory', () => {
    const result = computeInventorySummary([]);
    expect(result.totalFiles).toBe(0);
    expect(result.totalSizeBytes).toBe(0);
    expect(result.analyzedLanguageCount).toBe(0);
    expect(result.nonAnalyzedCount).toBe(0);
    expect(result.byCategory).toEqual([]);
    expect(result.largestFiles).toEqual([]);
    expect(result.avgFileSizeBytes).toBe(0);
  });

  it('aggregates totals correctly', () => {
    const inventory: FileInventoryInput[] = [
      { filePath: 'src/a.ts', fileCategory: 'source_code', isAnalyzedLanguage: true, fileSizeBytes: 1000, totalLines: 50 },
      { filePath: 'src/b.ts', fileCategory: 'source_code', isAnalyzedLanguage: true, fileSizeBytes: 2000, totalLines: 100 },
      { filePath: 'README.md', fileCategory: 'docs', isAnalyzedLanguage: false, fileSizeBytes: 500 },
    ];

    const result = computeInventorySummary(inventory);

    expect(result.totalFiles).toBe(3);
    expect(result.totalSizeBytes).toBe(3500);
    expect(result.analyzedLanguageCount).toBe(2);
    expect(result.nonAnalyzedCount).toBe(1);
    expect(result.avgFileSizeBytes).toBe(Math.round(3500 / 3));
  });

  it('groups by category with correct counts and bytes', () => {
    const inventory: FileInventoryInput[] = [
      { filePath: 'a.ts', fileCategory: 'source_code', isAnalyzedLanguage: true, fileSizeBytes: 100 },
      { filePath: 'b.ts', fileCategory: 'source_code', isAnalyzedLanguage: true, fileSizeBytes: 200 },
      { filePath: 'c.css', fileCategory: 'style', isAnalyzedLanguage: true, fileSizeBytes: 50 },
      { filePath: 'd.json', fileCategory: 'config', isAnalyzedLanguage: false, fileSizeBytes: 30 },
    ];

    const result = computeInventorySummary(inventory);

    expect(result.byCategory).toHaveLength(3);
    const sourceCode = result.byCategory.find((c) => c.category === 'source_code')!;
    expect(sourceCode.count).toBe(2);
    expect(sourceCode.totalBytes).toBe(300);

    const style = result.byCategory.find((c) => c.category === 'style')!;
    expect(style.count).toBe(1);
    expect(style.totalBytes).toBe(50);
  });

  it('returns largest files sorted by size descending', () => {
    const inventory: FileInventoryInput[] = [
      { filePath: 'small.ts', fileCategory: 'source_code', isAnalyzedLanguage: true, fileSizeBytes: 100 },
      { filePath: 'large.ts', fileCategory: 'source_code', isAnalyzedLanguage: true, fileSizeBytes: 5000 },
      { filePath: 'medium.ts', fileCategory: 'source_code', isAnalyzedLanguage: true, fileSizeBytes: 2000 },
    ];

    const result = computeInventorySummary(inventory);

    expect(result.largestFiles[0].filePath).toBe('large.ts');
    expect(result.largestFiles[0].sizeBytes).toBe(5000);
    expect(result.largestFiles[1].filePath).toBe('medium.ts');
    expect(result.largestFiles[2].filePath).toBe('small.ts');
  });

  it('limits largest files to 10', () => {
    const inventory: FileInventoryInput[] = Array.from({ length: 15 }, (_, i) => ({
      filePath: `file${i}.ts`,
      fileCategory: 'source_code',
      isAnalyzedLanguage: true,
      fileSizeBytes: (i + 1) * 100,
    }));

    const result = computeInventorySummary(inventory);

    expect(result.largestFiles).toHaveLength(10);
    expect(result.largestFiles[0].sizeBytes).toBe(1500);
  });
});
