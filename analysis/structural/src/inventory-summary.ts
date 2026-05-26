/**
 * File inventory summary — aggregates optional file-inventory data
 * passed into the pipeline via StructuralPipelineOptions.fileInventory.
 */

// ── Public types ────────────────────────────────────────────────────────

export interface InventorySummary {
  totalFiles: number;
  totalSizeBytes: number;
  analyzedLanguageCount: number;
  nonAnalyzedCount: number;
  byCategory: Array<{ category: string; count: number; totalBytes: number }>;
  largestFiles: Array<{ filePath: string; sizeBytes: number; category: string }>;
  avgFileSizeBytes: number;
}

/** Shape of each inventory item as accepted by the pipeline options. */
export interface FileInventoryInput {
  filePath: string;
  fileCategory: string;
  isAnalyzedLanguage: boolean;
  fileSizeBytes: number;
  totalLines?: number;
  blankLines?: number;
  commentLines?: number;
}

// ── Implementation ──────────────────────────────────────────────────────

const TOP_LARGEST = 10;

/**
 * Compute an InventorySummary from the raw file-inventory entries.
 */
export function computeInventorySummary(
  inventory: FileInventoryInput[],
): InventorySummary {
  if (inventory.length === 0) {
    return {
      totalFiles: 0,
      totalSizeBytes: 0,
      analyzedLanguageCount: 0,
      nonAnalyzedCount: 0,
      byCategory: [],
      largestFiles: [],
      avgFileSizeBytes: 0,
    };
  }

  let totalSizeBytes = 0;
  let analyzedLanguageCount = 0;
  let nonAnalyzedCount = 0;

  const categoryMap = new Map<string, { count: number; totalBytes: number }>();

  for (const entry of inventory) {
    totalSizeBytes += entry.fileSizeBytes;

    if (entry.isAnalyzedLanguage) {
      analyzedLanguageCount++;
    } else {
      nonAnalyzedCount++;
    }

    let cat = categoryMap.get(entry.fileCategory);
    if (!cat) {
      cat = { count: 0, totalBytes: 0 };
      categoryMap.set(entry.fileCategory, cat);
    }
    cat.count++;
    cat.totalBytes += entry.fileSizeBytes;
  }

  const byCategory = [...categoryMap.entries()]
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => b.totalBytes - a.totalBytes);

  const sorted = [...inventory].sort((a, b) => b.fileSizeBytes - a.fileSizeBytes);
  const largestFiles = sorted.slice(0, TOP_LARGEST).map((f) => ({
    filePath: f.filePath,
    sizeBytes: f.fileSizeBytes,
    category: f.fileCategory,
  }));

  return {
    totalFiles: inventory.length,
    totalSizeBytes,
    analyzedLanguageCount,
    nonAnalyzedCount,
    byCategory,
    largestFiles,
    avgFileSizeBytes: Math.round(totalSizeBytes / inventory.length),
  };
}
