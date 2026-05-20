import { z } from 'zod';
import type { ExecutionContext, ICommand, CommandResponse, IWorkspaceFsFactory } from '@ai-team/core';
import { failed } from './fs-tools-helpers.js';
import type { FsDeleteParams, FsDeleteResult } from './fs-tool-types.js';

export class FsDeletePathTool implements ICommand<FsDeleteParams, FsDeleteResult> {
  readonly name = 'delete_path';
  readonly key = 'delete_path';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Delete a file or directory through access checks.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute path'),
    recursive: z.boolean().optional().describe('Recursively delete directories'),
  });

  constructor(private readonly workspaceFsFactory: IWorkspaceFsFactory) {}

  async execute(
    params: FsDeleteParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsDeleteResult>> {
    const { path: targetPath, recursive = true } = params;
    try {
      const fs = await this.workspaceFsFactory.create(
        context.agent?.id ?? '',
        context.agent?.permissions ?? { read: [], write: [], list: [] }
      );
      await fs.deletePath(targetPath, { recursive });
      return { status: 'ok', data: { path: targetPath, deleted: true } };
    } catch (e) {
      const data = failed(e, targetPath, 'deleted') as unknown as FsDeleteResult;
      return {
        status: 'error',
        error: { message: data.error ?? 'Delete failed' },
        data,
      };
    }
  }
}

