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
  it('returns only readable files with matching content lines', async () => {
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
      } as any,
      {
        findSimilar: () => [],
        findSimilarRanked: () => [],
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
      ])
    );
    expect(response.data.results).toHaveLength(1);

    const rendered = tool.formatForLlm(response.data);
    expect(rendered).toContain('Search: "workflow" (content; scope: agent-permissions)');
    expect(rendered).toContain('src/workflow.ts:1: const workflow = true;');
    expect(rendered).toContain('src/workflow.ts:2: return workflow;');
    expect(rendered).not.toContain('docs/workflow.md');
    expect(rendered).not.toContain('intent:');
    expect(rendered).not.toContain('"results"');
  });

  it('clips very long matching lines in compact content output', async () => {
    const tool = new FsSearchTool(
      '',
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const longLine = `${'a'.repeat(500)}ChatOrchestrator${'b'.repeat(500)}`;

    const rendered = tool.formatForLlm({
      query: 'ChatOrchestrator',
      mode: 'content',
      scope: 'agent-permissions',
      totalMatches: 1,
      returnedMatches: 1,
      contentHitsKnown: 1,
      truncated: false,
      results: [{
        path: 'src/chat.ts',
        score: 1,
        matchedBy: ['content'],
        readable: true,
        writable: false,
        contentSearched: true,
        snippets: [{ line: 42, content: longLine }],
      }],
    });

    expect(rendered).toContain('src/chat.ts:42: …');
    expect(rendered).toContain('ChatOrchestrator');
    expect(rendered.length).toBeLessThan(500);
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
      { canReadPath: () => false, canWritePath: () => false } as any,
      {
        findSimilar: () => [],
        findSimilarRanked: () => [],
      } as any
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

  it('fuzzy fallback respects glob-scoped candidates and labels fuzzy output', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-search-fuzzy-glob-'));
    workspaces.push(workspace);
    await fs.mkdir(path.join(workspace, 'packages', 'service'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'packages', 'web'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'packages', 'service', 'workflow.ts'), 'export const serviceWorkflow = true;');
    await fs.writeFile(path.join(workspace, 'packages', 'web', 'workflow.tsx'), 'export const webWorkflow = true;');

    const tool = new FsSearchTool(
      workspace,
      {
        create: async () => ({
          canList: () => true,
          canRead: () => true,
          canWrite: () => false,
        }),
      } as any,
      { getAllAgentsAsync: async () => [] } as any,
      { canReadPath: () => true, canWritePath: () => false } as any,
      {
        findSimilar: () => [],
        findSimilarRanked: (_query: string, _permissions: unknown, allFiles: string[]) =>
          allFiles.map((filePath, index) => ({ path: filePath, score: 1 - index * 0.1 })),
      } as any
    );

    const response = await tool.execute(
      { query: 'wrkflw', mode: 'names', glob: 'packages/service/**', maxResults: 10 },
      { agent: { id: 'alex', permissions: { read: ['**'], write: [], list: ['**'] } } } as any
    );

    expect(response.status).toBe('ok');
    expect(response.data.totalMatches).toBe(1);
    expect(response.data.truncated).toBe(false);
    expect(response.data.results).toEqual([
      expect.objectContaining({
        path: 'packages/service/workflow.ts',
        matchedBy: ['fuzzy'],
      }),
    ]);

    const rendered = tool.formatForLlm(response.data);
    expect(rendered).toContain('(includes fuzzy-matched results)');
    expect(rendered).toContain('[fuzzy]');
  });

  it('does not trigger fuzzy fallback in content mode', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-search-fuzzy-content-'));
    workspaces.push(workspace);
    await fs.writeFile(path.join(workspace, 'workflow.ts'), 'export const value = true;');

    let fuzzyCalls = 0;
    const tool = new FsSearchTool(
      workspace,
      {
        create: async () => ({
          canList: () => true,
          canRead: () => true,
          canWrite: () => false,
        }),
      } as any,
      { getAllAgentsAsync: async () => [] } as any,
      { canReadPath: () => true, canWritePath: () => false } as any,
      {
        findSimilar: () => [],
        findSimilarRanked: () => {
          fuzzyCalls += 1;
          return [{ path: 'workflow.ts', score: 0.75 }];
        },
      } as any
    );

    const response = await tool.execute(
      { query: 'wrkflw', mode: 'content', maxResults: 10 },
      { agent: { id: 'alex', permissions: { read: ['**'], write: [], list: ['**'] } } } as any
    );

    expect(fuzzyCalls).toBe(0);
    expect(response.status).toBe('ok');
    expect(response.data.totalMatches).toBe(0);
    expect(response.data.results).toEqual([]);
  });

  it('fuzzy fallback keeps listability boundaries even when readability is broad', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-search-fuzzy-listable-'));
    workspaces.push(workspace);
    await fs.mkdir(path.join(workspace, 'listable'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'hidden'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'listable', 'workflow.ts'), 'export const a = 1;');
    await fs.writeFile(path.join(workspace, 'hidden', 'workflow.ts'), 'export const b = 2;');

    const tool = new FsSearchTool(
      workspace,
      {
        create: async () => ({
          canList: (filePath: string) => filePath.startsWith('listable/'),
          canRead: () => true,
          canWrite: () => false,
        }),
      } as any,
      { getAllAgentsAsync: async () => [] } as any,
      { canReadPath: () => true, canWritePath: () => false } as any,
      {
        findSimilar: () => [],
        findSimilarRanked: (_query: string, _permissions: unknown, allFiles: string[]) =>
          allFiles.map((filePath) => ({ path: filePath, score: 0.8 })),
      } as any
    );

    const response = await tool.execute(
      { query: 'wrkflw', mode: 'names', maxResults: 10 },
      { agent: { id: 'alex', permissions: { read: ['**'], write: [], list: ['**'] } } } as any
    );

    expect(response.status).toBe('ok');
    expect(response.data.results).toHaveLength(1);
    expect(response.data.results[0]?.path).toBe('listable/workflow.ts');
  });
});
