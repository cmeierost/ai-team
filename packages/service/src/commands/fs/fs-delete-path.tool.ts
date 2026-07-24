import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
  ICommandDescriptor,
} from '@ai-team/core';
import { failed } from './fs-tools-helpers.js';
import type { FsDeleteParams, FsDeleteResult } from './fs-tool-types.js';
export const FsDeletePathToolMetadata = {
  key: 'delete',
  group: 'fs',
  availableIn: { tool: true },
  description: 'Delete a file or directory through access checks.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute path'),
    recursive: z.boolean().optional().describe('Recursively delete directories'),
  }),
} satisfies ICommandDescriptor;

export class FsDeletePathTool implements ICommand<FsDeleteParams, FsDeleteResult> {
  readonly metadata = FsDeletePathToolMetadata;
  readonly name = 'delete';

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
