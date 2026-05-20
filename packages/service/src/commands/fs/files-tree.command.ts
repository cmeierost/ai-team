import { z } from 'zod';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { FilesTreeResponse } from '@ai-team/api-contracts';
import { FileTreeService } from './file-tree.js';

type Params = z.infer<typeof FilesTreeCommand.schema>;

export class FilesTreeCommand implements ICommand<Params, FilesTreeResponse> {
  static readonly schema = z.object({
    depth: z.number().optional().describe('Max recursion depth (default: 4)'),
    all: z.boolean().optional().describe('Include hidden files and directories'),
    noGitignore: z.boolean().optional().describe('Ignore .gitignore rules'),
    json: z.boolean().optional().describe('Output as JSON'),
    agent: z.string().optional().describe('Show files accessible to a specific agent'),
    writeable: z.boolean().optional().describe('Show writeable files instead of readable'),
  });

  readonly key = 'filesTree';
  readonly cli = { command: 'files' };
  readonly description =
    'Preview the workspace file tree with gitignore awareness and optional agent-scoped filtering';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'fs';
  readonly parameters = FilesTreeCommand.schema;

  constructor(private readonly fileTreeService: FileTreeService) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<FilesTreeResponse>> {
    const data = await this.fileTreeService.filesTree(payload);
    return { status: 'ok', data };
  }
}
