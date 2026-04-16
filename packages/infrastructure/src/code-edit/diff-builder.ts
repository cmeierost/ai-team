import { createTwoFilesPatch } from 'diff';
import parseDiff from 'parse-diff';

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
export class DiffBuilder {
  /**
   * Create a unified diff between two versions of a file
   */
  createDiff(
    filePath: string,
    oldContent: string,
    newContent: string,
    options: DiffOptions = {}
  ): StructuredDiff {
    const { context = 3, oldLabel, newLabel } = options;

    const oldFileName = oldLabel || `${filePath} (before)`;
    const newFileName = newLabel || `${filePath} (after)`;

    // Generate unified diff
    const unifiedDiff = createTwoFilesPatch(
      oldFileName,
      newFileName,
      oldContent,
      newContent,
      undefined,
      undefined,
      { context }
    );

    // Parse the diff to get structured information
    const parsedDiffs = parseDiff(unifiedDiff);
    const parsedFile = parsedDiffs[0];

    if (!parsedFile) {
      // No changes
      return {
        filePath,
        hunks: [],
        additions: 0,
        deletions: 0,
        unifiedDiff: '',
      };
    }

    // Convert parsed hunks to our format
    const hunks: DiffHunk[] = parsedFile.chunks.map((chunk: any) => ({
      oldStart: chunk.oldStart,
      oldLines: chunk.oldLines,
      newStart: chunk.newStart,
      newLines: chunk.newLines,
      lines: chunk.changes.map((change: any) => {
        if (change.type === 'add') {
          return `+${change.content}`;
        } else if (change.type === 'del') {
          return `-${change.content}`;
        } else {
          return ` ${change.content}`;
        }
      }),
    }));

    return {
      filePath,
      hunks,
      additions: parsedFile.additions || 0,
      deletions: parsedFile.deletions || 0,
      unifiedDiff,
    };
  }

  /**
   * Create diffs for multiple files
   */
  createMultiFileDiff(
    files: Array<{ filePath: string; oldContent: string; newContent: string }>,
    options: DiffOptions = {}
  ): StructuredDiff[] {
    return files.map((file) =>
      this.createDiff(file.filePath, file.oldContent, file.newContent, options)
    );
  }

  /**
   * Apply a diff to content (patch)
   */
  applyDiff(originalContent: string, unifiedDiff: string): string | null {
    try {
      // Parse the diff
      const parsedDiffs = parseDiff(unifiedDiff);
      if (parsedDiffs.length === 0) {
        return originalContent;
      }

      const parsedFile = parsedDiffs[0];
      const lines = originalContent.split('\n');
      let offset = 0;

      for (const chunk of parsedFile.chunks) {
        const startLine = chunk.oldStart - 1 + offset;
        const deleteCount = chunk.oldLines;
        const additions: string[] = [];

        for (const change of chunk.changes) {
          if (change.type === 'add') {
            additions.push(change.content);
          } else if (change.type === 'del') {
            // Will be removed
          } else {
            // Normal line (context)
            additions.push(change.content);
          }
        }

        // Remove old lines and insert new ones
        lines.splice(startLine, deleteCount, ...additions);
        offset += additions.length - deleteCount;
      }

      return lines.join('\n');
    } catch (error) {
      console.error('Failed to apply diff:', error);
      return null;
    }
  }

  /**
   * Format a diff for terminal display with ANSI colors
   */
  formatForTerminal(diff: StructuredDiff): string {
    const RESET = '\x1b[0m';
    const RED = '\x1b[31m';
    const GREEN = '\x1b[32m';
    const CYAN = '\x1b[36m';
    const BOLD = '\x1b[1m';

    let output = `${BOLD}${CYAN}diff --git a/${diff.filePath} b/${diff.filePath}${RESET}\n`;
    output += `${BOLD}--- a/${diff.filePath}${RESET}\n`;
    output += `${BOLD}+++ b/${diff.filePath}${RESET}\n`;

    for (const hunk of diff.hunks) {
      output += `${CYAN}@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${RESET}\n`;

      for (const line of hunk.lines) {
        if (line.startsWith('+')) {
          output += `${GREEN}${line}${RESET}\n`;
        } else if (line.startsWith('-')) {
          output += `${RED}${line}${RESET}\n`;
        } else {
          output += `${line}\n`;
        }
      }
    }

    output += `\n${BOLD}Summary: ${GREEN}+${diff.additions}${RESET} ${BOLD}additions, ${RED}-${diff.deletions}${RESET} ${BOLD}deletions${RESET}\n`;

    return output;
  }

  /**
   * Get a summary of changes
   */
  getSummary(diffs: StructuredDiff[]): {
    filesChanged: number;
    totalAdditions: number;
    totalDeletions: number;
    files: string[];
  } {
    return {
      filesChanged: diffs.length,
      totalAdditions: diffs.reduce((sum, d) => sum + d.additions, 0),
      totalDeletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
      files: diffs.map((d) => d.filePath),
    };
  }

  /**
   * Check if a diff has any changes
   */
  hasChanges(diff: StructuredDiff): boolean {
    return diff.hunks.length > 0;
  }

  /**
   * Filter out diffs with no changes
   */
  filterEmptyDiffs(diffs: StructuredDiff[]): StructuredDiff[] {
    return diffs.filter((d) => this.hasChanges(d));
  }
}
