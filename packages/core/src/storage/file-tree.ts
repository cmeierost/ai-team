/**
 * Workspace file system tree utilities
 * Provides hierarchical and flat listings of workspace files for agent permission management.
 *
 * Behaviour:
 *  - Respects every .gitignore file found from workspace root down to the current directory.
 *  - Paths listed in .ai-team/config.json -> fileTree.allowPaths are shown even when gitignored.
 *  - Hidden entries (dot-prefixed) are excluded by default; .ai-team is always included.
 *  - .git is always excluded.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';

// ============================================================================
// Types
// ============================================================================

export interface FileTreeNode {
  /** File or directory name (basename only) */
  name: string;
  /** Absolute path */
  path: string;
  /** Workspace-relative path, forward-slash separated */
  relativePath: string;
  isDirectory: boolean;
  /** Present for directories that were expanded */
  children?: FileTreeNode[];
  /** File size in bytes (files only) */
  size?: number;
  /** ISO last-modified timestamp */
  modified?: string;
  /** e.g. ".ts" (files only) */
  extension?: string;
  /** True when this entry is gitignored but allowed via allowPaths config */
  gitignored?: boolean;
}

export interface GetFileTreeOptions {
  /** Maximum recursion depth. Default: 6 */
  maxDepth?: number;
  /** Include hidden files/dirs (dot-prefixed). Default: false */
  includeHidden?: boolean;
  /** Completely bypass gitignore processing. Default: false */
  ignoreGitignore?: boolean;
  /** Additional exact directory names to always exclude */
  excludeDirs?: string[];
  /** Descend only into this workspace-relative sub-path */
  rootSubPath?: string;
  /**
   * Workspace-relative paths (exact or glob) that override gitignore exclusions.
   * Sourced from .ai-team/config.json -> fileTree.allowPaths.
   */
  allowPaths?: string[];
}

export interface ListWorkspaceFilesOptions extends GetFileTreeOptions {
  /** Return only files, not directories */
  filesOnly?: boolean;
  /** Return only files with these extensions, e.g. ['.ts', '.md'] */
  extensions?: string[];
}

export interface FlatFileEntry {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
  extension?: string;
  /** True when gitignored but allowed via allowPaths config */
  gitignored?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const ALWAYS_EXCLUDED = new Set(['.git']);
const DEFAULT_MAX_DEPTH = 6;

// ============================================================================
// Gitignore parsing
// ============================================================================

interface IgnoreRule {
  negate: boolean;
  dirOnly: boolean;
  /** Normalised minimatch pattern */
  normalized: string;
}

function parseGitignoreContent(content: string): IgnoreRule[] {
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

/** Per-run cache so we don't re-read the same .gitignore for every child entry */
const gitignoreCache = new Map<string, IgnoreRule[]>();

async function readDirGitignore(dir: string): Promise<IgnoreRule[]> {
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
async function collectRules(workspaceRoot: string, dirPath: string): Promise<IgnoreRule[][]> {
  const rel = path.relative(workspaceRoot, dirPath);
  const parts = rel ? rel.split(path.sep) : [];
  const dirs = [workspaceRoot];
  for (const p of parts) dirs.push(path.join(dirs.at(-1)!, p));
  return Promise.all(dirs.map(readDirGitignore));
}

function isIgnoredByRules(relPath: string, isDirectory: boolean, ruleSets: IgnoreRule[][]): boolean {
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

/**
 * Returns true if relPath matches any pattern from the user's allowPaths config.
 * Supports exact paths, glob patterns, and directory prefixes.
 */
function isAllowed(relPath: string, allowPaths: string[]): boolean {
  if (allowPaths.length === 0) return false;
  return allowPaths.some((pattern) => {
    if (minimatch(relPath, pattern, { dot: true })) return true;
    // Also allow entire subtree when pattern matches an ancestor directory
    const prefix = pattern.endsWith('/') ? pattern : `${pattern}/`;
    return relPath.startsWith(prefix) || relPath === pattern;
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns a hierarchical file tree rooted at workspaceRoot (or a sub-path).
 * Respects .gitignore files; entries in allowPaths are shown even when gitignored.
 * The gitignore cache is cleared on each top-level call.
 */
export async function getFileTree(
  workspaceRoot: string,
  options: GetFileTreeOptions = {}
): Promise<FileTreeNode> {
  gitignoreCache.clear();

  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    includeHidden = false,
    ignoreGitignore = false,
    excludeDirs = [],
    rootSubPath,
    allowPaths = [],
  } = options;

  const excluded = new Set([...ALWAYS_EXCLUDED, ...excludeDirs]);
  const startPath = rootSubPath ? path.resolve(workspaceRoot, rootSubPath) : workspaceRoot;

  return buildNode(startPath, workspaceRoot, 0, maxDepth, {
    includeHidden,
    ignoreGitignore,
    excluded,
    allowPaths,
  });
}

/**
 * Returns a flat list of all matching workspace entries.
 */
export async function listWorkspaceFiles(
  workspaceRoot: string,
  options: ListWorkspaceFilesOptions = {}
): Promise<FlatFileEntry[]> {
  gitignoreCache.clear();

  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    includeHidden = false,
    ignoreGitignore = false,
    excludeDirs = [],
    filesOnly = false,
    extensions,
    rootSubPath,
    allowPaths = [],
  } = options;

  const excluded = new Set([...ALWAYS_EXCLUDED, ...excludeDirs]);
  const startPath = rootSubPath ? path.resolve(workspaceRoot, rootSubPath) : workspaceRoot;

  const results: FlatFileEntry[] = [];
  await collectFlat(startPath, workspaceRoot, 0, maxDepth, { includeHidden, ignoreGitignore, excluded, allowPaths }, results);

  return results.filter((e) => {
    if (filesOnly && e.isDirectory) return false;
    if (extensions && !e.isDirectory && !extensions.includes(e.extension ?? '')) return false;
    return true;
  });
}

/**
 * Resolves a workspace-relative path to an absolute path with path-traversal protection.
 * Returns null if the resolved path escapes the workspace root.
 */
export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string | null {
  if (path.isAbsolute(relativePath)) return null;
  const absolute = path.resolve(workspaceRoot, relativePath);
  const root = path.resolve(workspaceRoot);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

/** Converts an absolute path to a forward-slash workspace-relative path. */
export function toRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replaceAll('\\', '/');
}

// ============================================================================
// Internal helpers
// ============================================================================

interface TraversalContext {
  includeHidden: boolean;
  ignoreGitignore: boolean;
  excluded: Set<string>;
  allowPaths: string[];
}

async function resolveGitignored(
  childAbs: string,
  childRel: string,
  parentRuleSets: IgnoreRule[][],
  ctx: TraversalContext
): Promise<{ include: boolean; gitignored: boolean }> {
  if (ctx.ignoreGitignore) return { include: true, gitignored: false };

  let childIsDir = false;
  try { childIsDir = (await fs.stat(childAbs)).isDirectory(); } catch { return { include: false, gitignored: false }; }

  const gitignored = isIgnoredByRules(childRel, childIsDir, parentRuleSets);
  if (!gitignored) return { include: true, gitignored: false };
  return { include: isAllowed(childRel, ctx.allowPaths), gitignored: true };
}

async function buildNode(
  absolutePath: string,
  workspaceRoot: string,
  depth: number,
  maxDepth: number,
  ctx: TraversalContext
): Promise<FileTreeNode> {
  const name = path.basename(absolutePath);
  const relativePath = toRelativePath(workspaceRoot, absolutePath);

  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch {
    return { name, path: absolutePath, relativePath, isDirectory: false };
  }

  const isDirectory = stats.isDirectory();
  const node: FileTreeNode = {
    name,
    path: absolutePath,
    relativePath,
    isDirectory,
    modified: stats.mtime.toISOString(),
    ...(!isDirectory && { size: stats.size, extension: path.extname(name) }),
  };

  if (!isDirectory || depth >= maxDepth) return node;

  let entries: string[];
  try {
    entries = await fs.readdir(absolutePath);
  } catch {
    return { ...node, children: [] };
  }

  const ruleSets = ctx.ignoreGitignore ? [] : await collectRules(workspaceRoot, absolutePath);

  const childNodes = await Promise.all(
    entries
      .filter((entry) => {
        if (ctx.excluded.has(entry)) return false;
        // Always show .ai-team; hide other dot-entries unless includeHidden
        if (entry.startsWith('.') && entry !== '.ai-team' && !ctx.includeHidden) return false;
        return true;
      })
      .map(async (entry) => {
        const childAbs = path.join(absolutePath, entry);
        const childRel = toRelativePath(workspaceRoot, childAbs);
        const { include, gitignored } = await resolveGitignored(childAbs, childRel, ruleSets, ctx);
        if (!include) return null;
        const child = await buildNode(childAbs, workspaceRoot, depth + 1, maxDepth, ctx);
        if (gitignored) child.gitignored = true;
        return child;
      })
  );

  node.children = (childNodes.filter(Boolean) as FileTreeNode[]).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return node;
}

async function collectFlat(
  absolutePath: string,
  workspaceRoot: string,
  depth: number,
  maxDepth: number,
  ctx: TraversalContext,
  results: FlatFileEntry[]
): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch {
    return;
  }

  const name = path.basename(absolutePath);
  const relativePath = toRelativePath(workspaceRoot, absolutePath);
  const isDirectory = stats.isDirectory();

  if (absolutePath !== path.resolve(workspaceRoot)) {
    results.push({
      name,
      path: absolutePath,
      relativePath,
      isDirectory,
      modified: stats.mtime.toISOString(),
      ...(!isDirectory && { size: stats.size, extension: path.extname(name) }),
    });
  }

  if (!isDirectory || depth >= maxDepth) return;

  let entries: string[];
  try {
    entries = await fs.readdir(absolutePath);
  } catch {
    return;
  }

  const ruleSets = ctx.ignoreGitignore ? [] : await collectRules(workspaceRoot, absolutePath);

  await Promise.all(
    entries
      .filter((entry) => {
        if (ctx.excluded.has(entry)) return false;
        if (entry.startsWith('.') && entry !== '.ai-team' && !ctx.includeHidden) return false;
        return true;
      })
      .map(async (entry) => {
        const childAbs = path.join(absolutePath, entry);
        const childRel = toRelativePath(workspaceRoot, childAbs);
        const { include, gitignored } = await resolveGitignored(childAbs, childRel, ruleSets, ctx);
        if (!include) return;
        const beforeLen = results.length;
        await collectFlat(childAbs, workspaceRoot, depth + 1, maxDepth, ctx, results);
        // Mark the direct child entry as gitignored if applicable
        if (gitignored && results.length > beforeLen && results[beforeLen].relativePath === childRel) {
          results[beforeLen].gitignored = true;
        }
      })
  );
}
