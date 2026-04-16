/**
 * A single hunk in a diff (continuous block of changes)
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Structured diff information
 */
export interface StructuredDiff {
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** The raw unified diff string */
  unifiedDiff: string;
}

/**
 * Options for diff generation
 */
export interface DiffOptions {
  /** Number of context lines around changes */
  context?: number;
  /** Old file label */
  oldLabel?: string;
  /** New file label */
  newLabel?: string;
}

/**
 * Builds unified diffs between old and new versions of code
 */
export interface IDiffBuilder {
  /**
   * Create a unified diff between two versions of a file
   */
  createDiff(
    filePath: string,
    oldContent: string,
    newContent: string,
    options: DiffOptions
  ): StructuredDiff;
  createDiff(filePath: string, oldContent: string, newContent: string): StructuredDiff;

  /**
   * Create diffs for multiple files
   */
  createMultiFileDiff(
    files: Array<{ filePath: string; oldContent: string; newContent: string }>,
    options: DiffOptions
  ): StructuredDiff[];
  createMultiFileDiff(
    files: Array<{ filePath: string; oldContent: string; newContent: string }>
  ): StructuredDiff[];

  /**
   * Apply a diff to content (patch)
   */
  applyDiff(originalContent: string, unifiedDiff: string): string | null;

  /**
   * Format a diff for terminal display with ANSI colors
   */
  formatForTerminal(diff: StructuredDiff): string;

  /**
   * Get a summary of changes
   */
  getSummary(diffs: StructuredDiff[]): {
    filesChanged: number;
    totalAdditions: number;
    totalDeletions: number;
    files: string[];
  };

  /**
   * Check if a diff has any changes
   */
  hasChanges(diff: StructuredDiff): boolean;

  /**
   * Filter out diffs with no changes
   */
  filterEmptyDiffs(diffs: StructuredDiff[]): StructuredDiff[];
}
