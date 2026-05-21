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

export interface FsPathParams {
  path: string;
}

export interface FsExistsResult {
  path: string;
  exists: boolean;
  access?: { allowed: boolean };
  error?: string;
}
export const FsExistsToolMetadata = {
  key: 'exists',
  group: 'fs',
  availableIn: { tool: true },
  description: 'Check whether a file or directory exists. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
} satisfies ICommandDescriptor;

export class FsExistsTool implements ICommand<FsPathParams, FsExistsResult> {
  readonly metadata = FsExistsToolMetadata;
  readonly name = 'exists';

  constructor(private readonly workspaceFsFactory: IWorkspaceFsFactory) {}

  async execute(
    params: FsPathParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsExistsResult>> {
    const { path: targetPath } = params;
    try {
      const fs = await this.workspaceFsFactory.create(
        context.agent?.id ?? '',
        context.agent?.permissions ?? { read: [], write: [], list: [] }
      );
      const exists = await fs.existsPath(targetPath);
      return {
        status: 'ok',
        data: { path: targetPath, exists, access: { allowed: true } },
      };
    } catch (e) {
      if (e instanceof PermissionError) {
        return {
          status: 'ok',
          data: { path: targetPath, exists: false, access: { allowed: false } },
        };
      }
      const data = failed(e, targetPath, 'exists') as unknown as FsExistsResult;
      return {
        status: 'error',
        error: { message: data.error ?? 'Exists check failed' },
        data,
      };
    }
  }
}
