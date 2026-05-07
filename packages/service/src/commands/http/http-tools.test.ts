import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextLevel, type Agent } from '@ai-team/core';
import { ToolManager } from '../../tools/tool-manager.js';
import { ALL_TOOLS } from '../../tools/catalog/index.js';

const workspaces: string[] = [];

function makeAgent(): Agent {
  return {
    id: 'http-tool-tester',
    name: 'HTTP Tool Tester',
    role: 'developer',
    contextLevel: ContextLevel.MODULE,
    filePath: '.ai-team/agents/http-tool-tester.agent.yml',
    skillPath: '.ai-team/agents/http-tool-tester',
    createdAt: new Date().toISOString(),
    permissions: { read: ['**'], write: [] },
    tools: ['http_fetch', 'http_crawl'],
  };
}

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-http-tools-'));
  workspaces.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0, workspaces.length)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

function withTestServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  const closeServer = (server: http.Server): Promise<void> =>
    new Promise<void>((done, fail) => {
      server.close((err) => (err ? fail(err) : done()));
    });

  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve test server address'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: async () => closeServer(server),
      });
    });
  });
}

describe('http tools', () => {
  it('http_fetch supports regex/snippet filtering and returns links', async () => {
    const workspaceRoot = await createWorkspace();
    const agent = makeAgent();
    const manager = new ToolManager(workspaceRoot);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const srv = await withTestServer((req, res) => {
      if (req.url === '/article') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body><h1>Alpha keyword line</h1><a href="/next">next</a><p>Other text</p></body></html>'
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ok');
    });

    try {
      const result = await manager.execute(
        agent,
        'http_fetch',
        {
          url: `${srv.baseUrl}/article`,
          regex: 'keyword',
          maxChunks: 3,
          contextChars: 20,
        },
        { workspaceRoot }
      );

      expect(result.ok).toBe(true);
      const payload = result.result as any;
      expect(payload.linkCount).toBe(1);
      expect(Array.isArray(payload.chunks)).toBe(true);
      expect(payload.chunks.join('\n').toLowerCase()).toContain('keyword');
    } finally {
      await srv.close();
    }
  });

  it('http_crawl respects maxDepth and maxPages constraints', async () => {
    const workspaceRoot = await createWorkspace();
    const agent = makeAgent();
    const manager = new ToolManager(workspaceRoot);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const srv = await withTestServer((req, res) => {
      if (req.url === '/root') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<a href="/a">A</a><a href="/b">B</a>');
        return;
      }
      if (req.url === '/a') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<a href="/deep">Deep</a> content A');
        return;
      }
      if (req.url === '/b') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('content B');
        return;
      }
      if (req.url === '/deep') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('deep content');
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    });

    try {
      const result = await manager.execute(
        agent,
        'http_crawl',
        {
          url: `${srv.baseUrl}/root`,
          crawlEnabled: true,
          maxDepth: 1,
          maxPages: 2,
          maxChunks: 5,
        },
        { workspaceRoot }
      );

      expect(result.ok).toBe(true);
      const payload = result.result as any;
      expect(payload.crawled).toBe(true);
      expect(payload.pageCount).toBeLessThanOrEqual(2);
      expect(payload.visitedCount).toBeLessThanOrEqual(2);
    } finally {
      await srv.close();
    }
  });
});
