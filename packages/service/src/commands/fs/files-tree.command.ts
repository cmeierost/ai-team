import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { FilesTreeResponse } from '@ai-team/api-contracts';
import { FileTreeService } from './file-tree.js';

type Params = z.infer<typeof FilesTreeCommand.schema>;
const _filesTreeCommandSchema = z.object({
  depth: z.number().optional().describe('Max recursion depth (default: 4)'),
  all: z.boolean().optional().describe('Include hidden files and directories'),
  noGitignore: z.boolean().optional().describe('Ignore .gitignore rules'),
  json: z.boolean().optional().describe('Output as JSON'),
  agent: z.string().optional().describe('Show files accessible to a specific agent'),
  writeable: z.boolean().optional().describe('Show writeable files instead of readable'),
});

export const FilesTreeCommandMetadata = {
  key: 'filesTree',
  cli: { command: 'files' },
  description:
    'Preview the workspace file tree with gitignore awareness and optional agent-scoped filtering',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'fs',
  parameters: _filesTreeCommandSchema,
} satisfies ICommandDescriptor;

export class FilesTreeCommand implements ICommand<Params, FilesTreeResponse> {
  static readonly schema = _filesTreeCommandSchema;
  readonly metadata = FilesTreeCommandMetadata;

  constructor(private readonly fileTreeService: FileTreeService) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<FilesTreeResponse>> {
    const data = await this.fileTreeService.filesTree(payload);
    return { status: 'ok', data };
  }
}
