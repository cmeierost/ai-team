import { z } from 'zod';
import type {
  ICommand,
  CommandRuntime,
  IAgentManager,
  IConfigurationStorage,
  IPermissionStorage,
  IFileTreeService,
  IFileAnnotationService,
} from '@ai-team/core';
import type { FilesTreeResponse } from '@ai-team/api-contracts';
import { FileTreeCommand as FileTreeCommandImpl } from './file-tree.js';

type Params = z.infer<typeof FilesTreeCommand.schema>;

export class FilesTreeCommand implements ICommand<Params, void, FilesTreeResponse> {
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
  readonly parameters = FilesTreeCommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly configStorage: IConfigurationStorage,
    private readonly permStorage: IPermissionStorage,
    private readonly fileTreeService: IFileTreeService,
    private readonly fileAnnotationService: IFileAnnotationService
  ) {}

  async execute(payload: Params, _ctx: void, _runtime: CommandRuntime): Promise<FilesTreeResponse> {
    return new FileTreeCommandImpl(
      this.agents,
      this.configStorage,
      this.permStorage,
      this.fileTreeService,
      this.fileAnnotationService
    ).filesTree(payload);
  }
}
