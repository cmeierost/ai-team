import { z } from 'zod';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IIdeAdapterFactory,
  LspOperation,
} from '@ai-team/core';
import { LspPathService, LspResolver, LspResultFormatter } from './lsp-tool-support.js';

export const LspToolMetadata = {
  key: 'lsp',
  group: 'code',
  availableIn: { tool: true },
  description:
    'Execute a language server operation (goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls, getDiagnostics) via the connected IDE. Lines are 1-based.',
  parameters: z.object({
    operation: z
      .enum([
        'goToDefinition',
        'findReferences',
        'hover',
        'documentSymbol',
        'workspaceSymbol',
        'goToImplementation',
        'prepareCallHierarchy',
        'incomingCalls',
        'outgoingCalls',
        'getDiagnostics',
      ])
      .describe('LSP operation to execute'),
    filePath: z.string().describe('File path (relative or absolute)'),
    line: z.number().int().optional().describe('1-based line number'),
    character: z.number().int().optional().describe('0-based column'),
    query: z.string().optional().describe('Query string (for workspaceSymbol)'),
  }),
} satisfies ICommandDescriptor;

export interface LspParams {
  operation: LspOperation;
  filePath: string;
  line?: number;
  character?: number;
  query?: string;
}

export class LspTool implements ICommand<LspParams, unknown> {
  readonly metadata = LspToolMetadata;
  readonly name = 'lsp';

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

  async execute(params: LspParams, context: ExecutionContext): Promise<CommandResponse<unknown>> {
    const { operation, filePath, line, character, query } = params;
    const lsp = await this.lspResolver.resolve(context);

    if (!lsp?.isAvailable()) {
      return {
        status: 'error',
        error: {
          message:
            'No IDE language server connected. Start the VS Code extension to enable LSP operations.',
        },
        data: { operation },
      };
    }

    const result = await lsp.execute(operation, {
      filePath: this.pathService.toAbsolutePath(filePath),
      line: line == null ? undefined : line - 1,
      character,
      query,
    });

    return { status: 'ok', data: { operation, ...LspResultFormatter.format(result) } };
  }
}
