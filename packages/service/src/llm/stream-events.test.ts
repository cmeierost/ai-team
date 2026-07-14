import { describe, expect, it } from 'vitest';

import { LlmStreamDeltaExtractor } from './stream-events.js';

describe('LlmStreamDeltaExtractor', () => {
  it('returns content text when present', () => {
    const extractor = new LlmStreamDeltaExtractor();
    const delta = extractor.extractText({
      choices: [
        {
          delta: {
            content: 'Hello developer',
            reasoning_content: 'Internal thinking that must not be shown',
          },
        },
      ],
    });

    expect(delta).toBe('Hello developer');
  });

  it('extracts reasoning_content into a separate segment', () => {
    const extractor = new LlmStreamDeltaExtractor();
    const delta = extractor.extractSegments({
      choices: [
        {
          delta: {
            reasoning_content: 'The user is asking for X, I should do Y',
          },
        },
      ],
    });

    expect(delta.content).toBe('');
    expect(delta.reasoning).toBe('The user is asking for X, I should do Y');
  });

  it('keeps extractText content-only for persistence-safe assistant text', () => {
    const extractor = new LlmStreamDeltaExtractor();
    const delta = extractor.extractText({
      choices: [
        {
          delta: {
            reasoning_content: 'internal thought',
          },
        },
      ],
    });

    expect(delta).toBe('');
  });
});
