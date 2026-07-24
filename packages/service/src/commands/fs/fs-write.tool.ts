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
import { MultiEditTool } from './multi-edit.tool.js';

export const FsWriteToolMetadata = {
  key: 'write',
  group: 'fs',
  availableIn: { tool: true, chat: true },
  usage: '<filePath> <content|oldString+newString|edits>',
  examples: [
    '/fs write docs/new.md "# New document"',
  ],
  description:
    'Create, replace, or edit one file. Provide exactly one of: content, oldString+newString, or edits[]. Targeted edits require a prior fs_read; use fs_read to inspect files.',
  parameters: z.object({
    filePath: z.string().describe('File to write or edit. To read this path, use fs_read instead'),
    content: z.string().optional().describe('Complete replacement or initial file content'),
    oldString: z.string().optional().describe('Patch text to replace'),
    newString: z.string().optional().describe('Patch replacement text'),
    replaceAll: z.boolean().optional().describe('Patch every occurrence (default false)'),
    edits: z.array(z.object({
      oldString: z.string().min(1).describe('Exact text to replace'),
      newString: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional().describe('Replace every occurrence (default false)'),
    })).min(1).optional().describe('Ordered replacements for multi mode'),
    createDirectories: z.boolean().optional().describe('Create parent directories when needed'),
  }).superRefine((value, ctx) => {
    const hasContent = value.content !== undefined;
    const hasPatch = value.oldString !== undefined || value.newString !== undefined;
    const hasMulti = value.edits !== undefined;
    const operationCount = Number(hasContent) + Number(hasPatch) + Number(hasMulti);
    if (operationCount !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Supply exactly one operation: content, oldString+newString, or edits',
      });
    }
    if (hasPatch) {
      if (value.oldString === undefined) ctx.addIssue({ code: 'custom', path: ['oldString'], message: 'Required with newString' });
      if (value.newString === undefined) ctx.addIssue({ code: 'custom', path: ['newString'], message: 'Required with oldString' });
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
  private readonly multiTool: MultiEditTool;

  constructor(
    workspaceRoot: string,
    private readonly workspaceFsFactory: IWorkspaceFsFactory,
    pathPermissionChecker: IPathPermissionChecker,
    ideAdapterFactory: IIdeAdapterFactory
  ) {
    this.replaceTool = new FsWriteFileTool(workspaceFsFactory);
    this.createTool = new FsCreateFileTool(workspaceFsFactory);
    this.patchTool = new FsEditTool(workspaceRoot, pathPermissionChecker, ideAdapterFactory);
    this.multiTool = new MultiEditTool(
      workspaceRoot,
      this.patchTool,
      pathPermissionChecker,
      ideAdapterFactory
    );
  }

  formatForLlm(result: unknown): unknown {
    const inner = (result as { data?: unknown })?.data ?? result;
    if (inner && typeof inner === 'object' && 'totalEdits' in inner) {
      return this.multiTool.formatForLlm(result);
    }
    return result;
  }

  async execute(params: FsWriteParams, context: ExecutionContext): Promise<CommandResponse<unknown>> {
    if (params.edits !== undefined) {
      return this.multiTool.execute({
        filePath: params.filePath,
        edits: params.edits,
      }, context);
    }
    if (params.oldString !== undefined || params.newString !== undefined) {
      return this.patchTool.execute({
        filePath: params.filePath,
        oldString: params.oldString!,
        newString: params.newString!,
        replaceAll: params.replaceAll,
      }, context);
    }
    const workspaceFs = await this.workspaceFsFactory.create(
      context.agent?.id ?? '',
      context.agent?.permissions
    );
    if (!(await workspaceFs.existsPath(params.filePath))) {
      return this.createTool.execute({
        filePath: params.filePath,
        content: params.content,
        createDirectories: params.createDirectories,
      }, context);
    }
    return this.replaceTool.execute({ filePath: params.filePath, content: params.content! }, context);
  }
}
