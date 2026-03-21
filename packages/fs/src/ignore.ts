/**
 * Consolidated gitignore / workspace-ignore utilities.
 *
 * Used by file-tree, file-tree-cache, and available for any module that needs
 * to decide whether a workspace-relative path should be skipped.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';

// ============================================================================
// Constants
// ============================================================================

/** Directory basenames that are hard-excluded from every workspace scan. */
export const ALWAYS_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.pnpm-store',
]);

// ============================================================================
// Gitignore rule model
// ============================================================================

export interface IgnoreRule {
  negate: boolean;
  dirOnly: boolean;
  /** Normalised minimatch pattern */
  normalized: string;
}

export function parseGitignoreContent(content: string): IgnoreRule[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map((l): IgnoreRule => {
      const negate = l.startsWith('!');
      let pat = negate ? l.slice(1) : l;

      const dirOnly = pat.endsWith('/');
      if (dirOnly) pat = pat.slice(0, -1);

      // A pattern without an internal slash matches anywhere in the tree
      const normalized = pat.includes('/') ? pat : `**/${pat}`;
      return { negate, dirOnly, normalized };
    });
}

// ============================================================================
// Per-run gitignore read cache
// ============================================================================

const gitignoreCache = new Map<string, IgnoreRule[]>();

/** Clear the per-run gitignore read cache. Call at the start of each top-level scan. */
export function clearGitignoreCache(): void {
  gitignoreCache.clear();
}

export async function readDirGitignore(dir: string): Promise<IgnoreRule[]> {
  if (gitignoreCache.has(dir)) return gitignoreCache.get(dir)!;
  try {
    const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    const rules = parseGitignoreContent(content);
    gitignoreCache.set(dir, rules);
    return rules;
  } catch {
    gitignoreCache.set(dir, []);
    return [];
  }
}

/**
 * Collect all applicable gitignore rule-sets for a directory.
 * Walks from workspace root down to dirPath so outer rules apply first.
 */
export async function collectGitignoreRules(
  workspaceRoot: string,
  dirPath: string,
): Promise<IgnoreRule[][]> {
  const rel = path.relative(workspaceRoot, dirPath);
  const parts = rel ? rel.split(path.sep) : [];
  const dirs = [workspaceRoot];
  for (const p of parts) dirs.push(path.join(dirs.at(-1)!, p));
  return Promise.all(dirs.map(readDirGitignore));
}

// ============================================================================
// Matching
// ============================================================================

/**
 * Evaluate layered gitignore rule-sets. Returns true when the path should be
 * considered ignored.
 */
export function isIgnoredByRules(
  relPath: string,
  isDirectory: boolean,
  ruleSets: IgnoreRule[][],
): boolean {
  let ignored = false;
  for (const rules of ruleSets) {
    for (const rule of rules) {
      if (rule.dirOnly && !isDirectory) continue;
      if (minimatch(relPath, rule.normalized, { dot: true })) {
        ignored = !rule.negate;
      }
    }
  }
  return ignored;
}
