import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { z } from 'zod';
import {
  applyHttpTextFilters,
  clampNumber,
  extractLinksFromHtml,
  fetchUrlText,
  HTTP_DEFAULT_TIMEOUT_MS,
  HTTP_MAX_CHUNKS,
  HTTP_MAX_TEXT_BYTES,
  HTTP_MAX_TIMEOUT_MS,
  type HttpFetchParams,
  type HttpFetchResult,
} from './http-command-shared.js';
import { parseUrlAndJsonOptions } from './http-chat-utils.js';

export { type HttpFetchParams, type HttpFetchResult } from './http-command-shared.js';
export const HttpFetchCommandMetadata = {
  key: 'fetch',
  group: 'http',
  usage: '/http fetch <url> [json-options]',
  availableIn: { tool: true, chat: true, cli: true },
  description:
    'Fetch a URL and return filtered chunks (lines, regex/search, length) for safe LLM context usage.',
  parameters: z.object({
    url: z
      .string()
      .min(1)
      .describe('Absolute URL to fetch')
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      }, 'Expected an absolute http/https URL'),
    timeoutMs: z
      .number()
      .int()
      .min(500)
      .max(HTTP_MAX_TIMEOUT_MS)
      .optional()
      .describe('Request timeout in milliseconds'),
    regex: z
      .string()
      .optional()
      .describe('Optional regex pattern to extract snippets from result text'),
    regexFlags: z.string().optional().describe('Regex flags (default: gi)'),
    search: z
      .string()
      .optional()
      .describe('Optional substring search applied before regex/line filtering'),
    startLine: z.number().int().min(1).optional().describe('1-based inclusive start line'),
    endLine: z.number().int().min(1).optional().describe('1-based inclusive end line'),
    maxLines: z
      .number()
      .int()
      .min(1)
      .max(3000)
      .optional()
      .describe('Maximum number of lines returned'),
    maxChars: z
      .number()
      .int()
      .min(256)
      .max(100000)
      .optional()
      .describe('Maximum characters returned'),
    maxChunks: z
      .number()
      .int()
      .min(1)
      .max(HTTP_MAX_CHUNKS)
      .optional()
      .describe('Maximum chunks returned'),
    contextChars: z
      .number()
      .int()
      .min(10)
      .max(1000)
      .optional()
      .describe('Context window around regex matches'),
    includeLinks: z.boolean().optional().describe('Include discovered links when response is HTML'),
  }),
} satisfies ICommandDescriptor;

export class HttpFetchCommand implements ICommand<HttpFetchParams | string, HttpFetchResult> {
  readonly metadata = HttpFetchCommandMetadata;
  readonly name = 'fetch';

  formatForLlm(result: HttpFetchResult): unknown {
    if (!result.chunks?.length) return `${result.url} (HTTP ${result.status}) — no content`;
    const header = `${result.url} (HTTP ${result.status}, ${result.lineCount} lines, ${result.charCount} chars${result.truncated ? ', truncated' : ''})`;
    return `${header}\n\n${result.chunks.join('\n\n')}`;
  }

  async execute(
    params: HttpFetchParams | string,
    _context: ExecutionContext
  ): Promise<CommandResponse<HttpFetchResult>> {
    let fetchParams: HttpFetchParams;
    let isChatInvoke = false;
    if (typeof params === 'string') {
      isChatInvoke = true;
      const parsed = parseUrlAndJsonOptions(params);
      if (parsed.error === 'missing-url') {
        return { status: 'error', message: `Usage: ${this.metadata.usage}` };
      }
      if (parsed.error === 'json-object-required') {
        return {
          status: 'error',
          message: 'JSON args must be an object, e.g. {"timeoutMs":12000}.',
        };
      }
      if (parsed.error) {
        return { status: 'error', message: parsed.error };
      }
      fetchParams = { url: parsed.url!, ...parsed.options };
    } else {
      fetchParams = params;
    }

    const {
      url,
      timeoutMs = HTTP_DEFAULT_TIMEOUT_MS,
      includeLinks = true,
      ...filterOptions
    } = fetchParams;

    const boundedTimeout = clampNumber(timeoutMs, 500, HTTP_MAX_TIMEOUT_MS);
    const fetched = await fetchUrlText(url, boundedTimeout);
    const processed = applyHttpTextFilters(fetched.bodyText, filterOptions);
    const links =
      includeLinks && fetched.rawHtml
        ? extractLinksFromHtml(fetched.rawHtml, fetched.finalUrl)
        : [];

    const data: HttpFetchResult = {
      url,
      finalUrl: fetched.finalUrl,
      status: fetched.status,
      ok: fetched.ok,
      contentType: fetched.contentType,
      lineCount: processed.lineCount,
      charCount: processed.charCount,
      chunks: processed.chunks,
      filtersApplied: processed.filtersApplied,
      regexMatchCount: processed.regexMatchCount,
      truncated: processed.truncated || fetched.bodyText.length >= HTTP_MAX_TEXT_BYTES,
      links,
      linkCount: links.length,
    };

    if (isChatInvoke) {
      const formatted = this.formatForLlm(data) as string;
      return {
        status: 'ok',
        message: `\n${formatted}\n\n(Result not in context — use /context add to include it.)`,
        data,
      };
    }

    return { status: 'ok', data };
  }
}
