/**
 * Truncate large tool outputs so they fit within LLM context windows.
 *
 * When output exceeds the threshold, the overflow is written to a temp file
 * and a notice is appended pointing the model to it.
 */
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_MAX_LINES = 500;
const DEFAULT_MAX_BYTES = 100_000; // 100 KB

export namespace Truncate {
  /**
   * Truncate `text` to at most `maxLines` lines or `maxBytes` bytes.
   * If truncated, the overflow is written to a temp file and a notice is
   * appended to the returned string with the path to that file.
   */
  export function output(
    text: string,
    opts?: { maxLines?: number; maxBytes?: number },
  ): string {
    const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES;
    const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

    // Fast path — fits within both limits
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
      const lines = text.split('\n');
      if (lines.length <= maxLines) return text;
    }

    const lines = text.split('\n');
    let selectedLines = 0;
    let byteCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineBytes = Buffer.byteLength(lines[i], 'utf8') + 1; // +1 for '\n'
      if (i >= maxLines || byteCount + lineBytes > maxBytes) {
        selectedLines = i;
        break;
      }
      byteCount += lineBytes;
      selectedLines = i + 1;
    }

    const kept = lines.slice(0, selectedLines).join('\n');
    const overflow = lines.slice(selectedLines).join('\n');

    const tmpFile = path.join(
      os.tmpdir(),
      '.ai-team',
      `${crypto.randomBytes(6).toString('hex')}.txt`,
    );

    // Write overflow async — we don't await because output() is sync;
    // fire-and-forget is intentional here (temp diagnostics only)
    fs.mkdir(path.dirname(tmpFile), { recursive: true })
      .then(() => fs.writeFile(tmpFile, overflow, 'utf8'))
      .catch(() => {});

    const total = lines.length;
    const omitted = total - selectedLines;
    const notice = [
      '',
      `[Output truncated: showing ${selectedLines} of ${total} lines]`,
      `[${omitted} lines written to: ${tmpFile}]`,
      '[Use fs_read_lines to retrieve specific line ranges from that file]',
    ].join('\n');

    return kept + notice;
  }
}
