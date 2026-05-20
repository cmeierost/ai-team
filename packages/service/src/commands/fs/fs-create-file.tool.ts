import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
} from '@ai-team/core';
import { failed } from './fs-tools-helpers.js';
import type { FsCreateParams, FsCreateResult } from './fs-tool-types.js';

export class FsCreateFileTool implements ICommand<FsCreateParams, FsCreateResult> {
  readonly name = 'create';
  readonly key = 'create';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Create a new file through access checks.';
  readonly parameters = z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().optional().describe('Optional initial content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  });

  constructor(private readonly workspaceFsFactory: IWorkspaceFsFactory) {}

  async execute(
    params: FsCreateParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsCreateResult>> {
    const { filePath, content = '', createDirectories = false } = params;
    try {
      const fs = await this.workspaceFsFactory.create(
        context.agent?.id ?? '',
        context.agent?.permissions ?? { read: [], write: [], list: [] }
      );
      const { bytes } = await fs.createFile(filePath, content, { createDirectories });
      return { status: 'ok', data: { path: filePath, created: true, bytes } };
    } catch (e) {
      const data = failed(e, filePath, 'created') as unknown as FsCreateResult;
      return {
        status: 'error',
        error: { message: data.error ?? 'Create failed' },
        data,
      };
    }
  }
}
