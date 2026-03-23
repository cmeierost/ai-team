import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { FileTime, Patch, fuzzyReplace } from '@ai-team/fs';
import type { AgentTool, ToolContext } from '../types/index.js';
import {
  getAccessEngineOrDeny,
  resolveFsAbsolutePath,
  toFsPathAccessEnvelope,
  toFsPathMeta,
} from './fs-access.js';
import { collectPostWriteDiagnostics } from './diagnostics-helper.js';

// ============================================================================
// Shared helper — detect + strip fs_read line-number prefixes
// ============================================================================

const LINE_NUM_RE = /^(\d+): /;

/**
 * Detect and strip `fs_read`-style line-number prefixes (`N: `) from text.
 *
 * Only strips when the pattern is unambiguous: ≥ 80 % of lines match and
 * the detected numbers are strictly sequential — matching `fs_read` output.
 */
export function stripLineNumberPrefixes(text: string): { text: string; stripped: boolean } {
  const lines = text.split('\n');
  if (lines.length < 2) return { text, stripped: false };

  const matches: Array<{ index: number; num: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_NUM_RE);
    if (m) matches.push({ index: i, num: parseInt(m[1], 10) });
  }

  if (matches.length / lines.length < 0.8) return { text, stripped: false };

  for (let i = 1; i < matches.length; i++) {
    if (matches[i].num !== matches[i - 1].num + 1) return { text, stripped: false };
  }

  const cleaned = lines
    .map((line) => {
      const m = line.match(LINE_NUM_RE);
      return m ? line.slice(m[0].length) : line;
    })
    .join('\n');
  return { text: cleaned, stripped: true };
}

// ============================================================================
// apply_patch — apply a standard unified diff to one or more files
// ============================================================================

export const applyPatchTool: AgentTool = {
  name: 'apply_patch',
  description: [
    'Apply a standard unified diff (--- / +++ / @@ format) to one or more files.',
    'Each changed file is access-checked individually.',
    'Existing files MUST have been read with fs_read in the current session.',
    'New files (add hunks) do not require a prior read.',
  ].join(' '),
  parameters: z.object({
    patchText: z.string().min(1).describe(
      'Standard unified diff string. Must start with --- / +++ file headers and @@ hunk markers.',
    ),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    if (!engineCheck.ok) {
      return { applied: [], denied: [], error: engineCheck.reason };
    }

    let fileDiffs: ReturnType<typeof Patch.parse>;
    try {
      fileDiffs = Patch.parse((params as { patchText: string }).patchText);
    } catch (parseErr) {
      return {
        applied: [],
        denied: [],
        error: `Failed to parse unified diff: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      };
    }

    if (fileDiffs.length === 0) {
      return { applied: [], denied: [], error: 'No file changes found in the provided patch.' };
    }

    // -------------------------------------------------------------------------
    // Pass 1: resolve paths + access checks for every file
    // -------------------------------------------------------------------------
    const denied: Array<{ path: string; reason: string }> = [];
    const approved: Array<{
      diff: (typeof fileDiffs)[number];
      absolutePath: string;
      newAbsolutePath?: string;
    }> = [];

    for (const diff of fileDiffs) {
      const targetRelative = diff.type === 'add' ? diff.newPath : diff.oldPath;
      const absolutePath = resolveFsAbsolutePath(context, targetRelative);
      if (!absolutePath) {
        denied.push({ path: targetRelative, reason: 'Path is outside workspace root.' });
        continue;
      }

      const toolName = diff.type === 'delete' ? 'fs_delete_path' : 'fs_write_file';
      const access = toFsPathAccessEnvelope(context, toolName, targetRelative);
      if (!access.allowed) {
        denied.push({ path: targetRelative, reason: access.explanation });
        continue;
      }

      let newAbsolutePath: string | undefined;
      if (diff.type === 'move') {
        newAbsolutePath = resolveFsAbsolutePath(context, diff.newPath) ?? undefined;
        if (!newAbsolutePath) {
          denied.push({ path: diff.newPath, reason: 'Move destination is outside workspace root.' });
          continue;
        }
      }

      approved.push({ diff, absolutePath, newAbsolutePath });
    }

    if (denied.length > 0) {
      return {
        applied: [],
        denied,
        error: `Access denied for ${denied.length} file(s). No changes were written.`,
      };
    }

    // -------------------------------------------------------------------------
    // Pass 2: apply changes
    // -------------------------------------------------------------------------
    const applied: Array<{
      type: string;
      path: string;
      additions: number;
      deletions: number;
    }> = [];
    const fileChanges: Array<{ filePath: string; oldContent: string; newContent: string }> = [];

    for (const { diff, absolutePath, newAbsolutePath } of approved) {
      try {
        if (diff.type === 'delete') {
          await fs.unlink(absolutePath);
          applied.push({ type: 'delete', path: diff.oldPath, additions: 0, deletions: diff.deletions });

        } else if (diff.type === 'add') {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          const content = Patch.applyFileDiff('', diff.hunks);
          await fs.writeFile(absolutePath, content, 'utf8');
          FileTime.record(context.agent.id, absolutePath);
          applied.push({ type: 'add', path: diff.newPath, additions: diff.additions, deletions: 0 });
          fileChanges.push({ filePath: absolutePath, oldContent: '', newContent: content });

        } else if (diff.type === 'update') {
          // Assert file was read first (same guard as fs_edit)
          try {
            FileTime.assert(context.agent.id, absolutePath);
          } catch (assertErr) {
            return {
              applied,
              denied,
              error: `${assertErr instanceof Error ? assertErr.message : String(assertErr)} — call fs_read on '${diff.oldPath}' before apply_patch.`,
            };
          }
          const original = await fs.readFile(absolutePath, 'utf8');
          const updated = Patch.applyFileDiff(original, diff.hunks);
          await fs.writeFile(absolutePath, updated, 'utf8');
          FileTime.record(context.agent.id, absolutePath);
          applied.push({ type: 'update', path: diff.oldPath, additions: diff.additions, deletions: diff.deletions });
          fileChanges.push({ filePath: absolutePath, oldContent: original, newContent: updated });

        } else if (diff.type === 'move') {
          // Assert old file was read first
          try {
            FileTime.assert(context.agent.id, absolutePath);
          } catch (assertErr) {
            return {
              applied,
              denied,
              error: `${assertErr instanceof Error ? assertErr.message : String(assertErr)} — call fs_read on '${diff.oldPath}' before apply_patch.`,
            };
          }
          const original = await fs.readFile(absolutePath, 'utf8');
          const updated = diff.hunks.length > 0
            ? Patch.applyFileDiff(original, diff.hunks)
            : original;
          await fs.mkdir(path.dirname(newAbsolutePath!), { recursive: true });
          await fs.writeFile(newAbsolutePath!, updated, 'utf8');
          await fs.unlink(absolutePath);
          FileTime.record(context.agent.id, newAbsolutePath!);
          applied.push({
            type: 'move',
            path: `${diff.oldPath} → ${diff.newPath}`,
            additions: diff.additions,
            deletions: diff.deletions,
          });
          fileChanges.push({ filePath: newAbsolutePath!, oldContent: original, newContent: updated });
        }
      } catch (applyErr) {
        return {
          applied,
          denied,
          error: `Failed to apply patch to '${diff.oldPath}': ${applyErr instanceof Error ? applyErr.message : String(applyErr)}`,
        };
      }
    }

    const totalAdditions = applied.reduce((s, f) => s + f.additions, 0);
    const totalDeletions = applied.reduce((s, f) => s + f.deletions, 0);
    const appliedPaths = applied
      .filter(f => f.type !== 'delete')
      .map(f => {
        const rel = f.path.includes(' → ') ? f.path.split(' → ')[1]! : f.path;
        return path.isAbsolute(rel) ? rel : path.join(context.workspaceRoot, rel);
      });
    const diagnostics = appliedPaths.length > 0
      ? await collectPostWriteDiagnostics(context, appliedPaths)
      : undefined;
    return {
      applied, denied, totalFiles: applied.length, totalAdditions, totalDeletions,
      ...(diagnostics ? { diagnostics } : {}),
      _fileChanges: fileChanges,
    };
  },
};

// ============================================================================
// multiedit — batch sequential string replacements on a single file
// ============================================================================

export const multiEditTool: AgentTool = {
  name: 'multiedit',
  description: [
    'Apply multiple oldString→newString replacements to a single file in one call.',
    'Edits are applied sequentially; the file MUST have been read with fs_read first.',
    'Stops on the first failed edit and returns partial results with the error index.',
  ].join(' '),
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute path to the file to edit'),
    edits: z.array(
      z.object({
        oldString:  z.string().min(1).describe('Exact string to replace'),
        newString:  z.string().describe('Replacement string'),
        replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false)'),
      }),
    ).min(1).describe('Ordered list of edits to apply sequentially'),
  }),
  async execute(params, context: ToolContext) {
    const { filePath, edits } = params as {
      filePath: string;
      edits: Array<{ oldString: string; newString: string; replaceAll?: boolean }>;
    };

    const engineCheck = getAccessEngineOrDeny(context);
    if (!engineCheck.ok) {
      return { path: filePath, succeeded: 0, totalEdits: edits.length, results: [], error: engineCheck.reason };
    }

    // Single upfront access check.
    const access = toFsPathAccessEnvelope(context, 'fs_edit', filePath);
    if (!access.allowed) {
      return {
        path: filePath,
        succeeded: 0,
        totalEdits: edits.length,
        results: [],
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
        },
      };
    }

    // Delegate each edit sequentially to fsEditTool.
    // fsEditTool.execute() handles its own FileTime.assert + withLock
    // and refreshes FileTime.record after each write, so the next
    // assert in the loop will pass on the just-written file.
    const results: Array<{ index: number; result: unknown }> = [];
    let succeeded = 0;
    let firstOldContent: string | undefined;
    let lastNewContent: string | undefined;

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]!;
      const rawResult = await fsEditTool.execute(
        { filePath, oldString: edit.oldString, newString: edit.newString, replaceAll: edit.replaceAll },
        context,
      );

      const r = rawResult as { edited?: boolean; error?: string; _fileChanges?: Array<{ oldContent: string; newContent: string }> };
      // Track first old / last new for aggregated _fileChanges
      if (r._fileChanges?.[0]) {
        if (firstOldContent === undefined) firstOldContent = r._fileChanges[0].oldContent;
        lastNewContent = r._fileChanges[0].newContent;
      }
      // Strip _fileChanges from sub-result — only the aggregated top-level one is kept
      const { _fileChanges: _fc, ...cleanResult } = rawResult as Record<string, unknown>;
      results.push({ index: i, result: cleanResult });

      if (!r.edited) {
        return {
          path: filePath,
          succeeded,
          totalEdits: edits.length,
          failedAtIndex: i,
          error: r.error ?? 'Edit failed',
          results,
        };
      }
      succeeded++;
    }

    const absolutePath = resolveFsAbsolutePath(context, filePath);
    const diagnostics = absolutePath
      ? await collectPostWriteDiagnostics(context, [absolutePath])
      : undefined;
    const _fileChanges = absolutePath && firstOldContent !== undefined && lastNewContent !== undefined
      ? [{ filePath: absolutePath, oldContent: firstOldContent, newContent: lastNewContent }]
      : undefined;
    return { path: filePath, succeeded, totalEdits: edits.length, results, ...(diagnostics ? { diagnostics } : {}), ...(_fileChanges ? { _fileChanges } : {}) };
  },
};

// ============================================================================
// Surgical file edit tool (requires prior fs_read in the same session)
// ============================================================================

/**
 * Surgical string-replacement edit that guards against stale edits.
 *
 * Before calling this tool the agent MUST have read the file with `fs_read`
 * in the current session. FileTime.assert() will reject the edit if the file
 * has been modified on disk since it was read.
 */
export const fsEditTool: AgentTool = {
  name: 'fs_edit',
  description: [
    'Perform a surgical in-place edit of a file by replacing an exact string.',
    'REQUIRES the file to have been read first with fs_read in the same session.',
    'The edit will fail if the file has been modified on disk since the last read.',
    'Use `replaceAll: true` to replace every occurrence; default replaces only the first.',
    'Always read the file with `fs_read` immediately before calling this tool.',
  ].join(' '),
  parameters: z.object({
    filePath:   z.string().describe('Relative or absolute path to the file to edit'),
    oldString:  z.string().min(1).describe('Exact string to find and replace (must be unique unless replaceAll is true)'),
    newString:  z.string().describe('Replacement string'),
    replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false — first only)'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { filePath, replaceAll = false } = params as {
      filePath:   string;
      oldString:  string;
      newString:  string;
      replaceAll?: boolean;
    };

    // Strip accidental fs_read line-number prefixes ("42: ...") from both
    // strings so the LLM doesn't write numbered content into the file.
    const cleanOld = stripLineNumberPrefixes((params as { oldString: string }).oldString);
    const cleanNew = stripLineNumberPrefixes((params as { newString: string }).newString);
    const oldString = cleanOld.text;
    const newString = cleanNew.text;

    const absolutePath = resolveFsAbsolutePath(context, filePath);
    if (!absolutePath) {
      return {
        path: { input: filePath, absolute: '', relative: '' },
        edited: false,
        access: { allowed: false, explanation: 'Path is outside workspace root.', alternativeContexts: [] },
      };
    }

    const pathMeta = toFsPathMeta(context, filePath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        edited: false,
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_edit', filePath);
    if (!access.allowed) {
      return {
        path: pathMeta,
        edited: false,
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    return FileTime.withLock(absolutePath, async () => {
      // Assert the file was read and hasn't changed since then
      try {
        FileTime.assert(context.agent.id, absolutePath);
      } catch (assertErr) {
        return {
          path: pathMeta,
          edited: false,
          error: assertErr instanceof Error ? assertErr.message : String(assertErr),
          hint: 'Call fs_read on this file before calling fs_edit.',
          access,
        };
      }

      let content: string;
      try {
        content = await fs.readFile(absolutePath, 'utf8');
      } catch (readErr) {
        return {
          path: pathMeta,
          edited: false,
          error: readErr instanceof Error ? readErr.message : String(readErr),
          access,
        };
      }

      // --- Fuzzy-aware replace pipeline ---
      // Pre-check: exact ambiguity should give specific error
      const exactCount = content.split(oldString).length - 1;
      if (!replaceAll && exactCount > 1) {
        return {
          path: pathMeta,
          edited: false,
          error: `oldString appears ${exactCount} times in ${pathMeta.relative}. Provide a more unique string or set replaceAll: true.`,
          access,
        };
      }

      const fuzzyResult = fuzzyReplace(content, oldString, newString, replaceAll);

      if (!fuzzyResult) {
        return {
          path: pathMeta,
          edited: false,
          error: `oldString not found in ${pathMeta.relative}`,
          hint:  'Use fs_read to verify the current content of the file before calling fs_edit.',
          access,
        };
      }

      const updated = fuzzyResult.content;

      try {
        await fs.writeFile(absolutePath, updated, 'utf8');
      } catch (writeErr) {
        return {
          path: pathMeta,
          edited: false,
          error: writeErr instanceof Error ? writeErr.message : String(writeErr),
          access,
        };
      }

      // Refresh read time so subsequent edits in same session don't fail
      FileTime.record(context.agent.id, absolutePath);

      const addedLines   = (newString.split('\n').length - oldString.split('\n').length);
      const totalBefore  = content.split('\n').length;

      const diagnostics = await collectPostWriteDiagnostics(context, [absolutePath]);
      return {
        path: pathMeta,
        edited: true,
        replacements: fuzzyResult.replacements,
        ...(fuzzyResult.stage !== 'exact' ? { matchStage: fuzzyResult.stage } : {}),
        linesChanged: addedLines,
        totalLines:   totalBefore + addedLines,
        access,
        ...(diagnostics ? { diagnostics } : {}),
        _fileChanges: [{ filePath: absolutePath, oldContent: content, newContent: updated }],
      };
    });
  },
};
