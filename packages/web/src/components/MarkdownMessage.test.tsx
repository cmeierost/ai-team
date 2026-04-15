import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownMessage } from './MarkdownMessage';

describe('MarkdownMessage TTS highlight marker', () => {
  it('renders only one active marker for repeated words', () => {
    const { container } = render(
      <MarkdownMessage
        content="alpha beta alpha gamma alpha"
        highlightWord="alpha"
        highlightOccurrence={1}
      />
    );

    const markers = container.querySelectorAll('mark.tts-highlight');
    expect(markers).toHaveLength(1);
    expect(markers[0]?.textContent).toBe('alpha');

    const beforeMarker = document.createRange();
    beforeMarker.selectNodeContents(container);
    beforeMarker.setEndBefore(markers[0]);
    expect(beforeMarker.toString()).toContain('alpha beta ');
  });

  it('maps slash-separated tokens deterministically', () => {
    const { container } = render(
      <MarkdownMessage
        content="Install via npm/pnpm/yarn and pnpm later"
        highlightWord="pnpm"
        highlightOccurrence={0}
      />
    );

    const marker = container.querySelector('mark.tts-highlight');
    expect(marker?.textContent).toBe('pnpm');

    if (!marker) {
      throw new Error('Expected highlight marker to exist');
    }

    const beforeMarker = document.createRange();
    beforeMarker.selectNodeContents(container);
    beforeMarker.setEndBefore(marker);
    expect(beforeMarker.toString()).toContain('npm/');
  });

  it('scopes marker occurrence counting to the provided selection range', () => {
    const content = 'alpha beta alpha gamma';
    const { container } = render(
      <MarkdownMessage
        content={content}
        highlightWord="alpha"
        highlightOccurrence={0}
        highlightRangeStart={11}
        highlightRangeEnd={16}
      />
    );

    const marker = container.querySelector('mark.tts-highlight');
    expect(marker?.textContent).toBe('alpha');

    if (!marker) {
      throw new Error('Expected highlight marker to exist');
    }

    const beforeMarker = document.createRange();
    beforeMarker.selectNodeContents(container);
    beforeMarker.setEndBefore(marker);
    expect(beforeMarker.toString().endsWith('alpha beta ')).toBe(true);

    const text = container.textContent ?? '';
    expect(text.indexOf('alpha')).toBe(0);
    expect(text.lastIndexOf('alpha')).toBe(11);
  });
});
