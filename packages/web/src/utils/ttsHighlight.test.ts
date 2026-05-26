import { describe, expect, it } from 'vitest';
import { resolveSpokenWordBoundary } from './ttsHighlight';

describe('resolveSpokenWordBoundary', () => {
  it('returns the correct occurrence for repeated words', () => {
    const text = 'alpha beta alpha gamma alpha';
    const thirdAlphaIndex = text.lastIndexOf('alpha');

    const result = resolveSpokenWordBoundary(text, thirdAlphaIndex);

    expect(result).toEqual({ word: 'alpha', occurrence: 2 });
  });

  it('handles apostrophes consistently across repeated words', () => {
    const text = "Don't stop. don't panic.";
    const secondDontIndex = text.toLocaleLowerCase().lastIndexOf("don't");

    const result = resolveSpokenWordBoundary(text, secondDontIndex);

    expect(result).toEqual({ word: "don't", occurrence: 1 });
  });

  it('falls forward to the next token for punctuation boundary positions', () => {
    const text = 'alpha, beta gamma';
    const commaIndex = text.indexOf(',');

    const result = resolveSpokenWordBoundary(text, commaIndex);

    expect(result).toEqual({ word: 'beta', occurrence: 0 });
  });

  it('returns null when there are no word tokens', () => {
    const result = resolveSpokenWordBoundary('... --- !!!', 2);

    expect(result).toBeNull();
  });

  it('treats slash-separated words as deterministic individual tokens', () => {
    const text = 'Install via npm/pnpm/yarn today';
    const pnpmIndex = text.indexOf('pnpm');

    const result = resolveSpokenWordBoundary(text, pnpmIndex);

    expect(result).toEqual({ word: 'pnpm', occurrence: 0 });
  });

  it('keeps repeated-word occurrence stable with slash-separated neighbors', () => {
    const text = 'read/read alpha beta alpha gamma';
    const secondAlphaIndex = text.lastIndexOf('alpha');

    const result = resolveSpokenWordBoundary(text, secondAlphaIndex);

    expect(result).toEqual({ word: 'alpha', occurrence: 1 });
  });
});
