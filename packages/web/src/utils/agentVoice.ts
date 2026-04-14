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
  return (
    text
      // fenced code blocks
      .replace(/```[\s\S]*?```/g, ' ')
      // inline code
      .replace(/`[^`]*`/g, ' ')
      // links — keep display text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // bare URLs
      .replace(/https?:\/\/\S+/g, ' ')
      // bold/italic
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
      // atx headings
      .replace(/^#{1,6}\s+/gm, '')
      // horizontal rules
      .replace(/^[-*]{3,}\s*$/gm, '')
      // extra whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}
