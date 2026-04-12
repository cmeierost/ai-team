import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { codeSearchTool } from './codesearch-tool.js';
import type { ToolContext } from '@ai-team/core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal ToolContext stub. */
function stubContext(): ToolContext {
  return {
    workspaceRoot: '/tmp/test-workspace',
    agentName: 'test-agent',
  } as unknown as ToolContext;
}

/** Build an SSE body that Exa would return. */
function sseBody(text: string): string {
  return [
    'event: message',
    `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } })}`,
    '',
  ].join('\n');
}

/** Build a Response-like object for stubbing global fetch. */
function fakeResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('codeSearchTool', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(codeSearchTool.name).toBe('codesearch');
    expect(codeSearchTool.permissionCheck).toEqual({ type: 'none' });
  });

  it('returns result text on successful SSE response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(fakeResponse(sseBody('Hello from Exa')));
    vi.stubGlobal('fetch', mockFetch);

    const result = await codeSearchTool.execute(
      { query: 'zod validation', tokensNum: 5000 },
      stubContext()
    );

    expect(result).toEqual({
      query: 'zod validation',
      tokensNum: 5000,
      result: 'Hello from Exa',
    });

    // Verify fetch was called with correct URL and JSON-RPC body
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://mcp.exa.ai/mcp');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('get_code_context_exa');
    expect(body.params.arguments).toEqual({ query: 'zod validation', tokensNum: 5000 });
  });

  it('returns error on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse('rate limited', 429)));

    const result = (await codeSearchTool.execute(
      { query: 'test', tokensNum: 5000 },
      stubContext()
    )) as { error: string };

    expect(result.result).toBeNull();
    expect(result.error).toContain('429');
    expect(result.error).toContain('rate limited');
  });

  it('returns friendly message when SSE has no result content', async () => {
    const emptySse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(emptySse)));

    const result = (await codeSearchTool.execute(
      { query: 'nonexistent-library-xyzzy', tokensNum: 1000 },
      stubContext()
    )) as { error: string };

    expect(result.result).toBeNull();
    expect(result.error).toContain('No code snippets');
  });

  it('returns timeout error when fetch is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      })
    );

    const result = (await codeSearchTool.execute(
      { query: 'slow query', tokensNum: 5000 },
      stubContext()
    )) as { error: string };

    expect(result.result).toBeNull();
    expect(result.error).toContain('timed out');
  });

  it('respects AI_TEAM_EXA_URL env override', async () => {
    process.env.AI_TEAM_EXA_URL = 'https://custom-exa.example.com';
    const mockFetch = vi.fn().mockResolvedValue(fakeResponse(sseBody('custom result')));
    vi.stubGlobal('fetch', mockFetch);

    await codeSearchTool.execute({ query: 'test', tokensNum: 2000 }, stubContext());

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://custom-exa.example.com/mcp');
  });

  it('returns generic error on unexpected fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unreachable')));

    const result = (await codeSearchTool.execute(
      { query: 'test', tokensNum: 5000 },
      stubContext()
    )) as { error: string };

    expect(result.result).toBeNull();
    expect(result.error).toBe('Network unreachable');
  });

  it('parses SSE with multiple data lines and picks first valid result', async () => {
    const multiLine = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{}}',
      'event: message',
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'second line wins' }] } })}`,
      '',
    ].join('\n');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(multiLine)));

    const result = (await codeSearchTool.execute(
      { query: 'multi', tokensNum: 3000 },
      stubContext()
    )) as { result: string };

    expect(result.result).toBe('second line wins');
  });
});
