/**
 * WorkspaceCodeEdit — permission-aware code editing facade.
 *
 * Bundles patch application, fuzzy replacement, and diff generation
 * behind the same ContextRuntime permission model as WorkspaceFs.
 * Every operation checks read/write access before touching content.
 *
 * Usage:
 *   const editor = new WorkspaceCodeEdit(workspaceRoot, agentId, runtime);
 *   const result = await editor.applyPatch('src/index.ts', patchText);
 */
import path from 'node:path';
import type { PermissionChecker } from './permission/types.js';
import { PermissionError } from './permission/context-runtime.js';
import { readFile } from './fs/file-read.js';
import { writeFile as rawWriteFile } from './fs/file-ops.js';
import { Patch, type FileDiff, type ParsedHunk, type PatchType } from './edit/patch.js';
import {
  fuzzyReplace as rawFuzzyReplace,
  fuzzyFind as rawFuzzyFind,
  type FuzzyMatch,
  type FuzzyReplaceResult,
  type FuzzyStage,
} from './edit/fuzzy-replace.js';
import {
  generateUnifiedDiff,
  generateStructuredDiff,
  type UnifiedDiffOptions,
  type StructuredDiff,
  type DiffHunk,
} from './edit/diff-gen.js';
import { normalizePath, isInsideWorkspaceRoot } from './paths.js';
import { emitFileEdited } from './fs/file-events.js';

export class WorkspaceCodeEdit {
  readonly workspaceRoot: string;
  readonly agentId: string;
  private readonly runtime: PermissionChecker;

  constructor(workspaceRoot: string, agentId: string, runtime: PermissionChecker) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.agentId = agentId;
    this.runtime = runtime;
  }

  // ─── Path helpers (shared pattern with WorkspaceFs) ─────────────────────────

  private toAbsolutePath(relPath: string): string {
    const abs = path.resolve(this.workspaceRoot, relPath.replaceAll('\\', '/'));
    if (!isInsideWorkspaceRoot(this.workspaceRoot, abs)) {
      throw new Error(`Path traversal blocked: '${relPath}' resolves outside workspace root.`);
    }
    return abs;
  }

  private toRelativePath(absPath: string): string {
    return normalizePath(absPath, this.workspaceRoot);
  }

  private assertCanRead(relPath: string): void {
    const norm = this.toRelativePath(relPath);
    if (!this.runtime.canRead(this.agentId, norm)) {
      throw new PermissionError(this.agentId, norm, 'read');
    }
  }

  private assertCanWrite(relPath: string): void {
    const norm = this.toRelativePath(relPath);
    if (!this.runtime.canWrite(this.agentId, norm)) {
      throw new PermissionError(this.agentId, norm, 'write');
    }
  }

  // ─── Patch operations ──────────────────────────────────────────────────────

  /** Parse a unified diff string into per-file patch descriptors. Pure — no FS access. */
  parsePatch(patchText: string): FileDiff[] {
    return Patch.parse(patchText);
  }

  /**
   * Apply a parsed FileDiff to a file. Requires read+write access.
   * Reads the current content, applies hunks, writes back, emits edit event.
   */
  async applyFileDiff(
    relPath: string,
    hunks: ParsedHunk[]
  ): Promise<{ before: string; after: string }> {
    this.assertCanRead(relPath);
    this.assertCanWrite(relPath);
    const absPath = this.toAbsolutePath(relPath);
    const result = await readFile(absPath, { workspaceRoot: this.workspaceRoot });
    const content = result.kind === 'text' ? result.content : '';
    const patched = Patch.applyFileDiff(content, hunks);
    await rawWriteFile(absPath, patched);
    emitFileEdited(absPath);
    return { before: content, after: patched };
  }

  /**
   * Parse a patch string and apply all file diffs. Returns per-file results.
   * Each target file must be readable and writable.
   */
  async applyPatch(
    patchText: string
  ): Promise<Array<{ path: string; before: string; after: string }>> {
    const diffs = Patch.parse(patchText);
    const results: Array<{ path: string; before: string; after: string }> = [];
    for (const diff of diffs) {
      if (diff.type === 'delete') continue;
      const target = diff.newPath;
      const r = await this.applyFileDiff(target, diff.hunks);
      results.push({ path: target, ...r });
    }
    return results;
  }

  // ─── Fuzzy replace ─────────────────────────────────────────────────────────

  /**
   * Fuzzy-find a string in a file. Requires read access.
   * Returns the match location or null if not found.
   */
  async fuzzyFind(
    relPath: string,
    oldString: string,
    replaceAll = false
  ): Promise<FuzzyMatch | null> {
    this.assertCanRead(relPath);
    const result = await readFile(this.toAbsolutePath(relPath), {
      workspaceRoot: this.workspaceRoot,
    });
    if (result.kind !== 'text') return null;
    return rawFuzzyFind(result.content, oldString, replaceAll);
  }

  /**
   * Fuzzy-replace a string in a file. Requires read+write access.
   * Uses a 9-stage progressive matching pipeline to handle whitespace,
   * indentation, and encoding differences.
   */
  async fuzzyReplace(
    relPath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<FuzzyReplaceResult | null> {
    this.assertCanRead(relPath);
    this.assertCanWrite(relPath);
    const absPath = this.toAbsolutePath(relPath);
    const result = await readFile(absPath, { workspaceRoot: this.workspaceRoot });
    if (result.kind !== 'text') return null;
    const replaced = rawFuzzyReplace(result.content, oldString, newString, replaceAll);
    if (!replaced) return null;
    await rawWriteFile(absPath, replaced.content);
    emitFileEdited(absPath);
    return replaced;
  }

  // ─── Diff generation ───────────────────────────────────────────────────────

  /**
   * Generate a unified diff between two files. Requires read access on both.
   */
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

  /**
   * Generate a structured diff between two files. Requires read access on both.
   */
  async structuredDiffFiles(
    relPathA: string,
    relPathB: string,
    opts?: UnifiedDiffOptions
  ): Promise<StructuredDiff | null> {
    this.assertCanRead(relPathA);
    this.assertCanRead(relPathB);
    const [a, b] = await Promise.all([
      readFile(this.toAbsolutePath(relPathA), { workspaceRoot: this.workspaceRoot }),
      readFile(this.toAbsolutePath(relPathB), { workspaceRoot: this.workspaceRoot }),
    ]);
    const textA = a.kind === 'text' ? a.content : '';
    const textB = b.kind === 'text' ? b.content : '';
    return generateStructuredDiff(textA, textB, {
      oldPath: relPathA,
      newPath: relPathB,
      ...opts,
    });
  }

  /**
   * Generate a unified diff from two in-memory strings. No FS access needed — pure function.
   */
  diffStrings(oldContent: string, newContent: string, opts?: UnifiedDiffOptions): string {
    return generateUnifiedDiff(oldContent, newContent, opts);
  }

  /**
   * Generate a structured diff from two in-memory strings. No FS access needed — pure function.
   */
  structuredDiffStrings(
    oldContent: string,
    newContent: string,
    opts?: UnifiedDiffOptions
  ): StructuredDiff | null {
    return generateStructuredDiff(oldContent, newContent, opts);
  }
}

// Re-export types consumers need without accessing internals directly
export type {
  FileDiff,
  ParsedHunk,
  PatchType,
  FuzzyMatch,
  FuzzyStage,
  FuzzyReplaceResult,
  UnifiedDiffOptions,
  StructuredDiff,
  DiffHunk,
};
