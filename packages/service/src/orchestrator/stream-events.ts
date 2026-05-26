/**
 * stream-events.ts — LLM streaming delta extraction.
 *
 * Keeps knowledge of the raw OpenAI streaming chunk shape in one place.
 */

// ── Delta extraction ──────────────────────────────────────────────────────────

type StreamChunk = {
  choices?: Array<{
    delta?: { content?: unknown; reasoning_content?: unknown };
  }>;
};

/**
 * Extract the text delta from a single streaming chunk.
 * Handles string content, array-of-parts content, and reasoning_content.
 */
export function extractStreamDeltaText(chunk: StreamChunk): string {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return '';

  const content = extractDeltaSegmentText(delta.content);
  if (content) return content;

  return extractDeltaSegmentText(delta.reasoning_content);
}

function extractDeltaSegmentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';

  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') return text;
      const nested = (part as { content?: unknown }).content;
      return typeof nested === 'string' ? nested : '';
    })
    .join('');
}
