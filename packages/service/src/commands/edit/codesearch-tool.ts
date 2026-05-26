/**
 * codesearch — external semantic code search via Exa MCP.
 *
 * Queries the Exa code-context endpoint for library documentation,
 * API examples, and SDK references that live outside the local codebase.
 *
 * The base URL defaults to `https://mcp.exa.ai` and can be overridden
 * with the `AI_TEAM_EXA_URL` environment variable.
 */
import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CodeSearchParams {
  query: string;
  tokensNum: number;
}

export interface CodeSearchResult {
  query: string;
  tokensNum: number;
  result: string | null;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EXA_TIMEOUT_MS = 30_000;
const EXA_DEFAULT_TOKENS = 5_000;
const EXA_MIN_TOKENS = 1_000;
const EXA_MAX_TOKENS = 50_000;

function getExaBaseUrl(): string {
  return process.env.AI_TEAM_EXA_URL ?? 'https://mcp.exa.ai';
}
export const CodeSearchToolMetadata = {
  key: 'codesearch',
  group: 'search',
  availableIn: { tool: true },
  description:
    'Search external libraries, APIs, and SDK documentation for code examples and reference material. ' +
    'Use this when you need context about a third-party library, framework API, or programming concept ' +
    'that is not part of the local codebase. Returns relevant code snippets and documentation.',
  parameters: z.object({
    query: z
      .string()
      .describe(
        'Search query for APIs, libraries, or SDKs. ' +
          "E.g. 'React useState hook examples', 'Express.js middleware', 'zod schema validation'."
      ),
    tokensNum: z
      .number()
      .int()
      .min(EXA_MIN_TOKENS)
      .max(EXA_MAX_TOKENS)
      .default(EXA_DEFAULT_TOKENS)
      .describe(
        `Number of tokens to return (${EXA_MIN_TOKENS}–${EXA_MAX_TOKENS}). ` +
          `Default ${EXA_DEFAULT_TOKENS}. Use lower values for focused queries, higher for comprehensive docs.`
      ),
  }),
} satisfies ICommandDescriptor;

// ─── SSE helpers ──────────────────────────────────────────────────────────────

interface ExaMcpResult {
  result?: {
    content?: Array<{ type: string; text: string }>;
  };
}

/**
 * Parse the first valid `data: ` line from an SSE response body that
 * contains a JSON-RPC `result.content[0].text` value.
 */
function parseExaSseResult(body: string): string | null {
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const data: ExaMcpResult = JSON.parse(line.slice(6));
      const text = data.result?.content?.[0]?.text;
      if (text) return text;
    } catch {
      // Not valid JSON — try next line.
    }
  }
  return null;
}

// ─── Tool class ───────────────────────────────────────────────────────────────

export class CodeSearchTool implements ICommand<CodeSearchParams, CodeSearchResult> {
  readonly metadata = CodeSearchToolMetadata;
  readonly name = 'codesearch';

  formatForLlm(result: CodeSearchResult): unknown {
    if (result.error) return `codesearch error: ${result.error}`;
    if (!result.result) return `No results for: ${result.query}`;
    return result.result;
  }

  async execute(
    params: CodeSearchParams,
    _context: ExecutionContext
  ): Promise<CommandResponse<CodeSearchResult>> {
    const { query, tokensNum } = params;
    const baseUrl = getExaBaseUrl();
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_code_context_exa',
        arguments: { query, tokensNum },
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXA_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          status: 'ok',
          data: {
            query,
            tokensNum,
            result: null,
            error: `Code search error (${response.status}): ${errorText}`,
          },
        };
      }

      const responseText = await response.text();
      const parsed = parseExaSseResult(responseText);

      if (!parsed) {
        return {
          status: 'ok',
          data: {
            query,
            tokensNum,
            result: null,
            error:
              'No code snippets or documentation found. ' +
              'Try a more specific query or check the spelling of library/framework names.',
          },
        };
      }

      return { status: 'ok', data: { query, tokensNum, result: parsed } };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          status: 'ok',
          data: { query, tokensNum, result: null, error: 'Code search request timed out.' },
        };
      }
      return {
        status: 'ok',
        data: {
          query,
          tokensNum,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
