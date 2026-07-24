import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  ICommandDescriptor,
  IWorkspaceFsFactory,
  IPathPermissionChecker,
  IIdeAdapterFactory,
} from '@ai-team/core';
import { FsWriteFileTool } from './fs-write-file.tool.js';
import { FsCreateFileTool } from './fs-create-file.tool.js';
import { FsEditTool } from './fs-edit.tool.js';

export const FsWriteToolMetadata = {
  key: 'write',
  group: 'fs',
  availableIn: { tool: true, chat: true },
  usage: '<filePath> [content] [mode]',
  description: [
    'Write through fs-context access checks.',
    'mode="replace" overwrites or creates a file, mode="create" requires a new file, and mode="patch" performs a read-before-edit exact replacement.',
    'Patch mode requires oldString and newString and preserves stale-read protection.',
    'Use createDirectories when creating a file in a missing directory.',
  ].join(' '),
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    mode: z.enum(['replace', 'create', 'patch']).optional().describe('Write mode (default replace)'),
    content: z.string().optional().describe('Complete replacement or initial file content'),
    oldString: z.string().optional().describe('Patch text to replace'),
    newString: z.string().optional().describe('Patch replacement text'),
    replaceAll: z.boolean().optional().describe('Patch every occurrence (default false)'),
    createDirectories: z.boolean().optional().describe('Create parent directories when needed'),
  }).superRefine((value, ctx) => {
    if (value.mode === 'patch') {
      if (value.oldString === undefined) ctx.addIssue({ code: 'custom', path: ['oldString'], message: 'Required for patch mode' });
      if (value.newString === undefined) ctx.addIssue({ code: 'custom', path: ['newString'], message: 'Required for patch mode' });
    } else if (value.content === undefined) {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'Required for replace/create mode' });
    }
  }),
} satisfies ICommandDescriptor;

export type FsWriteParams = z.infer<typeof FsWriteToolMetadata.parameters>;

export class FsWriteTool implements ICommand<FsWriteParams, unknown> {
  readonly metadata = FsWriteToolMetadata;
  readonly name = 'write';

  private readonly replaceTool: FsWriteFileTool;
  private readonly createTool: FsCreateFileTool;
  private readonly patchTool: FsEditTool;

  constructor(
    workspaceRoot: string,
    workspaceFsFactory: IWorkspaceFsFactory,
    pathPermissionChecker: IPathPermissionChecker,
    ideAdapterFactory: IIdeAdapterFactory
  ) {
    this.replaceTool = new FsWriteFileTool(workspaceFsFactory);
    this.createTool = new FsCreateFileTool(workspaceFsFactory);
    this.patchTool = new FsEditTool(workspaceRoot, pathPermissionChecker, ideAdapterFactory);
  }

  formatForLlm(result: unknown): unknown {
    return result;
  }

  async execute(params: FsWriteParams, context: ExecutionContext): Promise<CommandResponse<unknown>> {
    const mode = params.mode ?? 'replace';
    if (mode === 'patch') {
      return this.patchTool.execute({
        filePath: params.filePath,
        oldString: params.oldString!,
        newString: params.newString!,
        replaceAll: params.replaceAll,
      }, context);
    }
    if (mode === 'create') {
      return this.createTool.execute({
        filePath: params.filePath,
        content: params.content,
        createDirectories: params.createDirectories,
      }, context);
    }
    return this.replaceTool.execute({ filePath: params.filePath, content: params.content! }, context);
  }
}
