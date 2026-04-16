/**
 * Fuzzy string-replacement pipeline for surgical file edits.
 *
 * When an exact `oldString` match fails, this module tries progressively
 * looser matching strategies to recover from common LLM whitespace,
 * indentation, and encoding mistakes.
 *
 * Pipeline stages (first match wins):
 *  1. Exact                — `content.indexOf(oldString)`
 *  2. Trimmed lines        — trim trailing whitespace on every line of both
 *  3. Whitespace-normalized— collapse runs of whitespace to single space
 *  4. Indentation-flexible — ignore leading whitespace per line
 *  5. Unicode-normalized   — smart quotes, dashes, NBSP → ASCII equivalents
 *  6. CRLF-normalized      — `\r\n → \n` before comparing
 *  7. Combined             — all normalizations at once
 *  8. Block-anchor         — match first + last line, verify inner line count
 *  9. Levenshtein          — character-level edit distance within a threshold
 *
 * Each stage locates the match in the original (un-normalized) content so the
 * replacement preserves surrounding bytes exactly.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FuzzyMatch {
  /** The matched substring in the original content (may differ from oldString). */
  matchedText: string;
  /** 0-based character offset in the original content. */
  index: number;
  /** Which pipeline stage produced the match. */
  stage: FuzzyStage;
}

export type FuzzyStage =
  | 'exact'
  | 'trimmed-lines'
  | 'whitespace-normalized'
  | 'indentation-flexible'
  | 'unicode-normalized'
  | 'crlf-normalized'
  | 'combined'
  | 'block-anchor'
  | 'levenshtein';

export interface FuzzyReplaceResult {
  /** The content with the replacement applied. */
  content: string;
  /** How the match was found. */
  stage: FuzzyStage;
  /** How many replacements were made. */
  replacements: number;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normCrlf(s: string): string {
  return s.indexOf('\r') !== -1 ? s.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : s;
}

function normUnicode(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ');
}

function trimLines(s: string): string {
  return s.split('\n').map(l => l.trimEnd()).join('\n');
}

function collapseWs(s: string): string {
  return s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n');
}

function stripIndent(s: string): string {
  return s.split('\n').map(l => l.trimStart()).join('\n');
}

function combinedNorm(s: string): string {
  return collapseWs(normUnicode(normCrlf(s)));
}

// ---------------------------------------------------------------------------
// Line-based search helpers
// ---------------------------------------------------------------------------

/**
 * Find `needle` inside `haystack` after applying a normalization function to
 * both.  When found, maps back to the original haystack text by scanning for
 * the correct char offset.
 *
 * Returns the matched substring in the *original* haystack.
 */
function findNormalized(
  haystack: string,
  needle: string,
  normalize: (s: string) => string,
): { matchedText: string; index: number } | null {
  const nh = normalize(haystack);
  const nn = normalize(needle);
  const ni = nh.indexOf(nn);
  if (ni === -1) return null;

  // Map normalized offset back to original.
  // Strategy: normalize prefix of haystack char-by-char until we reach `ni`
  // characters of output — that gives us the start offset in original.
  // Then find the end the same way.
  const start = mapOffset(haystack, normalize, ni);
  const end = mapOffset(haystack, normalize, ni + nn.length);

  return { matchedText: haystack.slice(start, end), index: start };
}

/**
 * Map a character offset in the normalized string back to the original string.
 */
function mapOffset(
  original: string,
  normalize: (s: string) => string,
  normalizedOffset: number,
): number {
  // Binary search: find smallest `i` such that normalize(original[0..i]).length >= normalizedOffset
  let lo = 0;
  let hi = original.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (normalize(original.slice(0, mid)).length < normalizedOffset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Block-anchor matching (stage 8)
// ---------------------------------------------------------------------------

function blockAnchorMatch(content: string, oldString: string): { matchedText: string; index: number } | null {
  const oldLines = oldString.split('\n');
  if (oldLines.length < 3) return null; // need at least 3 lines to anchor

  const firstLine = oldLines[0]!.trim();
  const lastLine = oldLines[oldLines.length - 1]!.trim();
  if (!firstLine || !lastLine) return null;

  const contentLines = content.split('\n');
  const expectedInner = oldLines.length;

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i]!.trim() !== firstLine) continue;

    // Check if the last line matches at the expected offset
    const endIdx = i + expectedInner - 1;
    if (endIdx >= contentLines.length) continue;
    if (contentLines[endIdx]!.trim() !== lastLine) continue;

    // Verify inner line count matches
    const startCharIdx = content.split('\n').slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
    const endCharIdx = content.split('\n').slice(0, endIdx + 1).join('\n').length;
    const matchedText = content.slice(startCharIdx, endCharIdx);

    // Sanity: matched block should have the same number of lines
    if (matchedText.split('\n').length !== expectedInner) continue;

    return { matchedText, index: startCharIdx };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Levenshtein matching (stage 9)
// ---------------------------------------------------------------------------

/** Simple Levenshtein distance for two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows instead of full matrix for memory efficiency
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,       // deletion
        curr[j - 1]! + 1,   // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Slide a window of approximately `needle.length` chars over `haystack` and
 * find the best Levenshtein match below the threshold.
 * Threshold: 10% of needle length, minimum 3, maximum 20.
 */
function levenshteinMatch(content: string, oldString: string): { matchedText: string; index: number } | null {
  const threshold = Math.min(20, Math.max(3, Math.floor(oldString.length * 0.10)));

  // Line-based sliding window for performance
  const needleLines = oldString.split('\n');
  const contentLines = content.split('\n');
  if (needleLines.length > contentLines.length) return null;

  let bestDist = threshold + 1;
  let bestStart = -1;
  let bestEnd = -1;

  for (let i = 0; i <= contentLines.length - needleLines.length; i++) {
    const candidateText = contentLines.slice(i, i + needleLines.length).join('\n');
    const dist = levenshtein(candidateText, oldString);
    if (dist < bestDist) {
      bestDist = dist;
      bestStart = i;
      bestEnd = i + needleLines.length;
    }
    // Early exit on perfect-ish match
    if (bestDist <= 1) break;
  }

  if (bestStart === -1) return null;

  // Convert line range to char offset
  const startCharIdx = contentLines.slice(0, bestStart).join('\n').length + (bestStart > 0 ? 1 : 0);
  const endCharIdx = contentLines.slice(0, bestEnd).join('\n').length;
  return { matchedText: content.slice(startCharIdx, endCharIdx), index: startCharIdx };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Count how many times `needle` appears in `haystack` using a given
 * normalization.  Used to check uniqueness before committing a fuzzy match.
 */
function countNormalized(haystack: string, needle: string, normalize: (s: string) => string): number {
  const nh = normalize(haystack);
  const nn = normalize(needle);
  if (nn.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = nh.indexOf(nn, pos)) !== -1) {
    count++;
    pos += nn.length;
  }
  return count;
}

/**
 * Try to locate `oldString` in `content` using the fuzzy pipeline.
 * Returns the first successful match, or null if nothing matches.
 *
 * When `replaceAll` is false, a stage is only accepted if it finds exactly one
 * occurrence to avoid ambiguous replacements.
 */
export function fuzzyFind(
  content: string,
  oldString: string,
  replaceAll: boolean,
): FuzzyMatch | null {
  // Stage 1: exact
  {
    const idx = content.indexOf(oldString);
    if (idx !== -1) {
      if (!replaceAll && content.indexOf(oldString, idx + oldString.length) !== -1) return null; // ambiguous
      return { matchedText: oldString, index: idx, stage: 'exact' };
    }
  }

  // Stages 2-7: normalized searches
  const stages: Array<[FuzzyStage, (s: string) => string]> = [
    ['trimmed-lines', trimLines],
    ['whitespace-normalized', collapseWs],
    ['indentation-flexible', stripIndent],
    ['unicode-normalized', normUnicode],
    ['crlf-normalized', normCrlf],
    ['combined', combinedNorm],
  ];

  for (const [stage, normalize] of stages) {
    if (!replaceAll) {
      const count = countNormalized(content, oldString, normalize);
      if (count !== 1) continue;
    }
    const found = findNormalized(content, oldString, normalize);
    if (found) return { ...found, stage };
  }

  // Stage 8: block-anchor
  if (!replaceAll) {
    const anchor = blockAnchorMatch(content, oldString);
    if (anchor) return { ...anchor, stage: 'block-anchor' };
  }

  // Stage 9: Levenshtein
  if (!replaceAll) {
    const lev = levenshteinMatch(content, oldString);
    if (lev) return { ...lev, stage: 'levenshtein' };
  }

  return null;
}

/**
 * Replace `oldString` with `newString` in `content` using the fuzzy pipeline.
 * Returns null if no match is found at any stage.
 */
export function fuzzyReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): FuzzyReplaceResult | null {
  const match = fuzzyFind(content, oldString, replaceAll);
  if (!match) return null;

  if (replaceAll) {
    // For replaceAll we need to handle the normalized matching specially.
    // If exact stage, use split/join. Otherwise use the matched text form.
    if (match.stage === 'exact') {
      const parts = content.split(oldString);
      return { content: parts.join(newString), stage: 'exact', replacements: parts.length - 1 };
    }
    // For fuzzy replaceAll, replace ALL occurrences of the matchedText form
    const parts = content.split(match.matchedText);
    return { content: parts.join(newString), stage: match.stage, replacements: parts.length - 1 };
  }

  // Single replacement: splice at the match position
  const result = content.slice(0, match.index) + newString + content.slice(match.index + match.matchedText.length);
  return { content: result, stage: match.stage, replacements: 1 };
}
