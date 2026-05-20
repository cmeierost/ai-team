import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
} from '@ai-team/core';
import { failed } from './fs-tools-helpers.js';
import type { FsMkdirParams, FsMkdirResult } from './fs-tool-types.js';

export class FsMkdirTool implements ICommand<FsMkdirParams, FsMkdirResult> {
  readonly name = 'mkdir';
  readonly key = 'mkdir';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Create a directory through access checks.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute directory path'),
    recursive: z.boolean().optional().describe('Create parent directories recursively'),
  });

  constructor(private readonly workspaceFsFactory: IWorkspaceFsFactory) {}

  async execute(
    params: FsMkdirParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsMkdirResult>> {
    const { path: targetPath, recursive = true } = params;
    try {
      const fs = await this.workspaceFsFactory.create(
        context.agent?.id ?? '',
        context.agent?.permissions ?? { read: [], write: [], list: [] }
      );
      await fs.createDirectory(targetPath, { recursive });
      return { status: 'ok', data: { path: targetPath, created: true } };
    } catch (e) {
      const data = failed(e, targetPath, 'created') as unknown as FsMkdirResult;
      return {
        status: 'error',
        error: { message: data.error ?? 'Mkdir failed' },
        data,
      };
    }
  }
}
