import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextLevel, type Agent, type ICommand } from '@ai-team/core';
import { ToolManager } from '../../tools/tool-manager.js';
import {
  FsReadFileTool,
  FsReadLinesTool,
  FsWriteFileTool,
  FsCreateFileTool,
  FsDeletePathTool,
  FsMkdirTool,
  FsExistsTool,
  FsInfoTool,
  FsListTool,
  FsTreeTool,
  FsSearchContentTool,
  FsSearchMetadataTool,
} from '../fs/fs-tools.js';
import { FindSymbolTool, FindReferencesTool, LspTool, GrepCodeTool } from '../edit/code-tools.js';
import { HttpFetchCommand } from './http-fetch.command.js';
import { HttpCrawlCommand } from './http-crawl.command.js';
import { CodeSearchTool } from '../edit/codesearch-tool.js';
import { ApplyPatchTool, MultiEditTool, FsEditTool } from '../fs/edit-tools.js';
import { WhoHasAccessTool } from '../fs/who-has-access.tool.js';
import { DoIHaveAccessTool } from '../fs/do-i-have-access.tool.js';
import { AnalyzePermissionOverlapTool } from '../fs/analyze-permission-overlap.tool.js';
import { WorkspaceFs } from 'fs-context';

function getBuiltInTools(workspaceRoot: string): ICommand[] {
  const accessChecker = {
    can: () => true,
    canReadPath: () => true,
    canWritePath: () => true,
    canListPath: () => true,
    assertCanReadPath: () => undefined,
    assertCanWritePath: () => undefined,
  };
  const accessAgentManager = {
    async getAllAgentsAsync() {
      return [] as Agent[];
    },
    async getAgentAsync() {
      return undefined;
    },
    async analyzeWorkspacePermissionOverlap() {
      return { overlaps: [] };
    },
  } as any;
  const whoHasAccessTool = new WhoHasAccessTool(workspaceRoot, accessAgentManager, accessChecker);
  const doIHaveAccessTool = new DoIHaveAccessTool(workspaceRoot, accessAgentManager, accessChecker);
  const analyzePermissionOverlapTool = new AnalyzePermissionOverlapTool(accessAgentManager);
  const workspaceFsFactory = {
    create: async (agentId: string) =>
      new WorkspaceFs(workspaceRoot, agentId, {
        canRead: () => true,
        canWrite: () => true,
        canList: () => true,
      }),
  };
  const ideAdapterFactory = {
    createAsync: async () => ({
      lsp: {
        execute: async () => ({ kind: 'locations', locations: [] }),
        isAvailable: () => false,
      },
      openFile: async () => {},
      notifyCodeEditProposal: async () => {},
      isConnected: () => false,
      onAck: () => {},
      dispose: () => {},
    }),
  } as any;
  const readFileTool = new FsReadFileTool(workspaceRoot, workspaceFsFactory as any);
  const readLinesTool = new FsReadLinesTool(readFileTool);
  const fsEditTool = new FsEditTool(workspaceRoot, accessChecker as any, ideAdapterFactory);
  return [
    readFileTool,
    readLinesTool,
    new FsWriteFileTool(workspaceFsFactory as any),
    new FsCreateFileTool(workspaceFsFactory as any),
    new FsDeletePathTool(workspaceFsFactory as any),
    new FsMkdirTool(workspaceFsFactory as any),
    new FsExistsTool(workspaceFsFactory as any),
    new FsInfoTool(workspaceFsFactory as any),
    new FsListTool(workspaceFsFactory as any),
    new FsTreeTool(workspaceFsFactory as any),
    new FsSearchContentTool(workspaceRoot, workspaceFsFactory as any),
    new FsSearchMetadataTool(workspaceRoot, workspaceFsFactory as any),
    whoHasAccessTool,
    doIHaveAccessTool,
    analyzePermissionOverlapTool,
    new FindSymbolTool(workspaceRoot, ideAdapterFactory),
    new FindReferencesTool(workspaceRoot, ideAdapterFactory),
    new LspTool(workspaceRoot, ideAdapterFactory),
    new GrepCodeTool(),
    new HttpFetchCommand(),
    new HttpCrawlCommand(),
    new CodeSearchTool(),
    fsEditTool,
    new ApplyPatchTool(workspaceRoot, accessChecker as any, ideAdapterFactory),
    new MultiEditTool(workspaceRoot, fsEditTool, accessChecker as any, ideAdapterFactory),
  ];
}

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

describe('http commands', () => {
  it('http_fetch supports regex/snippet filtering and returns links', async () => {
    const workspaceRoot = await createWorkspace();
    const agent = makeAgent();
    const registry = {
      register: () => undefined,
      get: () => undefined,
      getAll: () => [],
      toLlmToolDefinitions: () => [],
    } as any;
    const manager = new ToolManager(
      {
        canReadPath: () => true,
        canWritePath: () => true,
        canListPath: () => true,
        assertCanReadPath: () => undefined,
        assertCanWritePath: () => undefined,
      },
      registry,
      { resolve: () => undefined } as any
    );
    for (const tool of getBuiltInTools(workspaceRoot)) manager.register(tool);

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
        { workspaceRoot, history: [] }
      );

      expect(result.ok).toBe(true);
      const payload = (result.result as any)?.data ?? result.result;
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
    const registry = {
      register: () => undefined,
      get: () => undefined,
      getAll: () => [],
      toLlmToolDefinitions: () => [],
    } as any;
    const manager = new ToolManager(
      {
        canReadPath: () => true,
        canWritePath: () => true,
        canListPath: () => true,
        assertCanReadPath: () => undefined,
        assertCanWritePath: () => undefined,
      },
      registry,
      { resolve: () => undefined } as any
    );
    for (const tool of getBuiltInTools(workspaceRoot)) manager.register(tool);

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
        { workspaceRoot, history: [] }
      );

      expect(result.ok).toBe(true);
      const payload = (result.result as any)?.data ?? result.result;
      expect(payload.crawled).toBe(true);
      expect(payload.pageCount).toBeLessThanOrEqual(2);
      expect(payload.visitedCount).toBeLessThanOrEqual(2);
    } finally {
      await srv.close();
    }
  });
});
