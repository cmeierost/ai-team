import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { WorkspaceFs, canRead, canWrite } from 'fs-context';
import { ContextLevel, type Agent, type PermissionConfig, type ICommand } from '@ai-team/core';
import { CORE_SERVICE_TOKENS } from '../../../types.js';
import { CommandRegistry } from '../../../command-dispatcher/command-registry.js';
import { ToolManager } from '../../../tooling/manager/tool-manager.js';
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
} from '../fs-tools.js';

const workspaces: string[] = [];

function normalizeRelativePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '').toLowerCase();
}

function addAncestorDirectories(target: Set<string>, filePath: string): void {
  let current = normalizeRelativePath(filePath);
  while (current.includes('/')) {
    current = current.slice(0, current.lastIndexOf('/'));
    target.add(current);
  }
  target.add('');
}

async function collectWorkspaceFiles(root: string, subdir = ''): Promise<string[]> {
  const absoluteDir = subdir ? path.join(root, subdir) : root;
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = normalizeRelativePath(subdir ? `${subdir}/${entry.name}` : entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectWorkspaceFiles(root, relativePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function createTestWorkspaceFs(
  root: string,
  agentId: string,
  permissions: PermissionConfig | undefined
): Promise<WorkspaceFs> {
  const patterns = {
    read: permissions?.read ?? [],
    write: permissions?.write ?? [],
    list: [],
  };

  const workspaceFiles = await collectWorkspaceFiles(root);
  const listablePaths = new Set<string>();

  for (const filePath of workspaceFiles) {
    if (canRead(filePath, patterns) || canWrite(filePath, patterns)) {
      listablePaths.add(filePath);
      addAncestorDirectories(listablePaths, filePath);
    }
  }

  return new WorkspaceFs(root, agentId, {
    canRead: (_contextId, filePath) => canRead(normalizeRelativePath(filePath), patterns),
    canWrite: (_contextId, filePath) => canWrite(normalizeRelativePath(filePath), patterns),
    canList: (_contextId, filePath) => listablePaths.has(normalizeRelativePath(filePath)),
  });
}

function getFsTools(workspaceRoot: string): ICommand[] {
  const workspaceFsFactory = {
    create: (agentId: string, permissions: PermissionConfig | undefined) =>
      createTestWorkspaceFs(workspaceRoot, agentId, permissions),
  };

  return [
    new FsReadFileTool(workspaceRoot, workspaceFsFactory as any),
    new FsReadLinesTool(new FsReadFileTool(workspaceRoot, workspaceFsFactory as any)),
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
  ];
}

function perms(p: {
  read?: string[];
  write?: string[];
  manage_agents?: boolean;
}): PermissionConfig {
  return {
    read: p.read ?? [],
    write: p.write ?? [],
    manage_agents: p.manage_agents,
  };
}

export function makeAgent(id: string, readPatterns: string[]): Agent {
  return {
    id,
    name: `Agent ${id}`,
    role: 'developer',
    contextLevel: ContextLevel.MODULE,
    filePath: `.ai-team/agents/${id}.agent.yml`,
    skillPath: `.ai-team/agents/${id}`,
    createdAt: new Date().toISOString(),
    permissions: perms({ read: readPatterns }),
    tools: ['fs_exists', 'fs_info'],
  };
}

export function makeSearchAgent(id: string, readPatterns: string[]): Agent {
  return {
    ...makeAgent(id, readPatterns),
    tools: ['fs_search_content', 'fs_search_metadata'],
  };
}

export function makeTreeAgent(id: string, readPatterns: string[]): Agent {
  return {
    ...makeAgent(id, readPatterns),
    tools: ['fs_tree', 'fs_list'],
  };
}

export function makeFullFsAgent(id: string): Agent {
  return {
    ...makeAgent(id, ['**']),
    permissions: perms({ read: ['**'], write: ['**'] }),
    tools: [
      'fs_read',
      'fs_read_lines',
      'fs_write_file',
      'fs_create',
      'fs_delete_path',
      'fs_mkdir',
      'fs_list',
    ],
  };
}

export async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-fs-tools-'));
  workspaces.push(dir);
  return dir;
}

export async function setupManager(workspaceRoot: string): Promise<ToolManager> {
  const registry = new CommandRegistry();

  const container = {
    resolve: (token: { id?: string }) => {
      if (token?.id !== CORE_SERVICE_TOKENS.WorkspaceFsFactory.id) {
        throw new Error(`Unexpected token requested in fs tool harness: ${String(token?.id)}`);
      }

      return {
        create: async (agentId: string, permissions: PermissionConfig | undefined) =>
          createTestWorkspaceFs(workspaceRoot, agentId, permissions),
      };
    },
  } as any;

  for (const tool of getFsTools(workspaceRoot)) {
    const instance = tool;
    registry.register(instance.metadata, () => instance);
  }

  return new ToolManager(
    {
      can: vi.fn().mockReturnValue(true),
      canReadPath: vi.fn().mockReturnValue(true),
      canWritePath: vi.fn().mockReturnValue(true),
      canListPath: vi.fn().mockReturnValue(true),
      assertCanReadPath: vi.fn(),
      assertCanWritePath: vi.fn(),
    },
    registry,
    container
  );
}

export function ctx(agent: Agent, ws: string) {
  return { agentId: agent.id, workspaceRoot: ws, history: [] };
}

export function toolPayload(result: { result?: unknown }) {
  return (result.result as any)?.data ?? result.result;
}

export async function cleanupWorkspaces(): Promise<void> {
  await Promise.all(
    workspaces
      .splice(0, workspaces.length)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
}
