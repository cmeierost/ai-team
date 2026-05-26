import type { GlobalContext, ParsedPermFile, PatternToken, ResolvedContext } from './types.js';
import { applyOrderedTokens, collectDenyPatterns, removeMatchingPatterns } from './glob-engine.js';

function isInheritStart(tokens: PatternToken[]): boolean {
  if (tokens.length === 0) return false;
  const first = tokens[0];
  return first.kind === 'inherit' || first.kind === 'deny';
}

function resolveSection(
  tokens: PatternToken[],
  lowerBase: Set<string>,
  globalFiles: Set<string>,
  filesystemFiles?: Set<string>,
): Set<string> {
  const start = isInheritStart(tokens) ? new Set(lowerBase) : new Set<string>();
  return applyOrderedTokens(start, tokens, globalFiles, filesystemFiles);
}

export function resolveContext(
  perm: ParsedPermFile,
  global: GlobalContext,
  filesystemFiles?: Set<string>,
): ResolvedContext {
  const { list: listTokens, read: readTokens, write: writeTokens } = perm.sections;
  const globalFiles = global.files;

  // A) Resolve each section independently (with ordered eval)
  const listRaw = listTokens.length > 0
    ? resolveSection(listTokens, globalFiles, globalFiles, filesystemFiles)
    : new Set(globalFiles);

  const readRaw = readTokens.length > 0
    ? resolveSection(readTokens, listRaw, globalFiles, filesystemFiles)
    : new Set<string>();

  const writeRaw = writeTokens.length > 0
    ? resolveSection(writeTokens, readRaw, globalFiles, filesystemFiles)
    : new Set<string>();

  // B) Cross-section negative propagation
  const listNegs = collectDenyPatterns(listTokens);
  const readNegs = collectDenyPatterns(readTokens);

  const readResult = removeMatchingPatterns(readRaw, listNegs);
  const allNegs = [...listNegs, ...readNegs];
  const writeResult = removeMatchingPatterns(writeRaw, allNegs);

  // C) Downward closure from resulting file sets
  const write = writeResult;
  const read = new Set(readResult);
  for (const f of write) read.add(f);
  const list = new Set(listRaw);
  for (const f of read) list.add(f);

  return { list, read, write };
}
