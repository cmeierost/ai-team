import { z } from 'zod';
import { PermissionError } from 'fs-context';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
  ICommandDescriptor,
} from '@ai-team/core';
import { failed } from './fs-tools-helpers.js';
import type { FsPathParams, FsInfoResult } from './fs-tool-types.js';
export const FsInfoToolMetadata = {
  key: 'info',
  group: 'fs',
  availableIn: { tool: true },
  description: 'Get file/directory metadata and access envelope. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
} satisfies ICommandDescriptor;

export class FsInfoTool implements ICommand<FsPathParams, FsInfoResult> {
  readonly metadata = FsInfoToolMetadata;
  readonly name = 'info';

  constructor(private readonly workspaceFsFactory: IWorkspaceFsFactory) {}

  async execute(
    params: FsPathParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsInfoResult>> {
    const { path: targetPath } = params;
    try {
      const fs = await this.workspaceFsFactory.create(
        context.agent?.id ?? '',
        context.agent?.permissions ?? { read: [], write: [], list: [] }
      );
      const info = await fs.getPathInfo(targetPath);
      return {
        status: 'ok',
        data: { path: targetPath, exists: info !== null, info, access: { allowed: true } },
      };
    } catch (e) {
      if (e instanceof PermissionError) {
        return {
          status: 'ok',
          data: { path: targetPath, exists: false, info: null, access: { allowed: false } },
        };
      }
      const data = failed(e, targetPath, 'exists') as unknown as FsInfoResult;
      return {
        status: 'error',
        error: { message: data.error ?? 'Info failed' },
        data,
      };
    }
  }
}
