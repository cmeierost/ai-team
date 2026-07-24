import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsSearchTool } from './fs-search.tool.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true })));
});

describe('fs_search', () => {
  it('returns listable unreadable files with delegation hints and readable content lines', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-search-'));
    workspaces.push(workspace);
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'workflow.ts'), 'const workflow = true;\nreturn workflow;\n');
    await fs.writeFile(path.join(workspace, 'docs', 'workflow.md'), 'workflow return design');

    const tool = new FsSearchTool(
      workspace,
      {
        create: async () => ({
          canList: () => true,
          canRead: (filePath: string) => filePath.startsWith('src/'),
          canWrite: (filePath: string) => filePath.startsWith('src/'),
        }),
      } as any,
      {
        getAllAgentsAsync: async () => [
          { id: 'sarah-lee', name: 'Sarah Lee', permissions: { read: ['docs/**'], write: [] } },
        ],
      } as any,
      {
        canReadPath: (_permissions: unknown, filePath: string) => filePath.startsWith('docs/'),
        canWritePath: () => false,
      } as any
    );

    const response = await tool.execute(
      { query: 'workflow', mode: 'content', maxResults: 10 },
      { agent: { id: 'alex', permissions: { read: ['src/**'], write: ['src/**'] } } } as any
    );

    expect(response.status).toBe('ok');
    expect(response.data.contentHitsKnown).toBe(2);
    expect(response.data.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/workflow.ts',
          readable: true,
          writable: true,
          lines: [1, 2],
          contentSearched: true,
        }),
        expect.objectContaining({
          path: 'docs/workflow.md',
          readable: false,
          writable: false,
          contentSearched: false,
          readers: [{ contextId: 'sarah-lee', label: 'Sarah Lee' }],
        }),
      ])
    );

    const rendered = tool.formatForLlm(response.data);
    expect(rendered).toContain('Search: "workflow" (content; scope: agent-permissions)');
    expect(rendered).toContain('src/');
    expect(rendered).toContain('intent: name+content; access RW');
    expect(rendered).toContain('delegate reading to: Sarah Lee');
    expect(rendered).not.toContain('"results"');
  });

  it('allows a human slash search to span the workspace without agent read restrictions', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-search-slash-'));
    workspaces.push(workspace);
    await fs.writeFile(path.join(workspace, 'private.txt'), 'secret workflow');
    let createdPermissions: any;
    const tool = new FsSearchTool(
      workspace,
      {
        create: async (_agentId: string, permissions: any) => {
          createdPermissions = permissions;
          return { canList: () => true, canRead: () => true, canWrite: () => false };
        },
      } as any,
      { getAllAgentsAsync: async () => [] } as any,
      { canReadPath: () => false, canWritePath: () => false } as any
    );

    const response = await tool.execute(
      { query: 'secret', mode: 'content' },
      { invocationSurface: 'slash', agent: { id: 'alex', permissions: { read: [], write: [], list: [] } } } as any
    );

    expect(createdPermissions.read).toEqual(['**']);
    expect(createdPermissions.list).toEqual(['**']);
    expect(response.data.scope).toBe('workspace');
    expect(response.data.results[0]?.path).toBe('private.txt');
  });
});
