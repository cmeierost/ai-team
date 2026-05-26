import { describe, expect, it } from 'vitest';
import { Patch } from './patch.js';

// ============================================================================
// CRLF normalization
// ============================================================================

describe('Patch.parse — CRLF normalization', () => {
  it('parses a unified diff that uses CRLF line endings', () => {
    const patchText =
      '--- a/file.ts\r\n' +
      '+++ b/file.ts\r\n' +
      '@@ -1,3 +1,3 @@\r\n' +
      ' const x = 1;\r\n' +
      '-const y = 2;\r\n' +
      '+const y = 42;\r\n' +
      ' const z = 3;\r\n';

    const diffs = Patch.parse(patchText);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.type).toBe('update');
    expect(diffs[0]!.hunks).toHaveLength(1);
    expect(diffs[0]!.hunks[0]!.newLines).toContain('const y = 42;');
  });
});

describe('Patch.applyFileDiff — CRLF normalization', () => {
  it('applies hunks to file content with CRLF endings', () => {
    const fileContent = 'const x = 1;\r\nconst y = 2;\r\nconst z = 3;';
    const hunks = Patch.parse(
      '--- a/file.ts\n' +
      '+++ b/file.ts\n' +
      '@@ -1,3 +1,3 @@\n' +
      ' const x = 1;\n' +
      '-const y = 2;\n' +
      '+const y = 42;\n' +
      ' const z = 3;\n',
    )[0]!.hunks;

    const result = Patch.applyFileDiff(fileContent, hunks);
    expect(result).toContain('const y = 42;');
  });
});

// ============================================================================
// Heredoc stripping
// ============================================================================

describe('Patch.parse — heredoc stripping', () => {
  it('strips cat <<EOF wrapper before parsing', () => {
    const patchText = [
      "cat <<'EOF'",
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,3 +1,3 @@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 42;',
      ' const z = 3;',
      'EOF',
    ].join('\n');

    const diffs = Patch.parse(patchText);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.hunks[0]!.newLines).toContain('const y = 42;');
  });

  it('strips cat <<EOF (unquoted) wrapper', () => {
    const patchText = [
      'cat <<EOF',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      'EOF',
    ].join('\n');

    const diffs = Patch.parse(patchText);
    expect(diffs).toHaveLength(1);
  });

  it('strips cat <<"PATCH" wrapper with custom tag', () => {
    const patchText = [
      'cat <<"PATCH"',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      'PATCH',
    ].join('\n');

    const diffs = Patch.parse(patchText);
    expect(diffs).toHaveLength(1);
  });

  it('leaves normal patch text unchanged', () => {
    const patchText = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
    ].join('\n');

    const diffs = Patch.parse(patchText);
    expect(diffs).toHaveLength(1);
  });
});

// ============================================================================
// Trailing empty line retry in seekSequence (via applyFileDiff)
// ============================================================================

describe('Patch.applyFileDiff — trailing empty line retry', () => {
  it('applies hunk even when the old block has a trailing empty line that the file does not', () => {
    // Simulate an LLM diff where the context accidentally includes a trailing blank line
    const fileContent = 'function foo() {\n  return 1;\n}';
    const patchText = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,4 +1,4 @@',
      ' function foo() {',
      '-  return 1;',
      '+  return 42;',
      ' }',
      ' ',  // trailing context line (empty) — not in file
    ].join('\n');

    const diffs = Patch.parse(patchText);
    // This should not throw — trailing empty line retry kicks in
    const result = Patch.applyFileDiff(fileContent, diffs[0]!.hunks);
    expect(result).toContain('return 42;');
  });
});
