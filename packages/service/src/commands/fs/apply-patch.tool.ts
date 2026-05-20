import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { FileTime, Patch, emitFileEdited, emitFileCreated } from 'fs-context';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IPathPermissionChecker,
  IIdeAdapterFactory,
  LspProvider,
} from '@ai-team/core';
import { resolveFsAbsolutePath, toFsPathAccessEnvelope } from './fs-access.js';
import { collectPostWriteDiagnostics } from '../../tools/catalog/diagnostics-helper.js';

export interface ApplyPatchParams {
  patchText: string;
}

type PatchDiff = ReturnType<typeof Patch.parse>[number];

type ApplyPatchResult = CommandResponse<unknown> & {
  _fileChanges?: Array<{ filePath: string; oldContent: string; newContent: string }>;
};

class ApplyPatchService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {}

  private async resolveLsp(context: ExecutionContext): Promise<LspProvider> {
    const channel = context.invocationSurface === 'cli' ? 'cli' : 'web';
    const adapter = await this.ideAdapterFactory.createAsync(this.workspaceRoot, channel);
    return adapter.lsp;
  }

  async apply(patchText: string, context: ExecutionContext): Promise<ApplyPatchResult> {
    const parsed = this.parsePatchText(patchText);
    if ('error' in parsed) return parsed.error;

    const validated = this.validatePatchDiffs(parsed.diffs, context.agent);
    if ('error' in validated) return validated.error;

    const appliedResult = await this.applyApprovedDiffs(
      validated.approved,
      context.agent?.id ?? 'unknown'
    );
    if ('error' in appliedResult) return appliedResult.error;

    const diagnostics = await this.collectDiagnostics(context, appliedResult.applied);

    return {
      status: 'ok',
      data: {
        applied: appliedResult.applied,
        denied: validated.denied,
        totalFiles: appliedResult.applied.length,
        totalAdditions: appliedResult.totalAdditions,
        totalDeletions: appliedResult.totalDeletions,
        ...(diagnostics ? { diagnostics } : {}),
      },
      _fileChanges: appliedResult.fileChanges,
    };
  }

  private parsePatchText(
    patchText: string
  ): { diffs: PatchDiff[] } | { error: ApplyPatchResult } {
    let diffs: PatchDiff[];
    try {
      diffs = Patch.parse(patchText);
    } catch (parseErr) {
      const msg = `Failed to parse unified diff: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
      return {
        error: {
          status: 'error',
          error: { message: msg },
          data: { applied: [], denied: [], error: msg },
        },
      };
    }

    if (diffs.length === 0) {
      const msg = 'No file changes found in the provided patch.';
      return {
        error: {
          status: 'error',
          error: { message: msg },
          data: { applied: [], denied: [], error: msg },
        },
      };
    }

    return { diffs };
  }

  private validatePatchDiffs(
    diffs: PatchDiff[],
    agent: ExecutionContext['agent']
  ):
    | {
        approved: Array<{
          diff: PatchDiff;
          absolutePath: string;
          newAbsolutePath?: string;
        }>;
        denied: Array<{ path: string; reason: string }>;
      }
    | { error: ApplyPatchResult } {
    const denied: Array<{ path: string; reason: string }> = [];
    const approved: Array<{
      diff: PatchDiff;
      absolutePath: string;
      newAbsolutePath?: string;
    }> = [];

    for (const diff of diffs) {
      const targetRelative = diff.type === 'add' ? diff.newPath : diff.oldPath;
      const absolutePath = resolveFsAbsolutePath(this.workspaceRoot, targetRelative);
      if (!absolutePath) {
        denied.push({ path: targetRelative, reason: 'Path is outside workspace root.' });
        continue;
      }

      const toolName = diff.type === 'delete' ? 'delete_path' : 'write_file';
      const access = toFsPathAccessEnvelope(
        this.pathPermissionChecker,
        agent,
        toolName,
        targetRelative
      );
      if (!access.allowed) {
        denied.push({ path: targetRelative, reason: access.explanation });
        continue;
      }

      let newAbsolutePath: string | undefined;
      if (diff.type === 'move') {
        newAbsolutePath = resolveFsAbsolutePath(this.workspaceRoot, diff.newPath) ?? undefined;
        if (!newAbsolutePath) {
          denied.push({
            path: diff.newPath,
            reason: 'Move destination is outside workspace root.',
          });
          continue;
        }
      }

      approved.push({ diff, absolutePath, newAbsolutePath });
    }

    if (denied.length > 0) {
      const msg = `Access denied for ${denied.length} file(s). No changes were written.`;
      return {
        error: {
          status: 'error',
          error: { message: msg },
          data: { applied: [], denied, error: msg },
        },
      };
    }

    return { approved, denied };
  }

  private async applyApprovedDiffs(
    approved: Array<{
      diff: PatchDiff;
      absolutePath: string;
      newAbsolutePath?: string;
    }>,
    agentId: string
  ): Promise<
    | {
        applied: Array<{ type: string; path: string; additions: number; deletions: number }>;
        fileChanges: Array<{ filePath: string; oldContent: string; newContent: string }>;
        totalAdditions: number;
        totalDeletions: number;
      }
    | { error: ApplyPatchResult }
  > {
    const applied: Array<{ type: string; path: string; additions: number; deletions: number }> = [];
    const fileChanges: Array<{ filePath: string; oldContent: string; newContent: string }> = [];

    for (const { diff, absolutePath, newAbsolutePath } of approved) {
      try {
        const result = await this.applyPatchDiff({
          diff,
          absolutePath,
          newAbsolutePath,
          agentId,
        });
        applied.push(result.applied);
        if (result.fileChange) fileChanges.push(result.fileChange);
      } catch (applyErr) {
        const msg = `Failed to apply patch to '${diff.oldPath}': ${applyErr instanceof Error ? applyErr.message : String(applyErr)}`;
        return {
          error: {
            status: 'error',
            error: { message: msg },
            data: { applied, denied: [], error: msg },
          },
        };
      }
    }

    const totalAdditions = applied.reduce((s, f) => s + f.additions, 0);
    const totalDeletions = applied.reduce((s, f) => s + f.deletions, 0);

    return { applied, fileChanges, totalAdditions, totalDeletions };
  }

  private async collectDiagnostics(
    context: ExecutionContext,
    applied: Array<{ type: string; path: string }>
  ): Promise<ReturnType<typeof collectPostWriteDiagnostics> | undefined> {
    const appliedPaths = applied
      .filter((f) => f.type !== 'delete')
      .map((f) => {
        const rel = f.path.includes(' → ') ? (f.path.split(' → ')[1] ?? f.path) : f.path;
        return path.isAbsolute(rel) ? rel : path.join(this.workspaceRoot, rel);
      });
    if (appliedPaths.length === 0) return undefined;
    const lsp = await this.resolveLsp(context);
    return collectPostWriteDiagnostics(lsp, appliedPaths);
  }

  private async applyPatchDiff(args: {
    diff: PatchDiff;
    absolutePath: string;
    newAbsolutePath?: string;
    agentId: string;
  }): Promise<{
    applied: { type: string; path: string; additions: number; deletions: number };
    fileChange?: { filePath: string; oldContent: string; newContent: string };
  }> {
    const { diff, absolutePath, newAbsolutePath, agentId } = args;

    switch (diff.type) {
      case 'delete':
        await fs.unlink(absolutePath);
        return {
          applied: {
            type: 'delete',
            path: diff.oldPath,
            additions: 0,
            deletions: diff.deletions,
          },
        };
      case 'add': {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        const content = Patch.applyFileDiff('', diff.hunks);
        await fs.writeFile(absolutePath, content, 'utf8');
        FileTime.record(agentId, absolutePath);
        emitFileCreated(absolutePath);
        return {
          applied: {
            type: 'add',
            path: diff.newPath,
            additions: diff.additions,
            deletions: 0,
          },
          fileChange: { filePath: absolutePath, oldContent: '', newContent: content },
        };
      }
      case 'update': {
        await this.assertReadableForPatch(agentId, absolutePath, diff.oldPath);
        const original = await fs.readFile(absolutePath, 'utf8');
        const updated = Patch.applyFileDiff(original, diff.hunks);
        await fs.writeFile(absolutePath, updated, 'utf8');
        FileTime.record(agentId, absolutePath);
        emitFileEdited(absolutePath);
        return {
          applied: {
            type: 'update',
            path: diff.oldPath,
            additions: diff.additions,
            deletions: diff.deletions,
          },
          fileChange: { filePath: absolutePath, oldContent: original, newContent: updated },
        };
      }
      case 'move': {
        if (!newAbsolutePath) {
          throw new Error('Missing destination path for move diff.');
        }
        await this.assertReadableForPatch(agentId, absolutePath, diff.oldPath);
        const original = await fs.readFile(absolutePath, 'utf8');
        const updated =
          diff.hunks.length > 0 ? Patch.applyFileDiff(original, diff.hunks) : original;
        await fs.mkdir(path.dirname(newAbsolutePath), { recursive: true });
        await fs.writeFile(newAbsolutePath, updated, 'utf8');
        await fs.unlink(absolutePath);
        FileTime.record(agentId, newAbsolutePath);
        emitFileEdited(newAbsolutePath);
        return {
          applied: {
            type: 'move',
            path: `${diff.oldPath} → ${diff.newPath}`,
            additions: diff.additions,
            deletions: diff.deletions,
          },
          fileChange: { filePath: newAbsolutePath, oldContent: original, newContent: updated },
        };
      }
      default: {
        const typeValue =
          typeof diff.type === 'string' ? diff.type : JSON.stringify(diff.type ?? 'unknown');
        throw new Error(`Unsupported diff type: ${typeValue}`);
      }
    }
  }

  private async assertReadableForPatch(
    agentId: string,
    absolutePath: string,
    displayPath: string
  ) {
    try {
      await FileTime.assert(agentId, absolutePath);
    } catch (assertErr) {
      const msg = `${assertErr instanceof Error ? assertErr.message : String(assertErr)} — call read on '${displayPath}' before patch.`;
      throw new Error(msg);
    }
  }
}

export class ApplyPatchTool implements ICommand<ApplyPatchParams, unknown> {
  readonly name = 'patch';
  readonly key = 'patch';
  readonly group = 'edit';
  readonly availableIn = { tool: true };
  readonly description = [
    'Apply a standard unified diff (--- / +++ / @@ format) to one or more files.',
    'Each changed file is access-checked individually.',
    'Existing files MUST have been read with read in the current session.',
    'New files (add hunks) do not require a prior read.',
  ].join(' ');
  readonly parameters = z.object({
    patchText: z
      .string()
      .min(1)
      .describe(
        'Standard unified diff string. Must start with --- / +++ file headers and @@ hunk markers.'
      ),
  });

  private readonly service: ApplyPatchService;

  constructor(
    workspaceRoot: string,
    pathPermissionChecker: IPathPermissionChecker,
    ideAdapterFactory: IIdeAdapterFactory
  ) {
    this.service = new ApplyPatchService(workspaceRoot, pathPermissionChecker, ideAdapterFactory);
  }

  formatForLlm(result: unknown): unknown {
    const inner = (result as { data?: unknown })?.data ?? result;
    const r = inner as {
      applied?: Array<{ type: string; path: string; additions: number; deletions: number }>;
      denied?: Array<{ path: string; reason: string }>;
      totalFiles?: number;
      totalAdditions?: number;
      totalDeletions?: number;
      error?: string;
    };
    if (r.error && !r.applied?.length) return `Error: ${r.error}`;
    const lines: string[] = [];
    if (r.totalFiles)
      lines.push(`${r.totalFiles} file(s): +${r.totalAdditions} -${r.totalDeletions}`);
    for (const f of r.applied ?? [])
      lines.push(`  ${f.type}  ${f.path}  +${f.additions}/-${f.deletions}`);
    if (r.denied?.length) {
      lines.push(`Denied (${r.denied.length}):`);
      for (const d of r.denied) lines.push(`  ${d.path}: ${d.reason}`);
    }
    if (r.error) lines.push(`Error: ${r.error}`);
    return lines.join('\n') || 'No changes.';
  }

  async execute(
    params: ApplyPatchParams,
    context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    return this.service.apply(params.patchText, context);
  }
}
