export interface ResolvedSpokenWordBoundary {
  word: string;
  occurrence: number;
}

interface WordToken {
  word: string;
  normalized: string;
  start: number;
  end: number;
}

const WORD_TOKEN_REGEX = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function normalizeToken(token: string): string {
  return token.replaceAll('’', "'").toLocaleLowerCase();
}

function collectWordTokens(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(WORD_TOKEN_REGEX)) {
    const word = match[0];
    const start = match.index ?? -1;
    if (start < 0) {
      continue;
    }

    tokens.push({
      word,
      normalized: normalizeToken(word),
      start,
      end: start + word.length,
    });
  }

  return tokens;
}

function findTokenIndexForCharPosition(tokens: readonly WordToken[], position: number): number {
  if (tokens.length === 0) {
    return -1;
  }

  const withinIndex = tokens.findIndex((token) => token.start <= position && position < token.end);
  if (withinIndex >= 0) {
    return withinIndex;
  }

  const nextIndex = tokens.findIndex((token) => token.start > position);
  if (nextIndex >= 0) {
    return nextIndex;
  }

  return tokens.length - 1;
}

export function resolveSpokenWordBoundary(
  utteranceText: string,
  charIndex: number
): ResolvedSpokenWordBoundary | null {
  if (!utteranceText.trim()) {
    return null;
  }

  const tokens = collectWordTokens(utteranceText);
  if (tokens.length === 0) {
    return null;
  }

  const clampedPosition = Math.max(0, Math.min(charIndex, utteranceText.length));
  const tokenIndex = findTokenIndexForCharPosition(tokens, clampedPosition);
  if (tokenIndex < 0) {
    return null;
  }

  const token = tokens[tokenIndex];
  let occurrence = 0;
  for (let index = 0; index < tokenIndex; index += 1) {
    if (tokens[index].normalized === token.normalized) {
      occurrence += 1;
    }
  }

  return { word: token.word, occurrence };
}
