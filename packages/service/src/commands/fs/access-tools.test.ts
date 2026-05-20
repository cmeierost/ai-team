import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextLevel, type Agent, type ICommand } from '@ai-team/core';
import { WorkspaceFs } from 'fs-context';
import { ToolManager } from '../../tools/tool-manager.js';
import {
  WhoHasAccessTool,
  DoIHaveAccessTool,
  AnalyzePermissionOverlapTool,
} from '../fs/access-introspection-tools.js';
import {
  FsExistsTool,
  FsInfoTool,
  FsReadFileTool,
  FsReadLinesTool,
  FsWriteFileTool,
  FsCreateFileTool,
  FsDeletePathTool,
  FsMkdirTool,
  FsListTool,
  FsTreeTool,
  FsSearchContentTool,
  FsSearchMetadataTool,
} from '../fs/fs-tools.js';
import { FindSymbolTool, FindReferencesTool, LspTool, GrepCodeTool } from '../edit/code-tools.js';
import { HttpFetchCommand } from '../http/http-fetch.command.js';
import { HttpCrawlCommand } from '../http/http-crawl.command.js';
import { CodeSearchTool } from '../edit/codesearch-tool.js';
import { ApplyPatchTool, MultiEditTool, FsEditTool } from '../fs/edit-tools.js';

function getBuiltInTools(
  workspaceRoot: string,
  agents: Agent[],
  analyzeResult?: unknown
): unknown[] {
  const accessChecker = {
    can: () => true,
    canReadPath: () => true,
    canWritePath: () => true,
    canListPath: () => true,
    assertCanReadPath: () => undefined,
    assertCanWritePath: () => undefined,
  };
  const accessAgentManager = makeAgentManager(agents, analyzeResult) as any;
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

function makeAgent(id: string, readPatterns: string[] = ['**']): Agent {
  return {
    id,
    name: id,
    role: 'developer',
    contextLevel: ContextLevel.MODULE,
    filePath: `.ai-team/agents/${id}.agent.yml`,
    skillPath: `.ai-team/agents/${id}`,
    createdAt: new Date().toISOString(),
    permissions: {
      read: readPatterns,
      write: [],
    },
    tools: ['access_who_can', 'access_can_i', 'access_analyze_permission_overlap'],
  };
}

async function setupManager(
  workspaceRoot: string,
  agents: Agent[],
  analyzeResult?: unknown
): Promise<ToolManager> {
  const registry = {
    register: () => undefined,
    get: () => undefined,
    getAll: () => [],
    toLlmToolDefinitions: () => [],
  } as any;
  const manager = new ToolManager(
    workspaceRoot,
    {
      can: () => true,
      canReadPath: () => true,
      canWritePath: () => true,
      canListPath: () => true,
      assertCanReadPath: () => undefined,
      assertCanWritePath: () => undefined,
    },
    registry,
    { resolve: () => undefined } as any
  );
  for (const tool of getBuiltInTools(workspaceRoot, agents, analyzeResult))
    manager.register(tool as ICommand);
  return manager;
}

function makeAgentManager(agents: Agent[], analyzeResult?: unknown) {
  return {
    async resolveAgentForOperationAsync(id: string) {
      return { id };
    },
    async getAllAgentsAsync() {
      return agents;
    },
    async getAgentAsync(id: string) {
      return agents.find((agent) => agent.id === id);
    },
    async analyzeWorkspacePermissionOverlap() {
      if (analyzeResult === undefined) {
        throw new Error('No overlap analysis result configured for test.');
      }
      return analyzeResult;
    },
  };
}

function toolPayload(result: { result?: unknown }) {
  return (result.result as any)?.data ?? result.result;
}

describe('access introspection tools', () => {
  it('fs_who_can defaults to list right', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'agents'), { recursive: true });
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'a.agent.md'),
        '---\nid: a\nname: a\nrole: developer\ncontextLevel: module\npermissions:\n  read: ["src/**"]\n  write: []\ntools:\n  - who_can\n  - can_i\n  - analyze_permission_overlap\n---\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'b.agent.md'),
        '---\nid: b\nname: b\nrole: developer\ncontextLevel: module\npermissions:\n  read: ["docs/**"]\n  write: []\ntools:\n  - who_can\n  - can_i\n  - analyze_permission_overlap\n---\n',
        'utf8'
      );

      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['docs/**']);
      const manager = await setupManager(workspaceRoot, [a, b]);

      const result = await manager.execute(
        a,
        'access_who_can',
        { path: 'src/file.ts' },
        {
          workspaceRoot,
          history: [],
        }
      );
      expect(result.ok).toBe(true);
      const payload = toolPayload(result);
      expect(payload.right).toBe('list');
      expect(payload.contextIds).toContain('a');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('tool_can_i supports agent override', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'agents'), { recursive: true });
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'a.agent.md'),
        '---\nid: a\nname: a\nrole: developer\ncontextLevel: module\npermissions:\n  read: ["src/**"]\n  write: []\ntools:\n  - who_can\n  - can_i\n---\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'b.agent.md'),
        '---\nid: b\nname: b\nrole: developer\ncontextLevel: module\npermissions:\n  read: ["docs/**"]\n  write: []\ntools:\n  - who_can\n  - can_i\n---\n',
        'utf8'
      );

      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['docs/**']);
      const manager = await setupManager(workspaceRoot, [a, b]);

      const denied = await manager.execute(
        a,
        'access_can_i',
        { path: 'docs/readme.md', right: 'read' },
        { workspaceRoot, history: [] }
      );
      expect(denied.ok).toBe(true);
      expect(toolPayload(denied).allowed).toBe(true);

      const allowed = await manager.execute(
        a,
        'access_can_i',
        { path: 'docs/readme.md', right: 'read', agentId: 'b' },
        { workspaceRoot, history: [] }
      );
      expect(allowed.ok).toBe(true);
      expect(toolPayload(allowed).allowed).toBe(true);
      expect(toolPayload(allowed).contextId).toBe('b');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('analyze_permission_overlap returns file-based ownership data', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'agents'), { recursive: true });
      await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'a.agent.md'),
        '---\nid: a\nname: Agent A\nrole: developer\ncontextLevel: module\ntools:\n  - analyze_permission_overlap\n---\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'b.agent.md'),
        '---\nid: b\nname: Agent B\nrole: developer\ncontextLevel: module\ntools:\n  - analyze_permission_overlap\n---\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'a.perm'),
        '[write]\nsrc/**/*.ts\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'b.perm'),
        '[write]\nsrc/shared.ts\n',
        'utf8'
      );
      await fs.writeFile(path.join(workspaceRoot, 'src', 'shared.ts'), 'one\ntwo\n', 'utf8');
      await fs.writeFile(path.join(workspaceRoot, 'src', 'solo.ts'), 'solo\n', 'utf8');

      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['src/**']);
      const manager = await setupManager(workspaceRoot, [a, b], {
        kind: 'files',
        agentFocus: { agentId: 'a' },
        rights: {
          write: {
            overlappingFiles: [{ path: 'src/shared.ts' }],
          },
        },
      });

      const result = await manager.execute(
        a,
        'access_analyze_permission_overlap',
        { mode: 'files', agentId: 'a' },
        { workspaceRoot, history: [] }
      );
      expect(result.ok).toBe(true);
      expect(toolPayload(result).kind).toBe('files');
      expect(toolPayload(result).agentFocus.agentId).toBe('a');
      expect(
        toolPayload(result).rights.write.overlappingFiles.some(
          (file: { path: string }) => file.path === 'src/shared.ts'
        )
      ).toBe(true);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
