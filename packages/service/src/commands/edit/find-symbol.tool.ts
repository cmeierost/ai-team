import { z } from 'zod';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IIdeAdapterFactory,
} from '@ai-team/core';
import { LspPathService, LspResolver, LspResultFormatter } from './lsp-tool-support.js';

export const FindSymbolToolMetadata = {
  key: 'find_symbol',
  group: 'code',
  availableIn: { tool: true },
  description:
    'Find symbol definitions (functions, classes, variables) via the connected IDE language server. Requires read permission.',
  parameters: z.object({
    symbolName: z.string().describe('Name of the symbol to find'),
    filePath: z.string().optional().describe('File to search in (omit for workspace-wide search)'),
    line: z
      .number()
      .int()
      .optional()
      .describe('1-based line number (for go-to-definition from a usage site)'),
    character: z
      .number()
      .int()
      .optional()
      .describe('0-based column (for go-to-definition from a usage site)'),
  }),
} satisfies ICommandDescriptor;

export interface FindSymbolParams {
  symbolName: string;
  filePath?: string;
  line?: number;
  character?: number;
}

export class FindSymbolTool implements ICommand<FindSymbolParams, unknown> {
  readonly metadata = FindSymbolToolMetadata;
  readonly name = 'find_symbol';

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
    params: FindSymbolParams,
    context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const { symbolName, filePath, line, character } = params;
    const lsp = await this.lspResolver.resolve(context);

    if (!lsp?.isAvailable()) {
      return {
        status: 'error',
        error: {
          message:
            'No IDE language server connected. Connect the VS Code extension for LSP-based symbol finding.',
        },
        data: { symbolName, filePath },
      };
    }

    if (filePath && line != null && character != null) {
      const result = await lsp.execute('goToDefinition', {
        filePath: this.pathService.toAbsolutePath(filePath),
        line: line - 1,
        character,
      });
      return { status: 'ok', data: { symbolName, ...LspResultFormatter.format(result) } };
    }

    if (filePath) {
      const result = await lsp.execute('documentSymbol', {
        filePath: this.pathService.toAbsolutePath(filePath),
      });

      if (result.kind === 'symbols') {
        const filtered = LspResultFormatter.filterSymbolsByName(result.symbols, symbolName);
        return {
          status: 'ok',
          data: { symbolName, count: filtered.length, symbols: filtered },
        };
      }

      return { status: 'ok', data: { symbolName, ...LspResultFormatter.format(result) } };
    }

    const result = await lsp.execute('workspaceSymbol', { filePath: '', query: symbolName });
    return { status: 'ok', data: { symbolName, ...LspResultFormatter.format(result) } };
  }
}
