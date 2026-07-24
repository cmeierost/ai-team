import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
  ICommandDescriptor,
} from '@ai-team/core';
import { failed } from './fs-tools-helpers.js';
import type { FsCreateParams, FsCreateResult } from './fs-tool-types.js';
export const FsCreateFileToolMetadata = {
  key: 'create',
  group: 'fs',
  availableIn: { tool: true },
  description: 'Create a new file through access checks.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().optional().describe('Optional initial content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
} satisfies ICommandDescriptor;

export class FsCreateFileTool implements ICommand<FsCreateParams, FsCreateResult> {
  readonly metadata = FsCreateFileToolMetadata;
  readonly name = 'create';

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
      const absolutePath = fs.toAbsolutePath(filePath);
      const { bytes } = await fs.createFile(filePath, content, { createDirectories });
      return {
        status: 'ok',
        data: { path: filePath, created: true, bytes },
        _fileChanges: [{ filePath: absolutePath, oldContent: '', newContent: content }],
      } as CommandResponse<FsCreateResult>;
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
