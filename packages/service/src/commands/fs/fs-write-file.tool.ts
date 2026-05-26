import * as nodeFs from 'node:fs/promises';
import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
  ICommandDescriptor,
} from '@ai-team/core';
import { failed } from './fs-tools-helpers.js';
import type { FsWriteParams, FsWriteResult } from './fs-tool-types.js';
export const FsWriteFileToolMetadata = {
  key: 'write_file',
  group: 'fs',
  availableIn: { tool: true },
  description: 'Write (overwrite) a file through access checks.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('Content to write'),
  }),
} satisfies ICommandDescriptor;

export class FsWriteFileTool implements ICommand<FsWriteParams, FsWriteResult> {
  readonly metadata = FsWriteFileToolMetadata;
  readonly name = 'write_file';

  constructor(private readonly workspaceFsFactory: IWorkspaceFsFactory) {}

  async execute(
    params: FsWriteParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsWriteResult>> {
    const { filePath, content } = params;
    try {
      const workspaceFs = await this.workspaceFsFactory.create(
        context.agent?.id ?? '',
        context.agent?.permissions ?? { read: [], write: [], list: [] }
      );
      const absolutePath = workspaceFs.toAbsolutePath(filePath);

      let oldContent = '';
      try {
        oldContent = await nodeFs.readFile(absolutePath, 'utf8');
      } catch {
        oldContent = '';
      }

      const { bytes } = await workspaceFs.writeFile(filePath, content);
      return {
        status: 'ok',
        data: {
          path: filePath,
          written: true,
          bytes,
          _fileChanges: [{ filePath: absolutePath, oldContent, newContent: content }],
        },
      };
    } catch (e) {
      const data = failed(e, filePath, 'written') as unknown as FsWriteResult;
      return {
        status: 'error',
        error: { message: data.error ?? 'Write failed' },
        data,
      };
    }
  }
}
