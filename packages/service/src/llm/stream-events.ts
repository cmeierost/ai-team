/**
 * stream-events.ts — LLM streaming delta extraction.
 *
 * Keeps knowledge of the raw OpenAI streaming chunk shape in one place.
 */

// ── Delta extraction ──────────────────────────────────────────────────────────

export interface LlmStreamChunk {
  choices?: Array<{
    delta?: { content?: unknown; reasoning_content?: unknown };
  }>;
}

export interface StreamDeltaSegments {
  content: string;
  reasoning: string;
}

export class LlmStreamDeltaExtractor {
  extractSegments(chunk: LlmStreamChunk): StreamDeltaSegments {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      return { content: '', reasoning: '' };
    }

    return {
      content: this.extractDeltaSegmentText(delta.content),
      reasoning: this.extractDeltaSegmentText(delta.reasoning_content),
    };
  }

  /**
   * Extract the text delta from a single streaming chunk.
   * Handles string content and array-of-parts content.
   *
   * IMPORTANT: do not surface reasoning_content here. Provider reasoning traces are
   * internal chain-of-thought and must never be rendered to the user.
   */
  extractText(chunk: LlmStreamChunk): string {
    return this.extractSegments(chunk).content;
  }

  private extractDeltaSegmentText(value: unknown): string {
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
}
