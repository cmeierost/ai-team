const LINE_NUM_RE = /^(\d+): /;

/**
 * Detect and strip `read`-style line-number prefixes (`N: `) from text.
 *
 * Only strips when the pattern is unambiguous: ≥ 80 % of lines match and
 * the detected numbers are strictly sequential — matching `read` output.
 */
export function stripLineNumberPrefixes(text: string): { text: string; stripped: boolean } {
  const lines = text.split('\n');
  if (lines.length < 2) return { text, stripped: false };

  const matches: Array<{ index: number; num: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(LINE_NUM_RE).exec(lines[i]);
    if (m) matches.push({ index: i, num: Number.parseInt(m[1], 10) });
  }

  if (matches.length / lines.length < 0.8) return { text, stripped: false };

  for (let i = 1; i < matches.length; i++) {
    if (matches[i].num !== matches[i - 1].num + 1) return { text, stripped: false };
  }

  const cleaned = lines
    .map((line) => {
      const m = new RegExp(LINE_NUM_RE).exec(line);
      return m ? line.slice(m[0].length) : line;
    })
    .join('\n');
  return { text: cleaned, stripped: true };
}
