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
 * Options for diff generation
 * Moved to infrastructure - no longer exported from core
 */
