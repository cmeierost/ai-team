import { z } from 'zod';
import type { AgentTool, ITool, LspDiagnostic, ToolContext } from '@ai-team/core';
import { TOOL_SERVICE_TOKENS as T } from '@ai-team/core';
import { collectPostWriteDiagnostics } from '../../tools/catalog/diagnostics-helper.js';

// ─── SemanticSearch ───────────────────────────────────────────────────────────

export interface SemanticSearchParams {
  query: string;
  maxResults?: number;
}

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

export class SemanticSearchTool implements ITool<SemanticSearchParams, ToolContext, SemanticSearchResult> {
  readonly name = 'semantic';
  readonly key = 'semantic';
  readonly group = 'search';
  readonly availableIn = { tool: true };
  readonly description =
    'List workspace files accessible to the calling agent, optionally filtered by path prefix. ' +
    'Returns structured access annotations (readable/writable/listable) for each file.';
  readonly parameters = z.object({
    query: z.string().describe('Path prefix or glob fragment to filter files by'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Maximum number of results to return (default 100)'),
  });

  async execute(params: SemanticSearchParams, context: ToolContext): Promise<SemanticSearchResult> {
    const { query, maxResults = 100 } = params;

    if (!context.resolve) {
      throw new Error('ToolContext.resolve is required for semantic search.');
    }

    const fas = context.resolve(T.FileAnnotationService);
    const allAnnotated = fas.getAnnotatedFiles(
      context.workspaceRoot,
      context.agent.permissions,
      []
    );

    const lowerQuery = query.toLowerCase();
    const filtered = allAnnotated
      .filter((f) => !lowerQuery || f.path.toLowerCase().includes(lowerQuery))
      .slice(0, maxResults);

    return {
      query,
      results: filtered.map((f) => ({
        path: f.path,
        readable: f.readable,
        writable: f.writable,
        listable: f.listable,
      })),
      total: filtered.length,
    };
  }
}

// ─── GetErrors ────────────────────────────────────────────────────────────────

export interface GetErrorsParams {
  filePaths: string[];
  delayMs?: number;
}

export interface GetErrorsResult {
  filePaths: string[];
  diagnostics: LspDiagnostic[];
  available: boolean;
}

export class GetErrorsTool implements ITool<GetErrorsParams, ToolContext, GetErrorsResult> {
  readonly name = 'get_errors';
  readonly key = 'get_errors';
  readonly group = 'tool';
  readonly availableIn = { tool: true };
  readonly description =
    'Collect LSP diagnostics (type errors, linting issues) for one or more files. ' +
    'Returns an empty list when no LSP provider is connected.';
  readonly parameters = z.object({
    filePaths: z
      .array(z.string())
      .min(1)
      .describe('Relative or absolute file paths to check'),
    delayMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Milliseconds to wait before collecting diagnostics (default 500)'),
  });

  async execute(params: GetErrorsParams, context: ToolContext): Promise<GetErrorsResult> {
    const { filePaths, delayMs } = params;
    const diagnostics =
      (await collectPostWriteDiagnostics(context, filePaths, delayMs)) ?? [];

    return {
      filePaths,
      diagnostics,
      available: diagnostics.length > 0 || diagnostics !== undefined,
    };
  }
}

// ─── Module-level singletons ──────────────────────────────────────────────────

export const semanticSearchTool: AgentTool = new SemanticSearchTool();
export const getErrorsTool: AgentTool = new GetErrorsTool();
