import type { Agent } from '../types';

/**
 * Deterministic hash of a string to a positive integer.
 * Used to reproducibly assign a voice to an agent by ID.
 */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Pick a browser voice for the given agent.
 *
 * Strategy:
 * 1. If the agent has an explicit `ttsVoice` hint → exact name match, then
 *    case-insensitive includes match.
 * 2. If no hint → assign a voice deterministically from the full available
 *    list using a hash of the agent ID, so every agent always gets the same
 *    distinct voice and no two agents share a voice unless voices are scarce.
 */
export function pickVoice(
  agent: Agent | null | undefined,
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | undefined {
  if (!agent || voices.length === 0) return undefined;

  const hint = agent.ttsVoice?.trim();

  // Explicit voice hint — respect it exactly.
  if (hint) {
    const exact = voices.find((v) => v.name === hint);
    if (exact) return exact;
    const lower = hint.toLowerCase();
    return voices.find((v) => v.name.toLowerCase().includes(lower));
  }

  // No hint — assign deterministically from the full voice list so each
  // agent always sounds distinct and consistent.
  const index = hashString(agent.id) % voices.length;
  return voices[index];
}

function isCodeLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  const startsWithToken = [
    'import ',
    'export ',
    'const ',
    'let ',
    'var ',
    'function ',
    'class ',
    'interface ',
    'type ',
    'return ',
    '#include ',
  ].some((token) => trimmed.startsWith(token));

  if (startsWithToken) {
    return true;
  }

  if (/^(if|for|while)\s*\(/.test(trimmed)) {
    return true;
  }

  if (/^(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(trimmed)) {
    return true;
  }

  if (/^<\/?[A-Za-z]/.test(trimmed)) {
    return true;
  }

  return /[{}[\];=<>]/.test(trimmed);
}

function removeLargeCodeLikeChunks(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];

  let index = 0;
  while (index < lines.length) {
    if (!isCodeLikeLine(lines[index])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    let next = index;
    while (next < lines.length && isCodeLikeLine(lines[next])) {
      next += 1;
    }

    if (next - index >= 4) {
      output.push(' ');
    } else {
      output.push(...lines.slice(index, next));
    }

    index = next;
  }

  return output.join('\n');
}

/**
 * Strip markdown syntax that would sound poor when spoken aloud:
 * - Fenced code blocks (``` ... ```)
 * - Inline code (`...`)
 * - Bold/italic markers (**text**, *text*, __text__, _text_)
 * - Headers (#, ##, ...)
 * - Horizontal rules (--- / ***)
 * - URLs in links [text](url) → keep the text
 * - Bare URLs
 */
export function stripMarkdownForSpeech(text: string): string {
  const withoutCodeBlocks = removeLargeCodeLikeChunks(
    text
      // complete fenced code blocks (```...``` and ~~~...~~~)
      .replaceAll(/(```|~~~)[\s\S]*?\1/g, ' ')
      // dangling/unclosed fenced blocks while streaming
      .replaceAll(/(```|~~~)[\s\S]*$/g, ' ')
  );

  return (
    withoutCodeBlocks
      // inline code — keep content, strip markdown backticks
      .replaceAll(/`([^`]*)`/g, '$1')
      // links — keep display text
      .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // bare URLs
      .replaceAll(/https?:\/\/\S+/g, ' ')
      // bold/italic
      .replaceAll(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
      // atx headings
      .replaceAll(/^#{1,6}\s+/gm, '')
      // horizontal rules
      .replaceAll(/^[-*]{3,}\s*$/gm, '')
      // extra whitespace
      .replaceAll(/\s+/g, ' ')
      .trim()
  );
}
