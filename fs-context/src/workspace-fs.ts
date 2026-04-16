/**
 * WorkspaceFs — permission-aware, workspace-scoped file system accessor.
 *
 * All methods take and return workspace-relative POSIX paths.
 * Every mutating or reading operation is checked against the injected
 * ContextRuntime before the underlying FS primitive is called.
 *
 * Usage:
 *   const wfs = new WorkspaceFs(workspaceRoot, agentId, runtime);
 *   const content = await wfs.readFile('src/index.ts');   // throws PermissionError if denied
 */
import path from 'node:path';
import type { PermissionChecker } from './permission/types.js';
import { PermissionError } from './permission/context-runtime.js';
import {
  readFile,
  batchReadFiles as rawBatchReadFiles,
  type ReadFileOptions,
  type ReadFileResult,
  type BatchReadEntry,
} from './fs/file-read.js';
import {
  existsPath as rawExistsPath,
  getPathInfo,
  createFile as rawCreateFile,
  writeFile as rawWriteFile,
  deletePath as rawDeletePath,
  createDirectory as rawCreateDirectory,
  moveFile as rawMoveFile,
  copyFile as rawCopyFile,
  renameFile as rawRenameFile,
  hashFile as rawHashFile,
  createSymlink as rawCreateSymlink,
  readSymlinkTarget as rawReadSymlinkTarget,
  type PathInfo,
  type CreateFileResult,
  type WriteFileResult,
  type MoveResult,
  type CopyResult,
  type RenameResult,
  type HashAlgorithm,
  type HashResult,
} from './fs/file-ops.js';
import { generateUnifiedDiff, type UnifiedDiffOptions } from './edit/diff-gen.js';
import { listCachedWorkspaceFiles, getCachedFileTree } from './tree/file-tree-cache.js';
import type {
  FileTreeNode,
  FlatFileEntry,
  GetFileTreeOptions,
  ListWorkspaceFilesOptions,
} from './tree/file-tree.js';
import { GrepSearch, type GrepOptions, type GrepMatch } from './search/grep-search.js';
import { normalizePath, isInsideWorkspaceRoot } from './paths.js';

const grep = new GrepSearch();

export class WorkspaceFs {
  readonly workspaceRoot: string;
  readonly agentId: string;
  private readonly runtime: PermissionChecker;

  constructor(workspaceRoot: string, agentId: string, runtime: PermissionChecker) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.agentId = agentId;
    this.runtime = runtime;
  }

  // ─── Path helpers ───────────────────────────────────────────────────────────

  /**
   * Convert a workspace-relative path to an absolute path.
   * Throws if the resolved path escapes the workspace root (path traversal guard).
   */
  toAbsolutePath(relPath: string): string {
    const abs = path.resolve(this.workspaceRoot, relPath.replaceAll('\\', '/'));
    if (!isInsideWorkspaceRoot(this.workspaceRoot, abs)) {
      throw new Error(`Path traversal blocked: '${relPath}' resolves outside workspace root.`);
    }
    return abs;
  }

  /** Convert an absolute path to a workspace-relative POSIX path. */
  toRelativePath(absPath: string): string {
    return normalizePath(absPath, this.workspaceRoot);
  }

  // ─── Access checks ──────────────────────────────────────────────────────────

  canRead(relPath: string): boolean {
    return this.runtime.canRead(this.agentId, this.toRelativePath(relPath));
  }

  canWrite(relPath: string): boolean {
    return this.runtime.canWrite(this.agentId, this.toRelativePath(relPath));
  }

  canList(relPath: string): boolean {
    return this.runtime.canList(this.agentId, this.toRelativePath(relPath));
  }

  assertCanRead(relPath: string): void {
    const norm = this.toRelativePath(relPath);
    if (!this.runtime.canRead(this.agentId, norm)) {
      throw new PermissionError(this.agentId, norm, 'read');
    }
  }

  assertCanWrite(relPath: string): void {
    const norm = this.toRelativePath(relPath);
    if (!this.runtime.canWrite(this.agentId, norm)) {
      throw new PermissionError(this.agentId, norm, 'write');
    }
  }

  assertCanList(relPath: string): void {
    const norm = this.toRelativePath(relPath);
    if (!this.runtime.canList(this.agentId, norm)) {
      throw new PermissionError(this.agentId, norm, 'list');
    }
  }

  // ─── Read operations ────────────────────────────────────────────────────────

  async existsPath(relPath: string): Promise<boolean> {
    this.assertCanRead(relPath);
    return rawExistsPath(this.toAbsolutePath(relPath));
  }

  async getPathInfo(relPath: string): Promise<PathInfo | null> {
    this.assertCanRead(relPath);
    return getPathInfo(this.toAbsolutePath(relPath));
  }

  async readFile(relPath: string, opts: ReadFileOptions): Promise<ReadFileResult> {
    this.assertCanRead(relPath);
    return readFile(this.toAbsolutePath(relPath), opts);
  }

  // ─── Write operations ───────────────────────────────────────────────────────

  async writeFile(relPath: string, content: string): Promise<WriteFileResult> {
    this.assertCanWrite(relPath);
    return rawWriteFile(this.toAbsolutePath(relPath), content);
  }

  async createFile(
    relPath: string,
    content: string,
    opts?: { createDirectories?: boolean }
  ): Promise<CreateFileResult> {
    this.assertCanWrite(relPath);
    return rawCreateFile(this.toAbsolutePath(relPath), content, opts);
  }

  async deletePath(relPath: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertCanWrite(relPath);
    return rawDeletePath(this.toAbsolutePath(relPath), opts);
  }

  async createDirectory(relPath: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertCanWrite(relPath);
    return rawCreateDirectory(this.toAbsolutePath(relPath), opts);
  }

  /** Move a file/directory. Requires write on both source and destination. Uses git mv when available. */
  async moveFile(
    relSrc: string,
    relDest: string,
    opts?: { createDirectories?: boolean }
  ): Promise<MoveResult> {
    this.assertCanWrite(relSrc);
    this.assertCanWrite(relDest);
    return rawMoveFile(this.toAbsolutePath(relSrc), this.toAbsolutePath(relDest), opts);
  }

  /** Copy a file/directory. Requires read on source, write on destination. */
  async copyFile(
    relSrc: string,
    relDest: string,
    opts?: { createDirectories?: boolean; overwrite?: boolean }
  ): Promise<CopyResult> {
    this.assertCanRead(relSrc);
    this.assertCanWrite(relDest);
    return rawCopyFile(this.toAbsolutePath(relSrc), this.toAbsolutePath(relDest), opts);
  }

  /** Rename a file/directory in place. Requires write on the source path. Uses git mv when available. */
  async renameFile(relPath: string, newName: string): Promise<RenameResult> {
    this.assertCanWrite(relPath);
    // The destination is in the same directory — check write there too
    const destRel = this.toRelativePath(
      path.join(path.dirname(this.toAbsolutePath(relPath)), newName)
    );
    this.assertCanWrite(destRel);
    return rawRenameFile(this.toAbsolutePath(relPath), newName);
  }

  // ─── Tree / list operations (filtered by list access) ──────────────────────

  async listFiles(opts: ListWorkspaceFilesOptions = {}): Promise<FlatFileEntry[]> {
    const all = await listCachedWorkspaceFiles(this.workspaceRoot, opts);
    return all.filter((entry) => this.runtime.canList(this.agentId, entry.relativePath));
  }

  async getFileTree(opts: GetFileTreeOptions = {}): Promise<FileTreeNode | null> {
    const tree = await getCachedFileTree(this.workspaceRoot, opts);
    return this.filterTree(tree);
  }

  async getFileTreeWithStats(
    opts: GetFileTreeOptions = {}
  ): Promise<{ tree: FileTreeNode | null; denied: number }> {
    const raw = await getCachedFileTree(this.workspaceRoot, opts);
    return this.filterTreeWithStats(raw);
  }

  private filterTree(node: FileTreeNode): FileTreeNode | null {
    const relPath = node.relativePath || '.';
    const allowed = this.runtime.canList(this.agentId, relPath === '.' ? '' : relPath);

    if (!node.children || node.children.length === 0) {
      return allowed ? node : null;
    }

    const filteredChildren = node.children
      .map((c) => this.filterTree(c))
      .filter((c): c is FileTreeNode => c !== null);

    if (!allowed && filteredChildren.length === 0) return null;
    return { ...node, children: filteredChildren };
  }

  private filterTreeWithStats(node: FileTreeNode | null): {
    tree: FileTreeNode | null;
    denied: number;
  } {
    if (!node) return { tree: null, denied: 0 };
    const relPath = node.relativePath || '.';
    const allowed = this.runtime.canList(this.agentId, relPath === '.' ? '' : relPath);

    if (!node.children || node.children.length === 0) {
      if (!allowed) return { tree: null, denied: 1 };
      return { tree: node, denied: 0 };
    }

    let denied = 0;
    const filteredChildren: FileTreeNode[] = [];
    for (const child of node.children) {
      const { tree: filteredChild, denied: childDenied } = this.filterTreeWithStats(child);
      denied += childDenied;
      if (filteredChild) filteredChildren.push(filteredChild);
    }

    if (!allowed && filteredChildren.length === 0) {
      return { tree: null, denied: denied + 1 };
    }
    return { tree: { ...node, children: filteredChildren }, denied };
  }

  // ─── Search (filtered by read access) ──────────────────────────────────────

  async grep(
    query: string,
    opts: GrepOptions & { extensions?: string[] } = {}
  ): Promise<GrepMatch[]> {
    const files = await listCachedWorkspaceFiles(this.workspaceRoot, {
      filesOnly: true,
      extensions: opts.extensions,
    });

    const readable = files.filter((f) => this.runtime.canRead(this.agentId, f.relativePath));

    const results = await Promise.all(
      readable.map((f) => grep.searchFile(f.path, query, opts).catch(() => [] as GrepMatch[]))
    );

    return results.flat();
  }

  async grepWithStats(
    query: string,
    opts: GrepOptions & { extensions?: string[] } = {}
  ): Promise<{ matches: GrepMatch[]; denied: number }> {
    const files = await listCachedWorkspaceFiles(this.workspaceRoot, {
      filesOnly: true,
      extensions: opts.extensions,
    });

    let denied = 0;
    const readable = files.filter((f) => {
      if (this.runtime.canRead(this.agentId, f.relativePath)) return true;
      denied++;
      return false;
    });

    const results = await Promise.all(
      readable.map((f) => grep.searchFile(f.path, query, opts).catch(() => [] as GrepMatch[]))
    );

    // Only count files that actually had matches as denied
    const deniedWithMatches = denied > 0 ? denied : 0;
    return { matches: results.flat(), denied: deniedWithMatches };
  }

  // ─── Hashing ───────────────────────────────────────────────────────────────

  /** Compute a hex hash of a file. Requires read access. */
  async hashFile(relPath: string, algorithm?: HashAlgorithm): Promise<HashResult> {
    this.assertCanRead(relPath);
    return rawHashFile(this.toAbsolutePath(relPath), algorithm);
  }

  // ─── Diff ──────────────────────────────────────────────────────────────────

  /** Generate a unified diff between two files. Requires read access on both. */
  async diffFiles(relPathA: string, relPathB: string, opts?: UnifiedDiffOptions): Promise<string> {
    this.assertCanRead(relPathA);
    this.assertCanRead(relPathB);
    const [a, b] = await Promise.all([
      readFile(this.toAbsolutePath(relPathA), { workspaceRoot: this.workspaceRoot }),
      readFile(this.toAbsolutePath(relPathB), { workspaceRoot: this.workspaceRoot }),
    ]);
    const textA = a.kind === 'text' ? a.content : '';
    const textB = b.kind === 'text' ? b.content : '';
    return generateUnifiedDiff(textA, textB, {
      oldPath: relPathA,
      newPath: relPathB,
      ...opts,
    });
  }

  // ─── Batch read ────────────────────────────────────────────────────────────

  /**
   * Read multiple files in parallel. Denied paths are returned with
   * `denied: true` and a reason rather than silently dropped.
   */
  async batchReadFiles(
    relPaths: string[],
    opts?: Omit<ReadFileOptions, 'workspaceRoot'>
  ): Promise<(BatchReadEntry & { denied?: boolean; denialReason?: string })[]> {
    const readablePaths: string[] = [];
    const readableIndices: number[] = [];
    const results: (BatchReadEntry & { denied?: boolean; denialReason?: string })[] = new Array(
      relPaths.length
    );

    for (let i = 0; i < relPaths.length; i++) {
      const rel = relPaths[i]!;
      if (this.canRead(rel)) {
        readablePaths.push(this.toAbsolutePath(rel));
        readableIndices.push(i);
      } else {
        results[i] = {
          path: this.toAbsolutePath(rel),
          result: { kind: 'not-found', suggestions: [] },
          denied: true,
          denialReason: `Context '${this.agentId}' does not have read access to '${rel}'.`,
        };
      }
    }

    const batchResults = await rawBatchReadFiles(readablePaths, {
      workspaceRoot: this.workspaceRoot,
      ...opts,
    });

    for (let j = 0; j < readableIndices.length; j++) {
      results[readableIndices[j]!] = batchResults[j]!;
    }

    return results;
  }

  // ─── Symlinks ──────────────────────────────────────────────────────────────

  /**
   * Create a symbolic link. Requires write access on the link path
   * AND read access on the target. Both must be inside the workspace.
   */
  async createSymlink(targetRel: string, linkRel: string): Promise<void> {
    this.assertCanWrite(linkRel);
    this.assertCanRead(targetRel);
    // toAbsolutePath already validates both paths are inside workspace root
    return rawCreateSymlink(this.toAbsolutePath(targetRel), this.toAbsolutePath(linkRel));
  }

  /**
   * Read the target of a symbolic link. Requires read access on the link.
   * Validates the resolved target is inside the workspace root.
   */
  async readSymlinkTarget(relPath: string): Promise<string> {
    this.assertCanRead(relPath);
    const target = await rawReadSymlinkTarget(this.toAbsolutePath(relPath));
    const resolvedTarget = path.resolve(path.dirname(this.toAbsolutePath(relPath)), target);
    if (!isInsideWorkspaceRoot(this.workspaceRoot, resolvedTarget)) {
      throw new Error(`Symlink target for '${relPath}' resolves outside workspace root.`);
    }
    return this.toRelativePath(resolvedTarget);
  }
}
