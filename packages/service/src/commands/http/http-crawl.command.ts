import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import { z } from 'zod';
import {
  applyHttpTextFilters,
  clampNumber,
  HTTP_DEFAULT_MAX_CHUNKS,
  HTTP_DEFAULT_TIMEOUT_MS,
  HTTP_MAX_CHUNKS,
  type HttpCrawlParams,
  type HttpCrawlResult,
  runHttpCrawl,
} from './http-command-shared.js';

export { type HttpCrawlParams, type HttpCrawlResult } from './http-command-shared.js';

export class HttpCrawlCommand implements ICommand<HttpCrawlParams, HttpCrawlResult> {
  readonly name = 'crawl';
  readonly key = 'crawl';
  readonly group = 'http';
  readonly availableIn = { tool: true };
  readonly description =
    'Crawl links from a starting URL with depth/page limits and return filtered text chunks.';

  readonly parameters = z.object({
    url: z
      .string()
      .min(1)
      .describe('Start URL')
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      }, 'Expected an absolute http/https URL'),
    crawlEnabled: z
      .boolean()
      .optional()
      .describe('Must be true to execute crawling (default false)'),
    maxDepth: z.number().int().min(0).max(5).optional().describe('Max crawl depth (default 1)'),
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max pages to fetch (default 10)'),
    timeoutMsPerPage: z.number().int().min(500).max(30_000).optional().describe('Per-page timeout'),
    allowCrossDomain: z.boolean().optional().describe('Allow crawling links across domains'),
    allowedDomains: z
      .array(z.string())
      .optional()
      .describe('Optional explicit domain allowlist when cross-domain is enabled'),
    regex: z
      .string()
      .optional()
      .describe('Optional regex pattern to extract snippets from crawled text'),
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
  });

  formatForLlm(result: HttpCrawlResult): unknown {
    if (!result.crawled) return `${result.url}: crawling disabled (set crawlEnabled=true)`;
    const header = `${result.url}  ${result.visitedCount} page(s) crawled`;
    if (!result.chunks?.length) return header;
    return `${header}\n\n${result.chunks.join('\n\n')}`;
  }

  async execute(
    params: HttpCrawlParams,
    _context: ExecutionContext
  ): Promise<CommandResponse<HttpCrawlResult>> {
    const {
      url,
      crawlEnabled = false,
      maxDepth = 1,
      maxPages = 10,
      timeoutMsPerPage = HTTP_DEFAULT_TIMEOUT_MS,
      allowCrossDomain = false,
      allowedDomains = [],
      ...filterOptions
    } = params;

    if (!crawlEnabled) {
      return {
        status: 'ok',
        data: {
          url,
          crawled: false,
          message: 'Crawling is disabled. Set crawlEnabled=true to start crawling.',
          pages: [],
          visitedCount: 0,
          chunks: [],
        },
      };
    }

    const crawlResult = await runHttpCrawl(url, {
      maxDepth,
      maxPages,
      timeoutMsPerPage,
      allowCrossDomain,
      allowedDomains,
      filterOptions,
    });

    const cappedMaxChunks = clampNumber(
      filterOptions.maxChunks ?? HTTP_DEFAULT_MAX_CHUNKS,
      1,
      HTTP_MAX_CHUNKS
    );
    const finalChunks = crawlResult.allChunks.slice(0, cappedMaxChunks);

    return {
      status: 'ok',
      data: {
        url,
        crawled: true,
        maxDepth,
        maxPages,
        visitedCount: crawlResult.visitedCount,
        pageCount: crawlResult.pages.length,
        chunks: finalChunks,
        pages: crawlResult.pages,
        truncated: crawlResult.allChunks.length > finalChunks.length,
        filtersApplied: applyHttpTextFilters('noop', filterOptions).filtersApplied,
      },
    };
  }
}
