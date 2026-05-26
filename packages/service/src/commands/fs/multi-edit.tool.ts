import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IPathPermissionChecker,
  IIdeAdapterFactory,
  LspProvider,
  ICommandDescriptor,
} from '@ai-team/core';
import { resolveFsAbsolutePath, toFsPathAccessEnvelope } from './fs-access.js';
import { collectPostWriteDiagnostics } from '../../tools/catalog/diagnostics-helper.js';
import { FsEditTool } from './fs-edit.tool.js';

export interface MultiEditParams {
  filePath: string;
  edits: Array<{ oldString: string; newString: string; replaceAll?: boolean }>;
}
export const MultiEditToolMetadata = {
  key: 'multiedit',
  group: 'edit',
  availableIn: { tool: true },
  description: [
    'Apply multiple oldString→newString replacements to a single file in one call.',
    'Edits are applied sequentially; the file MUST have been read with fs_read first.',
    'Stops on the first failed edit and returns partial results with the error index.',
  ].join(' '),
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute path to the file to edit'),
    edits: z
      .array(
        z.object({
          oldString: z.string().min(1).describe('Exact string to replace'),
          newString: z.string().describe('Replacement string'),
          replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false)'),
        })
      )
      .min(1)
      .describe('Ordered list of edits to apply sequentially'),
  }),
} satisfies ICommandDescriptor;

export class MultiEditTool implements ICommand<MultiEditParams, unknown> {
  readonly metadata = MultiEditToolMetadata;
  readonly name = 'multiedit';

  constructor(
    private readonly workspaceRoot: string,
    private readonly fsEdit: FsEditTool,
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {}

  private async resolveLsp(context: ExecutionContext): Promise<LspProvider> {
    const channel = context.invocationSurface === 'cli' ? 'cli' : 'web';
    const adapter = await this.ideAdapterFactory.createAsync(this.workspaceRoot, channel);
    return adapter.lsp;
  }

  formatForLlm(result: unknown): unknown {
    const inner = (result as { data?: unknown })?.data ?? result;
    const r = inner as {
      path: string;
      succeeded: number;
      totalEdits: number;
      failedAtIndex?: number;
      error?: string;
    };
    if (r.error && r.succeeded === 0) return `Error in ${r.path}: ${r.error}`;
    if (r.succeeded === r.totalEdits)
      return `${r.succeeded}/${r.totalEdits} edits applied to ${r.path}`;
    return `${r.succeeded}/${r.totalEdits} edits applied to ${r.path} (failed at #${(r.failedAtIndex ?? r.succeeded) + 1}: ${r.error ?? 'unknown'})`;
  }

  async execute(
    params: MultiEditParams,
    context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const { filePath, edits } = params;

    const access = toFsPathAccessEnvelope(
      this.pathPermissionChecker,
      context.agent,
      'edit',
      filePath
    );
    if (!access.allowed) {
      return {
        status: 'error',
        error: { message: access.explanation },
        data: {
          path: filePath,
          succeeded: 0,
          totalEdits: edits.length,
          results: [],
          access,
          delegation: {
            possible: access.alternativeContexts.length > 0,
            contexts: access.alternativeContexts,
          },
        },
      };
    }

    const results: Array<{ index: number; result: unknown }> = [];
    let succeeded = 0;
    let firstOldContent: string | undefined;
    let lastNewContent: string | undefined;

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const editResp = await this.fsEdit.execute(
        {
          filePath,
          oldString: edit.oldString,
          newString: edit.newString,
          replaceAll: edit.replaceAll,
        },
        context
      );

      const r = (editResp.data ?? {}) as { edited?: boolean; error?: string };
      const editFileChanges = (editResp as unknown as Record<string, unknown>)._fileChanges as
        | Array<{ oldContent: string; newContent: string }>
        | undefined;
      if (editFileChanges?.[0]) {
        firstOldContent ??= editFileChanges[0].oldContent;
        lastNewContent = editFileChanges[0].newContent;
      }
      results.push({ index: i, result: editResp.data ?? {} });

      if (!r.edited) {
        const failMsg = r.error ?? 'Edit failed';
        return {
          status: 'error',
          error: { message: failMsg },
          data: {
            path: filePath,
            succeeded,
            totalEdits: edits.length,
            failedAtIndex: i,
            error: failMsg,
            results,
          },
        };
      }
      succeeded++;
    }

    const absolutePath = resolveFsAbsolutePath(this.workspaceRoot, filePath);
    const diagnostics = absolutePath
      ? await collectPostWriteDiagnostics(await this.resolveLsp(context), [absolutePath])
      : undefined;
    const _fileChanges =
      absolutePath && firstOldContent !== undefined && lastNewContent !== undefined
        ? [{ filePath: absolutePath, oldContent: firstOldContent, newContent: lastNewContent }]
        : undefined;

    return {
      status: 'ok',
      data: {
        path: filePath,
        succeeded,
        totalEdits: edits.length,
        results,
        ...(diagnostics ? { diagnostics } : {}),
      },
      ...(_fileChanges ? { _fileChanges } : {}),
    };
  }
}
