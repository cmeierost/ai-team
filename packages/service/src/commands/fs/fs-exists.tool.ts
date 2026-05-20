import { z } from 'zod';
import { PermissionError } from 'fs-context';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
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

export class FsExistsTool implements ICommand<FsPathParams, FsExistsResult> {
  readonly name = 'exists';
  readonly key = 'exists';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description =
    'Check whether a file or directory exists. Access-gated as a list operation.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  });

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
