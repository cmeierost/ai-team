/**
 * Terminal text width utilities.
 */

/**
 * Skip past an ANSI escape sequence starting at position `start`.
 * Returns the index just after the sequence.
 */
function skipEscapeSequence(str: string, start: number): number {
  let i = start + 1;
  if (i >= str.length) return i;

  const second = str.codePointAt(i);
  if (second === undefined) return i + 1;

  if (second === 0x5b) {
    return skipCsiSequence(str, i + 1);
  }
  if (second === 0x5d || second === 0x50) {
    return skipOscOrApcSequence(str, i + 1);
  }

  return i;
}

function skipCsiSequence(str: string, i: number): number {
  while (i < str.length) {
    const cp = str.codePointAt(i);
    if (cp !== undefined && cp >= 0x40 && cp <= 0x7e) return i + 1;
    i++;
  }
  return i;
}

function skipOscOrApcSequence(str: string, i: number): number {
  while (i < str.length) {
    const cp = str.codePointAt(i);
    if (cp === undefined) break;
    if (cp === 0x07) return i + 1;
    if (cp === 0x1b && str.codePointAt(i + 1) === 0x5c) return i + 2;
    i++;
  }
  return i;
}

/**
 * Check if a Unicode code point is a wide (double-width) character.
 */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2329 && cp <= 0x232a) || // Specific wide chars
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || // CJK
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe10 && cp <= 0xfe19) || // Vertical forms
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth ASCII
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth symbols
    (cp >= 0x20000 && cp <= 0x2fffd) || // CJK Extension B+
    (cp >= 0x30000 && cp <= 0x3fffd) // CJK Extension G+
  );
}

/**
 * Calculate the visible width of a string (excluding ANSI escape sequences).
 */
export function visibleWidth(str: string): number {
  let width = 0;
  let i = 0;

  while (i < str.length) {
    const cp = str.codePointAt(i);
    if (cp === undefined) break;

    // ANSI escape sequence
    if (cp === 0x1b) {
      i = skipEscapeSequence(str, i);
      continue;
    }

    width += isWideCodePoint(cp) ? 2 : 1;
    i++;
  }

  return width;
}

/**
 * Truncate a string to a maximum visible width.
 */
export function truncateToWidth(str: string, maxWidth: number): string {
  if (visibleWidth(str) <= maxWidth) return str;

  let result = '';
  let width = 0;

  for (let i = 0; i < str.length; ) {
    const cp = str.codePointAt(i);
    if (cp === undefined) break;

    // Skip ANSI sequences
    if (cp === 0x1b) {
      const seqEnd = skipEscapeSequence(str, i);
      result += str.slice(i, seqEnd);
      i = seqEnd;
      continue;
    }

    const charWidth = isWideCodePoint(cp) ? 2 : 1;
    if (width + charWidth > maxWidth) break;

    result += str[i];
    width += charWidth;
    i++;
  }

  return result;
}

/**
 * Slice a string by visible column positions.
 */
export function sliceByColumn(str: string, start: number, length: number, pad = false): string {
  const result = sliceByColumnCore(str, start, length);

  if (pad) {
    const currentWidth = visibleWidth(result);
    if (currentWidth < length) {
      return result + ' '.repeat(length - currentWidth);
    }
  }

  return result;
}

function sliceByColumnCore(str: string, start: number, length: number): string {
  let result = '';
  let col = 0;
  const endCol = start + length;

  for (let i = 0; i < str.length; ) {
    const cp = str.codePointAt(i);
    if (cp === undefined) break;

    if (cp === 0x1b) {
      const seqEnd = skipEscapeSequence(str, i);
      // Escape sequences have zero visible width but establish the style state
      // needed by later columns. Replay sequences from the skipped prefix so a
      // wrapped slice retains its active foreground/background/inline styles.
      result += str.slice(i, seqEnd);
      i = seqEnd;
      continue;
    }

    const charWidth = isWideCodePoint(cp) ? 2 : 1;

    if (col >= start && col + charWidth <= endCol) {
      result += str[i];
    } else if (col >= endCol) {
      break;
    }

    col += charWidth;
    i++;
  }

  return result;
}
