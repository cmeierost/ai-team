import { describe, expect, it } from 'vitest';
import { fuzzyFind, fuzzyReplace } from './fuzzy-replace.js';

// ============================================================================
// fuzzyFind
// ============================================================================

describe('fuzzyFind', () => {
  it('returns exact match when present', () => {
    const m = fuzzyFind('const x = 1;', 'x = 1', false);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('exact');
    expect(m!.matchedText).toBe('x = 1');
  });

  it('returns null for exact match with multiple occurrences when replaceAll is false', () => {
    const m = fuzzyFind('aaa\nbbb\naaa', 'aaa', false);
    expect(m).toBeNull();
  });

  it('allows exact match with multiple occurrences when replaceAll is true', () => {
    const m = fuzzyFind('aaa\nbbb\naaa', 'aaa', true);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('exact');
  });

  it('matches with trimmed trailing whitespace', () => {
    const content = 'const x = 1;  \n  const y = 2;\n';
    const needle  = 'const x = 1;\n  const y = 2;';
    const m = fuzzyFind(content, needle, false);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('trimmed-lines');
  });

  it('matches with collapsed whitespace', () => {
    const content = 'const   x   =   1;';
    const needle  = 'const x = 1;';
    const m = fuzzyFind(content, needle, false);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('whitespace-normalized');
  });

  it('matches with different indentation', () => {
    // Two lines whose internal whitespace differs (tab vs space) but collapse
    // the same way under collapseWs (count=2 → skip). stripIndent preserves
    // the tab so only line 1 matches (count=1 → hit).
    const content = '        val\t= 1\n    val = 1';
    const needle  = '            val\t= 1';
    const m = fuzzyFind(content, needle, false);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('indentation-flexible');
  });

  it('matches with unicode smart quotes', () => {
    const content = "const name = 'hello';";
    const needle  = 'const name = \u2018hello\u2019;';
    const m = fuzzyFind(content, needle, false);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('unicode-normalized');
  });

  it('matches with CRLF at line endings (caught by trimmed-lines)', () => {
    // \r at end of lines is stripped by trimEnd, so trimmed-lines catches it
    const content = 'line1\r\nline2\r\n';
    const needle  = 'line1\nline2\n';
    const m = fuzzyFind(content, needle, false);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('trimmed-lines');
  });

  it('matches with stray \\r in the middle of a line (crlf-normalized)', () => {
    // \r embedded mid-line is NOT caught by trimEnd — so crlf-normalized fires
    const content = 'hello\rworld';
    const needle  = 'hello\nworld';
    const m = fuzzyFind(content, needle, false);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('crlf-normalized');
  });

  it('matches via block-anchor when first+last lines match and line count matches', () => {
    const content = 'function test() {\n  // comment A\n  return true;\n}';
    const needle  = 'function test() {\n  // different comment\n  return true;\n}';
    const m = fuzzyFind(content, needle, false);
    expect(m).not.toBeNull();
    expect(m!.stage).toBe('block-anchor');
    expect(m!.matchedText.split('\n')).toHaveLength(4);
  });

  it('matches via levenshtein for small differences', () => {
    const content = 'function hello() {\n  return "world";\n}';
    const needle  = 'function helo() {\n  return "world";\n}';
    const m = fuzzyFind(content, needle, false);
    expect(m).not.toBeNull();
    // Could be block-anchor or levenshtein depending on first/last line match
    expect(['block-anchor', 'levenshtein']).toContain(m!.stage);
  });

  it('returns null when nothing matches', () => {
    const m = fuzzyFind('completely different content', 'nothing here matches', false);
    expect(m).toBeNull();
  });
});

// ============================================================================
// fuzzyReplace
// ============================================================================

describe('fuzzyReplace', () => {
  it('performs exact single replacement', () => {
    const result = fuzzyReplace('const x = 1;\nconst y = 2;', 'const x = 1;', 'const x = 42;');
    expect(result).not.toBeNull();
    expect(result!.stage).toBe('exact');
    expect(result!.replacements).toBe(1);
    expect(result!.content).toBe('const x = 42;\nconst y = 2;');
  });

  it('performs exact replaceAll', () => {
    const result = fuzzyReplace('aaa\nbbb\naaa', 'aaa', 'ccc', true);
    expect(result).not.toBeNull();
    expect(result!.stage).toBe('exact');
    expect(result!.replacements).toBe(2);
    expect(result!.content).toBe('ccc\nbbb\nccc');
  });

  it('replaces with trimmed whitespace matching', () => {
    const content = 'const x = 1;  \nconst y = 2;';
    const result = fuzzyReplace(content, 'const x = 1;\nconst y = 2;', 'replaced');
    expect(result).not.toBeNull();
    expect(result!.stage).toBe('trimmed-lines');
    expect(result!.content).toContain('replaced');
  });

  it('replaces with different indentation and verifies content', () => {
    // Same pattern as the fuzzyFind indentation test.
    const content = '        val\t= 1\n    val = 1';
    const needle  = '            val\t= 1';
    const result = fuzzyReplace(content, needle, 'REPLACED');
    expect(result).not.toBeNull();
    expect(result!.stage).toBe('indentation-flexible');
    expect(result!.content).toContain('REPLACED');
    // Second line (space-separated variant) must survive untouched
    expect(result!.content).toContain('val = 1');
  });

  it('returns null when no match at any stage', () => {
    const result = fuzzyReplace('hello world', 'completely different', 'replacement');
    expect(result).toBeNull();
  });
});
