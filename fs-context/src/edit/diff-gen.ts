/**
 * Diff generation — unified and structured diffs between two strings.
 *
 * Wraps the `diff` npm package with typed wrappers for use across the
 * fs-context layer. No access-layer dependency — callers are responsible
 * for permission checks before reading file content.
 */
import { createTwoFilesPatch, structuredPatch } from 'diff';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface StructuredDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

export interface UnifiedDiffOptions {
  /** Header label for the old file (default 'a'). */
  oldPath?: string;
  /** Header label for the new file (default 'b'). */
  newPath?: string;
  /** Number of context lines around each change (default 3). */
  contextLines?: number;
}

// ─── Unified diff ─────────────────────────────────────────────────────────────

/**
 * Generate a unified diff string from two file contents.
 *
 * Returns an empty string when the contents are identical.
 */
export function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  opts: UnifiedDiffOptions = {},
): string {
  const oldPath = opts.oldPath ?? 'a';
  const newPath = opts.newPath ?? 'b';
  const contextLines = opts.contextLines ?? 3;

  if (oldContent === newContent) return '';

  return createTwoFilesPatch(oldPath, newPath, oldContent, newContent, undefined, undefined, {
    context: contextLines,
  });
}

// ─── Structured diff ─────────────────────────────────────────────────────────

/**
 * Generate a structured diff with typed hunks for programmatic consumption.
 *
 * Returns `null` when the contents are identical.
 */
export function generateStructuredDiff(
  oldContent: string,
  newContent: string,
  opts: UnifiedDiffOptions = {},
): StructuredDiff | null {
  const oldPath = opts.oldPath ?? 'a';
  const newPath = opts.newPath ?? 'b';
  const contextLines = opts.contextLines ?? 3;

  if (oldContent === newContent) return null;

  const patch = structuredPatch(oldPath, newPath, oldContent, newContent, undefined, undefined, {
    context: contextLines,
  });

  return {
    oldPath: patch.oldFileName ?? oldPath,
    newPath: patch.newFileName ?? newPath,
    hunks: patch.hunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines: h.lines,
    })),
  };
}
