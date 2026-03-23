import { z } from 'zod';
import type { AgentTool } from '../types/index.js';

// ============================================================================
// HTTP Constants
// ============================================================================

const HTTP_DEFAULT_TIMEOUT_MS = 12_000;
const HTTP_MAX_TIMEOUT_MS = 30_000;
const HTTP_DEFAULT_MAX_CHARS = 8_000;
const HTTP_MAX_TEXT_BYTES = 400_000;
const HTTP_DEFAULT_MAX_CHUNKS = 10;
const HTTP_MAX_CHUNKS = 50;
const HTTP_DEFAULT_CONTEXT_CHARS = 120;
const HTTP_DEFAULT_MAX_LINES = 300;

// ============================================================================
// HTTP Interfaces
// ============================================================================

interface HttpFilterOptions {
  regex?: string;
  regexFlags?: string;
  search?: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
  maxChars?: number;
  maxChunks?: number;
  contextChars?: number;
}

interface HttpPreparedText {
  text: string;
  chunks: string[];
  lineCount: number;
  charCount: number;
  filtersApplied: string[];
  truncated: boolean;
  regexMatchCount?: number;
}

// ============================================================================
// HTTP Helpers
// ============================================================================

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stripHtmlToText(input: string): string {
  return input
    .replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replaceAll(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&nbsp;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&lt;/gi, '<')
    .replaceAll(/&gt;/gi, '>')
    .replaceAll('\r', '')
    .replaceAll('\t', ' ')
    .replaceAll(/ {2,}/g, ' ')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('javascript:')) continue;
    try {
      const normalized = new URL(raw, baseUrl);
      if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') continue;
      normalized.hash = '';
      links.add(normalized.toString());
    } catch {
      // ignore invalid link
    }
  }
  return [...links];
}

function collectRegexSnippets(source: string, pattern: RegExp, contextChars: number, maxChunks: number): { snippets: string[]; count: number } {
  const snippets: string[] = [];
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    count += 1;
    if (snippets.length < maxChunks) {
      const idx = match.index ?? 0;
      const start = Math.max(0, idx - contextChars);
      const end = Math.min(source.length, idx + (match[0]?.length ?? 0) + contextChars);
      snippets.push(source.slice(start, end).trim());
    }
    if (!pattern.global) break;
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  return { snippets, count };
}

function splitIntoChunks(text: string, maxChunks: number, targetChunkChars = 700): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length && chunks.length < maxChunks) {
    const next = Math.min(text.length, cursor + targetChunkChars);
    chunks.push(text.slice(cursor, next).trim());
    cursor = next;
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

function applyHttpTextFilters(rawText: string, options: HttpFilterOptions): HttpPreparedText {
  const filtersApplied: string[] = [];
  const maxLines = clampNumber(options.maxLines ?? HTTP_DEFAULT_MAX_LINES, 1, 3000);
  const maxChars = clampNumber(options.maxChars ?? HTTP_DEFAULT_MAX_CHARS, 256, 100_000);
  const maxChunks = clampNumber(options.maxChunks ?? HTTP_DEFAULT_MAX_CHUNKS, 1, HTTP_MAX_CHUNKS);
  const contextChars = clampNumber(options.contextChars ?? HTTP_DEFAULT_CONTEXT_CHARS, 10, 1000);

  let text = rawText.replaceAll(/\r\n?/g, '\n');
  let regexMatchCount = 0;

  if (options.search?.trim()) {
    const needle = options.search.trim().toLowerCase();
    const lines = text.split('\n').filter((line) => line.toLowerCase().includes(needle));
    text = lines.join('\n');
    filtersApplied.push(`search:${options.search.trim()}`);
  }

  if (options.regex?.trim()) {
    try {
      const flags = options.regexFlags?.trim() || 'gi';
      const compiled = new RegExp(options.regex.trim(), flags);
      const snippets = collectRegexSnippets(text, compiled, contextChars, maxChunks);
      regexMatchCount = snippets.count;
      text = snippets.snippets.join('\n---\n');
      filtersApplied.push(`regex:${options.regex.trim()}`);
    } catch {
      filtersApplied.push('regex:invalid');
    }
  }

  const originalLines = text.split('\n');
  const startLine = options.startLine ? clampNumber(options.startLine, 1, originalLines.length || 1) : 1;
  const endLineInput = options.endLine ? clampNumber(options.endLine, startLine, originalLines.length || startLine) : originalLines.length;
  let filteredLines = originalLines.slice(startLine - 1, endLineInput);

  if (startLine !== 1 || options.endLine !== undefined) {
    filtersApplied.push(`lines:${startLine}-${endLineInput}`);
  }

  let truncated = false;
  if (filteredLines.length > maxLines) {
    filteredLines = filteredLines.slice(0, maxLines);
    truncated = true;
    filtersApplied.push(`maxLines:${maxLines}`);
  }

  text = filteredLines.join('\n').trim();

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n…[truncated at ${maxChars} chars]`;
    truncated = true;
    filtersApplied.push(`maxChars:${maxChars}`);
  }

  return {
    text,
    chunks: splitIntoChunks(text, maxChunks),
    lineCount: filteredLines.length,
    charCount: text.length,
    filtersApplied,
    truncated,
    regexMatchCount: options.regex ? regexMatchCount : undefined,
  };
}

async function fetchUrlText(url: string, timeoutMs: number): Promise<{
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string;
  bodyText: string;
  rawHtml?: string;
}> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'ai-team-http-tool/1.0',
      },
    });

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = await response.arrayBuffer();
    const raw = Buffer.from(buffer);
    const bounded = raw.subarray(0, HTTP_MAX_TEXT_BYTES);
    const text = bounded.toString('utf8');

    const isHtml = contentType.includes('text/html');
    return {
      finalUrl: response.url || url,
      status: response.status,
      ok: response.ok,
      contentType,
      bodyText: isHtml ? stripHtmlToText(text) : text,
      rawHtml: isHtml ? text : undefined,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ============================================================================
// HTTP Tools
// ============================================================================

export const httpFetchTool: AgentTool = {
  name: 'http_fetch',
  description: 'Fetch a URL and return filtered chunks (lines, regex/search, length) for safe LLM context usage.',
  formatForLlm(result: unknown): unknown {
    const r = result as { url: string; status: number; chunks: string[]; truncated: boolean; lineCount: number; charCount: number };
    if (!r.chunks?.length) return `${r.url} (HTTP ${r.status}) — no content`;
    const header = `${r.url} (HTTP ${r.status}, ${r.lineCount} lines, ${r.charCount} chars${r.truncated ? ', truncated' : ''})`;
    return `${header}\n\n${r.chunks.join('\n\n')}`;
  },
  parameters: z.object({
    url: z.string().min(1).describe('Absolute URL to fetch').refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Expected an absolute http/https URL'),
    timeoutMs: z.number().int().min(500).max(HTTP_MAX_TIMEOUT_MS).optional().describe('Request timeout in milliseconds'),
    regex: z.string().optional().describe('Optional regex pattern to extract snippets from result text'),
    regexFlags: z.string().optional().describe('Regex flags (default: gi)'),
    search: z.string().optional().describe('Optional substring search applied before regex/line filtering'),
    startLine: z.number().int().min(1).optional().describe('1-based inclusive start line'),
    endLine: z.number().int().min(1).optional().describe('1-based inclusive end line'),
    maxLines: z.number().int().min(1).max(3000).optional().describe('Maximum number of lines returned'),
    maxChars: z.number().int().min(256).max(100000).optional().describe('Maximum characters returned'),
    maxChunks: z.number().int().min(1).max(HTTP_MAX_CHUNKS).optional().describe('Maximum chunks returned'),
    contextChars: z.number().int().min(10).max(1000).optional().describe('Context window around regex matches'),
    includeLinks: z.boolean().optional().describe('Include discovered links when response is HTML'),
  }),
  async execute(params) {
    const {
      url,
      timeoutMs = HTTP_DEFAULT_TIMEOUT_MS,
      includeLinks = true,
      ...filterOptions
    } = params as {
      url: string;
      timeoutMs?: number;
      includeLinks?: boolean;
    } & HttpFilterOptions;

    const boundedTimeout = clampNumber(timeoutMs, 500, HTTP_MAX_TIMEOUT_MS);
    const fetched = await fetchUrlText(url, boundedTimeout);
    const processed = applyHttpTextFilters(fetched.bodyText, filterOptions);
    const links = includeLinks && fetched.rawHtml
      ? extractLinksFromHtml(fetched.rawHtml, fetched.finalUrl)
      : [];

    return {
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
  },
};

export const httpCrawlTool: AgentTool = {
  name: 'http_crawl',
  description: 'Crawl links from a starting URL with depth/page limits and return filtered text chunks.',
  formatForLlm(result: unknown): unknown {
    const r = result as { url: string; crawled: boolean; visitedCount: number; chunks: string[] };
    if (!r.crawled) return `${r.url}: crawling disabled (set crawlEnabled=true)`;
    const header = `${r.url}  ${r.visitedCount} page(s) crawled`;
    if (!r.chunks?.length) return header;
    return `${header}\n\n${r.chunks.join('\n\n')}`;
  },
  parameters: z.object({
    url: z.string().min(1).describe('Start URL').refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Expected an absolute http/https URL'),
    crawlEnabled: z.boolean().optional().describe('Must be true to execute crawling (default false)'),
    maxDepth: z.number().int().min(0).max(5).optional().describe('Max crawl depth (default 1)'),
    maxPages: z.number().int().min(1).max(100).optional().describe('Max pages to fetch (default 10)'),
    timeoutMsPerPage: z.number().int().min(500).max(HTTP_MAX_TIMEOUT_MS).optional().describe('Per-page timeout'),
    allowCrossDomain: z.boolean().optional().describe('Allow crawling links across domains'),
    allowedDomains: z.array(z.string()).optional().describe('Optional explicit domain allowlist when cross-domain is enabled'),
    regex: z.string().optional().describe('Optional regex pattern to extract snippets from crawled text'),
    regexFlags: z.string().optional().describe('Regex flags (default: gi)'),
    search: z.string().optional().describe('Optional substring search applied before regex/line filtering'),
    startLine: z.number().int().min(1).optional().describe('1-based inclusive start line'),
    endLine: z.number().int().min(1).optional().describe('1-based inclusive end line'),
    maxLines: z.number().int().min(1).max(3000).optional().describe('Maximum number of lines returned'),
    maxChars: z.number().int().min(256).max(100000).optional().describe('Maximum characters returned'),
    maxChunks: z.number().int().min(1).max(HTTP_MAX_CHUNKS).optional().describe('Maximum chunks returned'),
    contextChars: z.number().int().min(10).max(1000).optional().describe('Context window around regex matches'),
  }),
  async execute(params) {
    const {
      url,
      crawlEnabled = false,
      maxDepth = 1,
      maxPages = 10,
      timeoutMsPerPage = HTTP_DEFAULT_TIMEOUT_MS,
      allowCrossDomain = false,
      allowedDomains = [],
      ...filterOptions
    } = params as {
      url: string;
      crawlEnabled?: boolean;
      maxDepth?: number;
      maxPages?: number;
      timeoutMsPerPage?: number;
      allowCrossDomain?: boolean;
      allowedDomains?: string[];
    } & HttpFilterOptions;

    if (!crawlEnabled) {
      return {
        url,
        crawled: false,
        message: 'Crawling is disabled. Set crawlEnabled=true to start crawling.',
        pages: [],
        visitedCount: 0,
        chunks: [],
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

    const cappedMaxChunks = clampNumber((filterOptions.maxChunks ?? HTTP_DEFAULT_MAX_CHUNKS), 1, HTTP_MAX_CHUNKS);
    const finalChunks = crawlResult.allChunks.slice(0, cappedMaxChunks);

    return {
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
    };
  },
};

// ============================================================================
// HTTP Crawl Internals
// ============================================================================

async function runHttpCrawl(
  rootUrl: string,
  options: {
    maxDepth: number;
    maxPages: number;
    timeoutMsPerPage: number;
    allowCrossDomain: boolean;
    allowedDomains: string[];
    filterOptions: HttpFilterOptions;
  },
): Promise<{
  visitedCount: number;
  pages: Array<{
    url: string;
    status?: number;
    ok?: boolean;
    contentType?: string;
    error?: string;
    chunkCount: number;
    linkCount: number;
  }>;
  allChunks: string[];
}> {
  const start = new URL(rootUrl);
  const allowedHosts = new Set(
    [start.hostname, ...options.allowedDomains.map((d) => d.trim()).filter(Boolean)]
      .map((domain) => domain.toLowerCase()),
  );

  const queue: Array<{ href: string; depth: number }> = [{ href: start.toString(), depth: 0 }];
  const visited = new Set<string>();
  const pages: Array<{
    url: string;
    status?: number;
    ok?: boolean;
    contentType?: string;
    error?: string;
    chunkCount: number;
    linkCount: number;
  }> = [];
  const allChunks: string[] = [];

  while (queue.length > 0 && visited.size < options.maxPages) {
    const current = queue.shift()!;
    if (visited.has(current.href)) continue;
    visited.add(current.href);

    const crawled = await crawlSingleHttpPage(current.href, options.timeoutMsPerPage, options.filterOptions);
    pages.push(crawled.page);
    allChunks.push(...crawled.pageChunks);

    if (!crawled.links || current.depth >= options.maxDepth) continue;
    enqueueCrawlLinks(queue, visited, crawled.links, current.depth + 1, {
      rootHost: start.hostname.toLowerCase(),
      allowCrossDomain: options.allowCrossDomain,
      allowedHosts,
      maxPages: options.maxPages,
    });
  }

  return {
    visitedCount: visited.size,
    pages,
    allChunks,
  };
}

async function crawlSingleHttpPage(
  href: string,
  timeoutMsPerPage: number,
  filterOptions: HttpFilterOptions,
): Promise<{
  page: {
    url: string;
    status?: number;
    ok?: boolean;
    contentType?: string;
    error?: string;
    chunkCount: number;
    linkCount: number;
  };
  pageChunks: string[];
  links?: string[];
}> {
  try {
    const fetched = await fetchUrlText(href, clampNumber(timeoutMsPerPage, 500, HTTP_MAX_TIMEOUT_MS));
    const prepared = applyHttpTextFilters(fetched.bodyText, filterOptions);
    const pageChunks = prepared.chunks.slice(0, HTTP_DEFAULT_MAX_CHUNKS);
    const links = fetched.rawHtml ? extractLinksFromHtml(fetched.rawHtml, fetched.finalUrl) : [];
    return {
      page: {
        url: fetched.finalUrl,
        status: fetched.status,
        ok: fetched.ok,
        contentType: fetched.contentType,
        chunkCount: pageChunks.length,
        linkCount: links.length,
      },
      pageChunks,
      links,
    };
  } catch (error) {
    return {
      page: {
        url: href,
        error: error instanceof Error ? error.message : String(error),
        chunkCount: 0,
        linkCount: 0,
      },
      pageChunks: [],
    };
  }
}

function enqueueCrawlLinks(
  queue: Array<{ href: string; depth: number }>,
  visited: Set<string>,
  links: string[],
  nextDepth: number,
  options: {
    rootHost: string;
    allowCrossDomain: boolean;
    allowedHosts: Set<string>;
    maxPages: number;
  },
): void {
  for (const link of links) {
    if (visited.has(link)) continue;

    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      continue;
    }

    const host = parsed.hostname.toLowerCase();
    const sameDomain = host === options.rootHost;
    if (!sameDomain && !options.allowCrossDomain) continue;
    if (!sameDomain && options.allowCrossDomain && !options.allowedHosts.has(host)) continue;

    queue.push({ href: parsed.toString(), depth: nextDepth });
    if ((visited.size + queue.length) >= options.maxPages) break;
  }
}
