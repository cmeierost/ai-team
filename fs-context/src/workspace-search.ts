/**
 * WorkspaceSearch — permission-aware search facade.
 *
 * Bundles grep (in-process) and ripgrep (binary) search behind the same
 * ContextRuntime permission model as WorkspaceFs.
 * Every operation filters results through the agent's read permissions.
 *
 * Usage:
 *   const search = new WorkspaceSearch(workspaceRoot, agentId, runtime);
 *   const matches = await search.grep('TODO', { extensions: ['ts'] });
 */
import path from 'node:path';
import type { PermissionChecker } from './permission/types.js';
import { PermissionError } from './permission/context-runtime.js';
import { normalizePath, isInsideWorkspaceRoot } from './paths.js';
import { listCachedWorkspaceFiles } from './tree/file-tree-cache.js';
import { GrepSearch, type GrepMatch, type GrepOptions } from './search/grep-search.js';
import { Ripgrep, type RgMatch } from './search/ripgrep.js';

const grepEngine = new GrepSearch();

export class WorkspaceSearch {
  readonly workspaceRoot: string;
  readonly agentId: string;
  private readonly runtime: PermissionChecker;

  constructor(workspaceRoot: string, agentId: string, runtime: PermissionChecker) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.agentId = agentId;
    this.runtime = runtime;
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private toRelativePath(absPath: string): string {
    return normalizePath(absPath, this.workspaceRoot);
  }

  private canRead(relPath: string): boolean {
    return this.runtime.canRead(this.agentId, relPath);
  }

  // ─── In-process grep ────────────────────────────────────────────────────────

  /**
   * Search workspace files for a regex/string pattern. Filtered by read access.
   * Uses the in-process GrepSearch engine (no external binary needed).
   */
  async grep(
    query: string,
    opts: GrepOptions & { extensions?: string[] } = {}
  ): Promise<GrepMatch[]> {
    const files = await listCachedWorkspaceFiles(this.workspaceRoot, {
      filesOnly: true,
      extensions: opts.extensions,
    });

    const readable = files.filter((f) => this.canRead(f.relativePath));

    const results = await Promise.all(
      readable.map((f) => grepEngine.searchFile(f.path, query, opts).catch(() => [] as GrepMatch[]))
    );

    return results.flat();
  }

  /**
   * Search a single file. Requires read access.
   */
  async grepFile(relPath: string, query: string, opts?: GrepOptions): Promise<GrepMatch[]> {
    const norm = this.toRelativePath(relPath);
    if (!this.canRead(norm)) {
      throw new PermissionError(this.agentId, norm, 'read');
    }
    const absPath = path.resolve(this.workspaceRoot, relPath.replaceAll('\\', '/'));
    if (!isInsideWorkspaceRoot(this.workspaceRoot, absPath)) {
      throw new Error(`Path traversal blocked: '${relPath}' resolves outside workspace root.`);
    }
    return grepEngine.searchFile(absPath, query, opts);
  }

  /**
   * Search multiple patterns across readable files. Returns a map keyed by pattern.
   */
  async grepMultiplePatterns(
    patterns: (string | RegExp)[],
    opts: GrepOptions & { extensions?: string[] } = {}
  ): Promise<Map<string | RegExp, GrepMatch[]>> {
    const files = await listCachedWorkspaceFiles(this.workspaceRoot, {
      filesOnly: true,
      extensions: opts.extensions,
    });

    const readable = files.filter((f) => this.canRead(f.relativePath));
    return grepEngine.searchMultiplePatterns(
      readable.map((f) => f.path),
      patterns,
      opts
    );
  }

  /**
   * Count total occurrences of a pattern across readable files.
   */
  async countOccurrences(
    pattern: string | RegExp,
    opts: GrepOptions & { extensions?: string[] } = {}
  ): Promise<number> {
    const files = await listCachedWorkspaceFiles(this.workspaceRoot, {
      filesOnly: true,
      extensions: opts.extensions,
    });

    const readable = files.filter((f) => this.canRead(f.relativePath));
    return grepEngine.countOccurrences(
      readable.map((f) => f.path),
      pattern,
      opts
    );
  }

  /**
   * Get a list of files containing a pattern. Filtered by read access.
   */
  async filesWithPattern(
    pattern: string | RegExp,
    opts: GrepOptions & { extensions?: string[] } = {}
  ): Promise<string[]> {
    const files = await listCachedWorkspaceFiles(this.workspaceRoot, {
      filesOnly: true,
      extensions: opts.extensions,
    });

    const readable = files.filter((f) => this.canRead(f.relativePath));
    const matches = await grepEngine.getFilesWithPattern(
      readable.map((f) => f.path),
      pattern,
      opts
    );
    // Convert absolute paths back to workspace-relative
    return matches.map((p) => this.toRelativePath(p));
  }

  // ─── Ripgrep (binary search) ───────────────────────────────────────────────

  /**
   * Search for a pattern using ripgrep. Results are filtered by read access.
   * Ripgrep uses a real binary for high performance on large codebases.
   */
  async ripgrepSearch(
    pattern: string,
    opts?: { glob?: string[]; limit?: number; follow?: boolean }
  ): Promise<RgMatch['data'][]> {
    const raw = await Ripgrep.search({
      cwd: this.workspaceRoot,
      pattern,
      ...opts,
    });

    // Filter results to only include files the agent can read
    return raw.filter((match) => {
      const rel = this.toRelativePath(match.path.text);
      return this.canRead(rel);
    });
  }

  /**
   * List files in workspace using ripgrep. Filtered by read access.
   */
  async ripgrepFiles(opts?: {
    glob?: string[];
    hidden?: boolean;
    follow?: boolean;
    maxDepth?: number;
  }): Promise<string[]> {
    const results: string[] = [];
    for await (const file of Ripgrep.files({
      cwd: this.workspaceRoot,
      ...opts,
    })) {
      const rel = this.toRelativePath(path.resolve(this.workspaceRoot, file));
      if (this.canRead(rel)) {
        results.push(rel);
      }
    }
    return results;
  }
}

// Re-export types consumers need without accessing internals directly
export type { GrepMatch, GrepOptions, RgMatch };
