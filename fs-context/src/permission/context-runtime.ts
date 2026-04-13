import { matchesPattern } from './glob-engine.js';
import type {
  ContextMatchRanking,
  FileContextMembership,
  FileIndex,
  FileListContextComparison,
  FileRightsByContext,
  FileRightsMatrixRow,
  ContextFileTreeNode,
  PathToContextsIndex,
  ResolvedContext,
  Right,
} from './types.js';
import type { AccessPatternSet } from './access-file.js';
import { normalizeRelativePosixPath as normalizeRuntimePath } from '../paths.js';
import path from 'node:path';

// ─── PermissionError ──────────────────────────────────────────────────────────

export interface PermissionDenialInfo {
  /** The right that was denied. */
  right: Right;
  /** Other context IDs that DO have the required right for this path. */
  alternativeContexts: string[];
  /** The most specific context to grant access through, or null. */
  bestContext: string | null;
}

export class PermissionError extends Error {
  /** The right that was denied (read/write/list). */
  public readonly right: Right;
  /** Context IDs that DO have the required right for this path. */
  public readonly alternativeContexts: string[];
  /** Most specific context to suggest granting access through. */
  public readonly bestContext: string | null;

  constructor(
    public readonly contextId: string,
    public readonly path: string,
    right?: Right,
    runtime?: Pick<ContextRuntime, 'suggestBestContextForPath'>
  ) {
    const r = right ?? 'read';
    let alternatives: string[] = [];
    let best: string | null = null;

    if (runtime) {
      const info = runtime.suggestBestContextForPath(path, r);
      alternatives = info.alternatives.filter((id) => id !== contextId);
      best = info.best;
    }

    const altMsg =
      alternatives.length > 0
        ? ` Contexts with access: [${alternatives.map((c) => `'${c}'`).join(', ')}]. Suggest granting access via '${best}'.`
        : ' No context currently has access — add a permission rule to a .perm file.';

    super(`Context '${contextId}' does not have ${r} access to '${path}'.${altMsg}`);
    this.name = 'PermissionError';
    this.right = r;
    this.alternativeContexts = alternatives;
    this.bestContext = best;
  }
}

function normalizeResolvedInPlace(resolved: ResolvedContext): void {
  const list = new Set<string>();
  const read = new Set<string>();
  const write = new Set<string>();

  for (const f of resolved.list) list.add(normalizeRuntimePath(f));
  for (const f of resolved.read) read.add(normalizeRuntimePath(f));
  for (const f of resolved.write) write.add(normalizeRuntimePath(f));

  resolved.list = list;
  resolved.read = read;
  resolved.write = write;
}

export class ContextRuntime {
  private contexts = new Map<string, ResolvedContext>();
  private reverseIndex: PathToContextsIndex = {
    list: new Map(),
    read: new Map(),
    write: new Map(),
  };
  private fileIndex: FileIndex | null = null;

  setFileIndex(index: FileIndex): void {
    this.fileIndex = index;
  }

  register(contextId: string, resolved: ResolvedContext): void {
    normalizeResolvedInPlace(resolved);
    this.unregister(contextId);
    this.contexts.set(contextId, resolved);
    this.addToReverseIndex(contextId, resolved);
  }

  /**
   * Register an agent context from an `AccessPatternSet` and the full workspace file list.
   * Patterns are resolved to concrete file sets once so all subsequent `can*` checks are O(1).
   *
   * List defaults to all files when no list patterns are defined (default-open).
   * Write access implies read access.
   */
  registerFromPatterns(
    contextId: string,
    patterns: AccessPatternSet,
    allFiles: readonly string[]
  ): void {
    const fileSet = new Set(allFiles.map(normalizeRuntimePath));

    const list =
      patterns.list.length === 0
        ? new Set(fileSet)
        : new Set([...fileSet].filter((f) => patterns.list.some((p) => matchesPattern(f, p))));

    const write = new Set(
      [...fileSet].filter((f) => patterns.write.some((p) => matchesPattern(f, p)))
    );

    const read = new Set(
      [...fileSet].filter((f) => patterns.read.some((p) => matchesPattern(f, p)))
    );
    for (const f of write) read.add(f); // write implies read

    this.unregister(contextId);
    const resolved: ResolvedContext = { list, read, write };
    this.contexts.set(contextId, resolved);
    this.addToReverseIndex(contextId, resolved);
  }

  unregister(contextId: string): void {
    const existing = this.contexts.get(contextId);
    if (!existing) return;
    this.removeFromReverseIndex(contextId, existing);
    this.contexts.delete(contextId);
  }

  private addToReverseIndex(contextId: string, resolved: ResolvedContext): void {
    const rights: Right[] = ['list', 'read', 'write'];
    for (const right of rights) {
      const filesSet = resolved[right];
      const reverseMap = this.reverseIndex[right];
      for (const file of filesSet) {
        let ctxSet = reverseMap.get(file);
        if (!ctxSet) {
          ctxSet = new Set();
          reverseMap.set(file, ctxSet);
        }
        ctxSet.add(contextId);
      }
    }
  }

  private removeFromReverseIndex(contextId: string, resolved: ResolvedContext): void {
    const rights: Right[] = ['list', 'read', 'write'];
    for (const right of rights) {
      const filesSet = resolved[right];
      const reverseMap = this.reverseIndex[right];
      for (const file of filesSet) {
        const ctxSet = reverseMap.get(file);
        if (ctxSet) {
          ctxSet.delete(contextId);
          if (ctxSet.size === 0) reverseMap.delete(file);
        }
      }
    }
  }

  canWrite(contextId: string, filePath: string): boolean {
    const ctx = this.contexts.get(contextId);
    const normalizedPath = normalizeRuntimePath(filePath);
    return ctx ? ctx.write.has(normalizedPath) : false;
  }

  canRead(contextId: string, filePath: string): boolean {
    const ctx = this.contexts.get(contextId);
    const normalizedPath = normalizeRuntimePath(filePath);
    if (!ctx) return false;
    return ctx.read.has(normalizedPath);
  }

  canList(contextId: string, filePath: string): boolean {
    const ctx = this.contexts.get(contextId);
    const normalizedPath = normalizeRuntimePath(filePath);
    if (!ctx) return false;
    return ctx.list.has(normalizedPath);
  }

  assertCanRead(contextId: string, filePath: string): void {
    if (!this.canRead(contextId, filePath)) {
      throw new PermissionError(contextId, normalizeRuntimePath(filePath), 'read', this);
    }
  }

  assertCanWrite(contextId: string, filePath: string): void {
    if (!this.canWrite(contextId, filePath)) {
      throw new PermissionError(contextId, normalizeRuntimePath(filePath), 'write', this);
    }
  }

  assertCanList(contextId: string, filePath: string): void {
    if (!this.canList(contextId, filePath)) {
      throw new PermissionError(contextId, normalizeRuntimePath(filePath), 'list', this);
    }
  }

  listReadable(contextId: string): string[] {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return [];
    return [...ctx.read];
  }

  listListable(contextId: string): string[] {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return [];
    return [...ctx.list];
  }

  listWritable(contextId: string): string[] {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return [];
    return [...ctx.write];
  }

  searchByFilenameGlob(
    contextId: string,
    glob: string,
    scope: 'list' | 'read' | 'write' = 'read'
  ): string[] {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return [];

    const fileSet = ctx[scope === 'read' ? 'read' : scope];
    const idx = this.fileIndex;

    // Fast path: extension-only glob like *.ts
    if (idx && /^\*\.\w+$/.test(glob)) {
      const ext = glob.slice(1); // .ts
      const candidates = idx.byExt.get(ext) ?? [];
      return candidates.filter((f) => fileSet.has(f));
    }

    // Fast path: exact basename
    if (idx && !glob.includes('*') && !glob.includes('?') && !glob.includes('{')) {
      const candidates = idx.byBaseName.get(glob) ?? [];
      return candidates.filter((f) => fileSet.has(f));
    }

    // General case: match against all files in scope
    const results: string[] = [];
    for (const f of fileSet) {
      const baseName = path.posix.basename(f);
      if (matchesPattern(baseName, glob)) results.push(f);
    }
    return results;
  }

  /**
   * Search files by matching the full workspace-relative path against a glob.
   *
   * Supports patterns like `src/**\/*.test.ts` or `packages/core/**`.
   * Falls back to `searchByFilenameGlob` when the pattern has no path separators.
   */
  searchByPathGlob(
    contextId: string,
    glob: string,
    scope: 'list' | 'read' | 'write' = 'read'
  ): string[] {
    // Delegate to basename search when there's no path separator
    if (!glob.includes('/')) {
      return this.searchByFilenameGlob(contextId, glob, scope);
    }

    const ctx = this.contexts.get(contextId);
    if (!ctx) return [];

    const fileSet = ctx[scope === 'read' ? 'read' : scope];
    const results: string[] = [];
    for (const f of fileSet) {
      if (matchesPattern(f, glob)) results.push(f);
    }
    return results;
  }

  contextsThatCanWrite(filePath: string): string[] {
    const normalizedPath = normalizeRuntimePath(filePath);
    return [...(this.reverseIndex.write.get(normalizedPath) ?? [])];
  }

  contextsThatCanRead(filePath: string): string[] {
    const normalizedPath = normalizeRuntimePath(filePath);
    return [...(this.reverseIndex.read.get(normalizedPath) ?? [])];
  }

  contextsThatCanList(filePath: string): string[] {
    const normalizedPath = normalizeRuntimePath(filePath);
    return [...(this.reverseIndex.list.get(normalizedPath) ?? [])];
  }

  listFilesWithRightsByContext(scope: 'list' | 'read' | 'write' = 'list'): FileRightsMatrixRow[] {
    const allFiles = new Set<string>();
    for (const [, ctx] of this.contexts) {
      for (const f of ctx[scope]) allFiles.add(f);
    }

    const rows: FileRightsMatrixRow[] = [];
    for (const filePath of allFiles) {
      const rights: FileRightsByContext[] = [];
      for (const [contextId, ctx] of this.contexts) {
        rights.push({
          contextId,
          canList: ctx.list.has(filePath),
          canRead: ctx.read.has(filePath),
          canWrite: ctx.write.has(filePath),
        });
      }
      rows.push({ path: filePath, rights });
    }
    return rows;
  }

  getContextRightsFileTree(options?: {
    root?: string;
    includeRights?: boolean;
  }): ContextFileTreeNode[] {
    const allFiles = new Set<string>();
    for (const [, ctx] of this.contexts) {
      for (const f of ctx.list) allFiles.add(f);
    }

    const root = options?.root ?? '';
    const includeRights = options?.includeRights ?? true;

    const nodeMap = new Map<string, ContextFileTreeNode>();
    const rootChildren: ContextFileTreeNode[] = [];

    const sorted = [...allFiles].filter((f) => !root || f.startsWith(root)).sort();
    for (const filePath of sorted) {
      const parts = filePath.split('/');
      let parent: ContextFileTreeNode[] = rootChildren;

      for (let i = 0; i < parts.length; i++) {
        const partPath = parts.slice(0, i + 1).join('/');
        const isFile = i === parts.length - 1;

        let node = nodeMap.get(partPath);
        if (!node) {
          node = {
            path: partPath,
            name: parts[i],
            type: isFile ? 'file' : 'dir',
            children: isFile ? undefined : [],
          };

          if (isFile && includeRights) {
            node.rightsByContext = [];
            for (const [contextId, ctx] of this.contexts) {
              node.rightsByContext.push({
                contextId,
                canList: ctx.list.has(filePath),
                canRead: ctx.read.has(filePath),
                canWrite: ctx.write.has(filePath),
              });
            }
          }

          nodeMap.set(partPath, node);
          parent.push(node);
        }
        if (!isFile) {
          parent = node.children!;
        }
      }
    }

    return rootChildren;
  }

  getResolved(contextId: string): ResolvedContext | undefined {
    return this.contexts.get(contextId);
  }

  allContexts(): Map<string, ResolvedContext> {
    return new Map(this.contexts);
  }

  /**
   * For each file in the input list, return which contexts contain it
   * at the given right level. Files not in any context get an empty array.
   */
  resolveFilesToContexts(files: string[], right: Right = 'read'): FileContextMembership[] {
    const reverseMap = this.reverseIndex[right];
    return files.map((filePath) => {
      const normalizedPath = normalizeRuntimePath(filePath);
      return {
        path: normalizedPath,
        contexts: [...(reverseMap.get(normalizedPath) ?? [])],
      };
    });
  }

  /**
   * Compare a file list against a specific context at a given right.
   * Returns covered/uncovered/extra sets and a coverage ratio.
   */
  compareFilesToContext(
    files: string[],
    contextId: string,
    right: Right = 'read'
  ): FileListContextComparison | undefined {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return undefined;

    const contextFiles = ctx[right];
    const normalizedFiles = files.map((f) => normalizeRuntimePath(f));
    const inputSet = new Set(normalizedFiles);
    const covered = new Set<string>();
    const uncovered = new Set<string>();

    for (const f of normalizedFiles) {
      if (contextFiles.has(f)) covered.add(f);
      else uncovered.add(f);
    }

    const extra = new Set<string>();
    for (const f of contextFiles) {
      if (!inputSet.has(f)) extra.add(f);
    }

    return {
      contextId,
      covered,
      uncovered,
      extra,
      coverage: normalizedFiles.length > 0 ? covered.size / normalizedFiles.length : 0,
    };
  }

  /**
   * Rank all registered contexts by how well they cover the input file list
   * at the given right. Returns contexts sorted by coverage descending.
   * Contexts with zero coverage are included (useful for gap analysis).
   */
  matchBestContexts(files: string[], right: Right = 'read'): ContextMatchRanking[] {
    const normalizedFiles = files.map((f) => normalizeRuntimePath(f));
    const inputSet = new Set(normalizedFiles);
    const rankings: ContextMatchRanking[] = [];

    for (const [contextId, ctx] of this.contexts) {
      const contextFiles = ctx[right];
      let coveredCount = 0;
      const uncovered = new Set<string>();

      for (const f of normalizedFiles) {
        if (contextFiles.has(f)) coveredCount++;
        else uncovered.add(f);
      }

      const extra = new Set<string>();
      for (const f of contextFiles) {
        if (!inputSet.has(f)) extra.add(f);
      }

      rankings.push({
        contextId,
        coveredCount,
        uncoveredCount: uncovered.size,
        coverage: normalizedFiles.length > 0 ? coveredCount / normalizedFiles.length : 0,
        uncovered,
        extra,
      });
    }

    rankings.sort((a, b) => b.coverage - a.coverage || a.extra.size - b.extra.size);
    return rankings;
  }

  /**
   * Return context IDs that cover ALL input files at the given right.
   * Uses reverse-index intersection — O(files × avg contexts per file), no scanning.
   * Returns empty array if any file is uncovered.
   */
  contextsCoveringAll(files: string[], right: Right = 'read'): string[] {
    const normalizedFiles = files.map((f) => normalizeRuntimePath(f));
    if (normalizedFiles.length === 0) return [...this.contexts.keys()];

    const reverseMap = this.reverseIndex[right];
    let result: Set<string> | null = null;

    for (const filePath of normalizedFiles) {
      const ctxSet = reverseMap.get(filePath);
      if (!ctxSet || ctxSet.size === 0) return []; // file uncovered → no context covers all
      if (result === null) {
        result = new Set(ctxSet);
      } else {
        for (const id of result) {
          if (!ctxSet.has(id)) result.delete(id);
        }
        if (result.size === 0) return [];
      }
    }

    return result ? [...result] : [];
  }

  /**
   * Return contexts that cover at least one input file, with per-context hit counts.
   * Sorted by hit count descending. O(files × avg contexts per file), no scanning.
   */
  contextsCoveringAny(
    files: string[],
    right: Right = 'read'
  ): Array<{ contextId: string; hitCount: number; hitFiles: string[] }> {
    const normalizedFiles = files.map((f) => normalizeRuntimePath(f));
    const reverseMap = this.reverseIndex[right];
    const hits = new Map<string, string[]>();

    for (const filePath of normalizedFiles) {
      const ctxSet = reverseMap.get(filePath);
      if (!ctxSet) continue;
      for (const contextId of ctxSet) {
        let list = hits.get(contextId);
        if (!list) {
          list = [];
          hits.set(contextId, list);
        }
        list.push(filePath);
      }
    }

    const result = [...hits.entries()].map(([contextId, hitFiles]) => ({
      contextId,
      hitCount: hitFiles.length,
      hitFiles,
    }));
    result.sort((a, b) => b.hitCount - a.hitCount);
    return result;
  }

  /**
   * For a given path and right, return the alternative contexts that have access
   * and suggest the single best (most focused) context to grant access through.
   *
   * "Best" = the context with the smallest total file set at the given right,
   * i.e. the most specific/focused permissions. O(1) reverse-index lookup,
   * then O(alternatives) size comparison.
   */
  suggestBestContextForPath(
    filePath: string,
    right: Right
  ): { alternatives: string[]; best: string | null } {
    const normalizedPath = normalizeRuntimePath(filePath);
    const reverseMap = this.reverseIndex[right];
    const ctxSet = reverseMap.get(normalizedPath);
    if (!ctxSet || ctxSet.size === 0) {
      return { alternatives: [], best: null };
    }

    const alternatives = [...ctxSet];

    // Pick the context with the smallest file set (most focused permissions)
    let best: string | null = null;
    let bestSize = Infinity;
    for (const ctxId of alternatives) {
      const ctx = this.contexts.get(ctxId);
      if (!ctx) continue;
      const size = ctx[right].size;
      if (size < bestSize) {
        bestSize = size;
        best = ctxId;
      }
    }

    return { alternatives, best };
  }
}
