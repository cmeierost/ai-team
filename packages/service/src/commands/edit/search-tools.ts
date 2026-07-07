import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  LspDiagnostic,
  IFileAnnotationService,
  IIdeAdapterFactory,
  LspProvider,
  ICommandDescriptor,
} from '@ai-team/core';
import { collectPostWriteDiagnostics } from '../../tools/catalog/diagnostics-helper.js';

// ─── SemanticSearch ───────────────────────────────────────────────────────────

export interface SemanticSearchParams {
  query: string;
  maxResults?: number;
}
export const SemanticSearchToolMetadata = {
  key: 'semantic',
  group: 'search',
  availableIn: { tool: true },
  description:
    'List workspace files accessible to the calling agent, optionally filtered by path prefix. ' +
    'Returns structured access annotations (readable/writable/listable) for each file.',
  parameters: z.object({
    query: z.string().describe('Path prefix or glob fragment to filter files by'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Maximum number of results to return (default 100)'),
  }),
} satisfies ICommandDescriptor;

export interface SemanticSearchResult {
  query: string;
  results: Array<{
    path: string;
    readable: boolean;
    writable: boolean;
    listable: boolean;
  }>;
  total: number;
}

export class SemanticSearchTool implements ICommand<SemanticSearchParams, SemanticSearchResult> {
  readonly metadata = SemanticSearchToolMetadata;
  readonly name = 'semantic';

  constructor(
    private readonly workspaceRoot: string,
    private readonly fileAnnotationService: IFileAnnotationService
  ) {}

  async execute(
    params: SemanticSearchParams,
    context: ExecutionContext
  ): Promise<CommandResponse<SemanticSearchResult>> {
    const { query, maxResults = 100 } = params;

    const allAnnotated = this.fileAnnotationService.getAnnotatedFiles(
      this.workspaceRoot,
      context.agent?.permissions,
      []
    );

    const lowerQuery = query.toLowerCase();
    const filtered = allAnnotated
      .filter((f) => !lowerQuery || f.path.toLowerCase().includes(lowerQuery))
      .slice(0, maxResults);

    return {
      status: 'ok',
      data: {
        query,
        results: filtered.map((f) => ({
          path: f.path,
          readable: f.readable,
          writable: f.writable,
          listable: f.listable,
        })),
        total: filtered.length,
      },
    };
  }
}

// ─── GetErrors ────────────────────────────────────────────────────────────────
export const GetErrorsToolMetadata = {
  key: 'get_errors',
  group: 'tool',
  availableIn: { tool: true },
  description:
    'Collect LSP diagnostics (type errors, linting issues) for one or more files. ' +
    'Returns an empty list when no LSP provider is connected.',
  parameters: z.object({
    filePaths: z.array(z.string()).min(1).describe('Relative or absolute file paths to check'),
    delayMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Milliseconds to wait before collecting diagnostics (default 500)'),
  }),
} satisfies ICommandDescriptor;

export interface GetErrorsParams {
  filePaths: string[];
  delayMs?: number;
}

export interface GetErrorsResult {
  filePaths: string[];
  diagnostics: LspDiagnostic[];
  available: boolean;
}

export class GetErrorsTool implements ICommand<GetErrorsParams, GetErrorsResult> {
  readonly metadata = GetErrorsToolMetadata;
  readonly name = 'get_errors';

  constructor(
    private readonly workspaceRoot: string,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {}

  private async resolveLsp(context: ExecutionContext): Promise<LspProvider> {
    const channel = context.invocationSurface === 'cli' ? 'cli' : 'web';
    const adapter = await this.ideAdapterFactory.createAsync(this.workspaceRoot, channel);
    return adapter.lsp;
  }

  async execute(
    params: GetErrorsParams,
    context: ExecutionContext
  ): Promise<CommandResponse<GetErrorsResult>> {
    const { filePaths, delayMs } = params;
    const lsp = await this.resolveLsp(context);
    const diagnostics = (await collectPostWriteDiagnostics(lsp, filePaths, delayMs)) ?? [];
    return {
      status: 'ok',
      data: { filePaths, diagnostics, available: diagnostics.length > 0 },
    };
  }
}
