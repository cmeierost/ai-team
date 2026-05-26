/**
 * Patch namespace — parse and apply standard unified diffs (--- / +++ / @@ format).
 *
 * Deliberately keeps its own parse + apply logic (built on the `parse-diff` package)
 * so it can be unit-tested independently from the tool layer.
 */

import parseDiff from 'parse-diff';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PatchType = 'add' | 'delete' | 'update' | 'move';

/**
 * A single hunk extracted from a unified diff — context-free representation
 * of which old lines should be replaced with which new lines.
 */
export interface ParsedHunk {
  /** 1-based line number in the OLD file where the hunk starts */
  oldStart: number;
  /** 1-based line number in the NEW file where the hunk starts */
  newStart: number;
  /** Old content lines (context + deleted), WITHOUT leading sign chars */
  oldLines: string[];
  /** New content lines (context + added), WITHOUT leading sign chars */
  newLines: string[];
  /** Whether this hunk was marked as end-of-file by the diff generator */
  eof: boolean;
}

/**
 * A per-file patch operation parsed from a unified diff string.
 */
export interface FileDiff {
  /** Path of the file before the change (stripped of `a/` prefix) */
  oldPath: string;
  /** Path of the file after the change (stripped of `b/` prefix) */
  newPath: string;
  /** Classification of the operation */
  type: PatchType;
  /** Ordered list of hunks to apply (empty for `delete`) */
  hunks: ParsedHunk[];
  /** Total context+deleted lines across all hunks */
  additions: number;
  /** Total context+added lines across all hunks */
  deletions: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalize CRLF → LF throughout a text block. */
function normalizeCrlf(text: string): string {
  return text.indexOf('\r') !== -1 ? text.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : text;
}

/**
 * Strip heredoc wrapper (`cat <<'EOF' ... EOF`) that LLMs sometimes wrap
 * patches in.  Supports quoting variants: `<<'EOF'`, `<<"EOF"`, `<<EOF`.
 * Returns the original text unchanged if no wrapper is detected.
 */
function stripHeredoc(text: string): string {
  const lines = text.split('\n');
  // Scan for a `cat <<` line near the top (allow a few blank/comment lines before it)
  let startIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (/^\s*cat\s+<<['"]?\w+['"]?\s*$/.test(lines[i]!)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return text;

  // Extract the tag name (e.g. EOF, PATCH)
  const tagMatch = lines[startIdx]!.match(/<<['"]?(\w+)['"]?/);
  if (!tagMatch) return text;
  const tag = tagMatch[1]!;

  // Find the closing tag from the bottom
  let endIdx = -1;
  for (let i = lines.length - 1; i > startIdx; i--) {
    if (lines[i]!.trim() === tag) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return text;

  // Return only the content between the heredoc delimiters
  return lines.slice(startIdx + 1, endIdx).join('\n');
}

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

function normalizeUnicode(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')    // double quotes
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-') // dashes
    .replace(/\u2026/g, '...')                      // ellipsis
    .replace(/\u00A0/g, ' ');                       // non-breaking space
}

type Comparator = (a: string, b: string) => boolean;

function tryMatch(
  lines: string[],
  pattern: string[],
  startIndex: number,
  compare: Comparator,
  eof: boolean,
): number {
  if (eof) {
    const fromEnd = lines.length - pattern.length;
    if (fromEnd >= startIndex) {
      let matches = true;
      for (let j = 0; j < pattern.length; j++) {
        if (!compare(lines[fromEnd + j]!, pattern[j]!)) {
          matches = false;
          break;
        }
      }
      if (matches) return fromEnd;
    }
  }

  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matches = true;
    for (let j = 0; j < pattern.length; j++) {
      if (!compare(lines[i + j]!, pattern[j]!)) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return -1;
}

/**
 * Locate `pattern` inside `lines` starting at `startIndex` using 4-pass fuzzy
 * matching (exact → trimEnd → trim → unicode-normalized+trim).
 * Returns the 0-based index of the first matching line, or -1 if not found.
 */
function seekSequence(
  lines: string[],
  pattern: string[],
  startIndex: number,
  eof = false,
): number {
  if (pattern.length === 0) return startIndex;

  // Pass 1: exact
  const exact = tryMatch(lines, pattern, startIndex, (a, b) => a === b, eof);
  if (exact !== -1) return exact;

  // Pass 2: trim trailing whitespace
  const rstrip = tryMatch(lines, pattern, startIndex, (a, b) => a.trimEnd() === b.trimEnd(), eof);
  if (rstrip !== -1) return rstrip;

  // Pass 3: trim both ends
  const trim = tryMatch(lines, pattern, startIndex, (a, b) => a.trim() === b.trim(), eof);
  if (trim !== -1) return trim;

  // Pass 4: unicode-normalised + trim
  const uni = tryMatch(
    lines,
    pattern,
    startIndex,
    (a, b) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()),
    eof,
  );
  if (uni !== -1) return uni;

  // Pass 5: retry without trailing empty line (LLMs sometimes add one)
  if (pattern.length > 1 && pattern[pattern.length - 1]!.trim() === '') {
    return seekSequence(lines, pattern.slice(0, -1), startIndex, eof);
  }

  return -1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace Patch {
  /**
   * Parse a standard unified diff string into a list of per-file `FileDiff`
   * descriptors.  Uses the `parse-diff` package internally, then classifies
   * each file entry by inspecting `/dev/null` presence:
   *
   * - `from === /dev/null`  → `add`   (new file)
   * - `to   === /dev/null`  → `delete` (removed file)
   * - `from !== to`         → `move`   (rename ± edits)
   * - otherwise             → `update`
   */
  export function parse(patchText: string): FileDiff[] {
    const cleaned = normalizeCrlf(stripHeredoc(patchText));
    const files = parseDiff(cleaned);
    const result: FileDiff[] = [];

    for (const file of files) {
      const oldPath = stripPrefix(file.from ?? '');
      const newPath = stripPrefix(file.to   ?? '');

      let type: PatchType;
      if (file.from === '/dev/null') {
        type = 'add';
      } else if (file.to === '/dev/null') {
        type = 'delete';
      } else if (oldPath !== newPath) {
        type = 'move';
      } else {
        type = 'update';
      }

      // Reconstruct ParsedHunk list from parse-diff chunk data.
      // parse-diff `changes` entries have a `type` of 'normal'|'add'|'del'
      // and a `content` that already includes the leading sign char.
      let totalAdditions = 0;
      let totalDeletions = 0;

      const hunks: ParsedHunk[] = (file.chunks ?? []).map((chunk) => {
        const oldLines: string[] = [];
        const newLines: string[] = [];

        for (const change of chunk.changes) {
          if (change.type === 'normal') {
            // context line: appears in both old and new
            oldLines.push(change.content.slice(1));
            newLines.push(change.content.slice(1));
          } else if (change.type === 'del') {
            oldLines.push(change.content.slice(1));
            totalDeletions++;
          } else if (change.type === 'add') {
            newLines.push(change.content.slice(1));
            totalAdditions++;
          }
        }

        const lastChange = chunk.changes[chunk.changes.length - 1];
        const eof =
          lastChange !== undefined &&
          'content' in lastChange &&
          lastChange.content === '\\ No newline at end of file';

        return {
          oldStart: chunk.oldStart,
          newStart: chunk.newStart,
          oldLines,
          newLines,
          eof,
        };
      });

      result.push({ oldPath, newPath, type, hunks, additions: totalAdditions, deletions: totalDeletions });
    }

    return result;
  }

  /**
   * Apply an ordered list of unified diff hunks to the given `fileContent`
   * string.  Hunks are located using fuzzy `seekSequence` matching so minor
   * trailing whitespace differences don't cause failures.
   *
   * For `add` operations (empty `fileContent`) the return value is the joined
   * new-file lines from the first hunk.
   *
   * @throws Error when a hunk cannot be located in the file content.
   */
  export function applyFileDiff(fileContent: string, hunks: ParsedHunk[]): string {
    if (hunks.length === 0) return fileContent;

    // Normalize CRLF so hunk matching works on Windows.
    const normalized = normalizeCrlf(fileContent);

    // For new files the content is empty and we just want the added lines.
    if (normalized === '') {
      const allNewLines: string[] = [];
      for (const hunk of hunks) {
        allNewLines.push(...hunk.newLines);
      }
      return allNewLines.join('\n');
    }

    const lines = normalized.split('\n');
    let cursor = 0;    // next search start (0-based index into `lines`)
    const patches: Array<{ at: number; deleteCount: number; insert: string[] }> = [];

    for (const hunk of hunks) {
      // The "old" context+deleted lines identify where the hunk starts.
      if (hunk.oldLines.length === 0) {
        // Pure-addition hunk (no context, no deletions) — insert at cursor.
        patches.push({ at: cursor, deleteCount: 0, insert: hunk.newLines });
        continue;
      }

      const found = seekSequence(lines, hunk.oldLines, cursor, hunk.eof);
      if (found === -1) {
        throw new Error(
          `apply_patch: hunk starting at old line ${hunk.oldStart} could not be located in the file.\n` +
          `Expected to find:\n${hunk.oldLines.slice(0, 3).map((l) => `  ${JSON.stringify(l)}`).join('\n')}`,
        );
      }

      patches.push({ at: found, deleteCount: hunk.oldLines.length, insert: hunk.newLines });
      cursor = found + hunk.oldLines.length;
    }

    // Apply patches in reverse order so earlier indices remain valid.
    const result = [...lines];
    for (const patch of [...patches].reverse()) {
      result.splice(patch.at, patch.deleteCount, ...patch.insert);
    }

    return result.join('\n');
  }
}
