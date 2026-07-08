import { z } from 'zod';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IIdeAdapterFactory,
} from '@ai-team/core';
import { LspPathService, LspResolver, LspResultFormatter } from './lsp-tool-support.js';

export const FindReferencesToolMetadata = {
  key: 'find_references',
  group: 'code',
  availableIn: { tool: true },
  description:
    'Find all references/usages of a symbol via the connected IDE language server. Position the cursor on a symbol usage to find all other references. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('File containing the symbol'),
    line: z.number().int().describe('1-based line number of the symbol'),
    character: z.number().int().describe('0-based column of the symbol'),
  }),
} satisfies ICommandDescriptor;

export interface FindReferencesParams {
  filePath: string;
  line: number;
  character: number;
}

export class FindReferencesTool implements ICommand<FindReferencesParams, unknown> {
  readonly metadata = FindReferencesToolMetadata;
  readonly name = 'find_references';

  private readonly lspResolver: LspResolver;
  private readonly pathService: LspPathService;

  constructor(
    workspaceRoot: string,
    ideAdapterFactory: IIdeAdapterFactory
  ) {
    this.lspResolver = new LspResolver(workspaceRoot, ideAdapterFactory);
    this.pathService = new LspPathService(workspaceRoot);
  }

  formatForLlm(result: unknown): unknown {
    return LspResultFormatter.formatForLlm(result);
  }

  async execute(
    params: FindReferencesParams,
    context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const { filePath, line, character } = params;
    const lsp = await this.lspResolver.resolve(context);

    if (!lsp?.isAvailable()) {
      return {
        status: 'error',
        error: {
          message:
            'No IDE language server connected. Connect the VS Code extension for LSP-based reference finding.',
        },
        data: { filePath, line },
      };
    }

    const result = await lsp.execute('findReferences', {
      filePath: this.pathService.toAbsolutePath(filePath),
      line: line - 1,
      character,
    });

    return { status: 'ok', data: LspResultFormatter.format(result) };
  }
}
