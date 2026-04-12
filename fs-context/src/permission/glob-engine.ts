import { minimatch } from 'minimatch';
import type { PatternToken } from './types.js';

const MINIMATCH_OPTS = { dot: true } as const;

const matcherCache = new Map<string, (path: string) => boolean>();

/**
 * Gitignore convention: patterns without `/` match against any depth.
 * E.g. `*.yml` should match `src/web/config.yml`.
 */
function normalizePattern(pattern: string): string {
  if (!pattern.includes('/')) return `**/${pattern}`;
  return pattern;
}

function getCompiledMatcher(pattern: string): (path: string) => boolean {
  let matcher = matcherCache.get(pattern);
  if (!matcher) {
    const normalized = normalizePattern(pattern);
    matcher = minimatch.filter(normalized, MINIMATCH_OPTS);
    matcherCache.set(pattern, matcher);
  }
  return matcher;
}

export function matchesPattern(filePath: string, pattern: string): boolean {
  return getCompiledMatcher(pattern)(filePath);
}

export function matchInSet(files: Set<string>, pattern: string): Set<string> {
  const matcher = getCompiledMatcher(pattern);
  const result = new Set<string>();
  for (const f of files) {
    if (matcher(f)) result.add(f);
  }
  return result;
}

export function applyOrderedTokens(
  start: Set<string>,
  tokens: PatternToken[],
  globalFiles: Set<string>,
  filesystemFiles?: Set<string>,
): Set<string> {
  const running = new Set(start);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.kind) {
      case 'inherit':
        // Only meaningful as first token (start-set); mid-section is no-op.
        break;

      case 'allow': {
        const pattern = token.pattern!;
        const source = token.bypass ? (filesystemFiles ?? globalFiles) : globalFiles;
        const matched = matchInSet(source, pattern);
        for (const f of matched) running.add(f);
        break;
      }

      case 'deny': {
        const pattern = token.pattern!;
        const matched = matchInSet(running, pattern);
        for (const f of matched) running.delete(f);
        break;
      }
    }
  }

  return running;
}

export function collectDenyPatterns(tokens: PatternToken[]): string[] {
  const patterns: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'deny' && t.pattern) {
      patterns.push(t.pattern);
    }
  }
  return patterns;
}

export function removeMatchingPatterns(
  files: Set<string>,
  denyPatterns: string[],
): Set<string> {
  if (denyPatterns.length === 0) return files;
  const result = new Set(files);
  for (const pattern of denyPatterns) {
    const matcher = getCompiledMatcher(pattern);
    for (const f of result) {
      if (matcher(f)) result.delete(f);
    }
  }
  return result;
}

export function clearMatcherCache(): void {
  matcherCache.clear();
}
