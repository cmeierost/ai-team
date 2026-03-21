import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextLevel, type Agent, type PermissionConfig } from '../types/index.js';
import { createAccessEngine } from '../context/access-adapter.js';
import { ToolManager } from './tool-manager.js';
import { ALL_TOOLS } from './index.js';

const workspaces: string[] = [];

function perms(p: { read?: string[]; write?: string[]; create?: string[]; delete?: string[]; manage_agents?: boolean }): PermissionConfig {
  return {
    read: p.read ?? [],
    write: p.write ?? [],
    create: p.create ?? [],
    delete: p.delete ?? [],
    manage_agents: p.manage_agents,
  };
}

function makeAgent(id: string, readPatterns: string[]): Agent {
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

function makeSearchAgent(id: string, readPatterns: string[]): Agent {
  return {
    ...makeAgent(id, readPatterns),
    tools: ['fs_search_content', 'fs_search_metadata'],
  };
}

function makeFullFsAgent(id: string): Agent {
  return {
    ...makeAgent(id, ['**']),
    permissions: perms({ read: ['**'], write: ['**'], create: ['**'], delete: ['**'] }),
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

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-fs-tools-'));
  workspaces.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0, workspaces.length).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('fs_exists/fs_info tool execution', () => {
  it('returns access envelope and delegation alternatives for denied fs_exists', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'readme.md'), '# docs', 'utf8');

    const a = makeAgent('a', ['src/**/*']);
    const b = makeAgent('b', ['docs/**/*']);

    const engine = createAccessEngine({ workspaceRoot, agents: [a, b] });
    const manager = new ToolManager(workspaceRoot, engine);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const result = await manager.execute(a, 'fs_exists', { path: 'docs/readme.md' }, { workspaceRoot });

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.exists).toBe(false);
    expect(payload.access.allowed).toBe(false);
    expect(payload.delegation.possible).toBe(true);
    expect(payload.delegation.contexts.some((ctx: { contextId: string }) => ctx.contextId === 'b')).toBe(true);
  });

  it('returns metadata for allowed fs_info', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const x = 1;', 'utf8');

    const a = makeAgent('a', ['src/**/*']);
    const engine = createAccessEngine({ workspaceRoot, agents: [a] });

    const manager = new ToolManager(workspaceRoot, engine);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const result = await manager.execute(a, 'fs_info', { path: 'src/app.ts' }, { workspaceRoot });

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.exists).toBe(true);
    expect(payload.access.allowed).toBe(true);
    expect(payload.info).toBeTruthy();
    expect(payload.info.type).toBe('file');
    expect(typeof payload.info.size).toBe('number');
  });
});

describe('fs_search_* access filtering', () => {
  it('searches broadly then filters fs_search_content matches via @ai-team/access', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'allowed.ts'), 'const token = "needle";', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'blocked.md'), 'needle in blocked docs', 'utf8');

    const a = makeSearchAgent('a', ['**']);
    const engine = createAccessEngine({ workspaceRoot, agents: [a] });
    const existing = engine.getContext('a');
    if (!existing) throw new Error('Expected context for agent a');
    engine.updateContext('a', {
      rules: [
        ...existing.rules,
        { right: 'list', effect: 'deny', pathPattern: 'docs/**' },
      ],
    });

    const manager = new ToolManager(workspaceRoot, engine);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const result = await manager.execute(a, 'fs_search_content', { path: '.', query: 'needle' }, { workspaceRoot });
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(true);
    expect(payload.matches.some((m: { path: string }) => m.path.includes('src/allowed.ts'))).toBe(true);
    expect(payload.matches.some((m: { path: string }) => m.path.includes('docs/blocked.md'))).toBe(false);
  });

  it('filters fs_search_metadata matches via @ai-team/access before returning', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src', 'needle-zone'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs', 'needle-zone'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'needle-zone', 'a.ts'), 'x', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'needle-zone', 'b.md'), 'x', 'utf8');

    const a = makeSearchAgent('a', ['**']);
    const engine = createAccessEngine({ workspaceRoot, agents: [a] });
    const existing = engine.getContext('a');
    if (!existing) throw new Error('Expected context for agent a');
    engine.updateContext('a', {
      rules: [
        ...existing.rules,
        { right: 'list', effect: 'deny', pathPattern: 'docs/**' },
      ],
    });

    const manager = new ToolManager(workspaceRoot, engine);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const result = await manager.execute(
      a,
      'fs_search_metadata',
      { pattern: '**/needle-zone/**' },
      { workspaceRoot },
    );
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(true);
    expect(payload.matches.some((m: { path: string }) => m.path.startsWith('src/'))).toBe(true);
    expect(payload.matches.some((m: { path: string }) => m.path.startsWith('docs/'))).toBe(false);
  });
});

describe('remaining fs tool execution', () => {
  it('supports fs_read and fs_read_lines for allowed paths', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'file.txt'), 'line1\nline2\nline3', 'utf8');

    const a = makeFullFsAgent('a');
    const engine = createAccessEngine({ workspaceRoot, agents: [a] });
    const manager = new ToolManager(workspaceRoot, engine);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const full = await manager.execute(a, 'fs_read', { filePath: 'src/file.txt' }, { workspaceRoot });
    const lines = await manager.execute(
      a,
      'fs_read_lines',
      { filePath: 'src/file.txt', startLine: 2, endLine: 3 },
      { workspaceRoot },
    );

    expect(full.ok).toBe(true);
    expect((full.result as any).content).toContain('line1');
    expect(lines.ok).toBe(true);
    expect((lines.result as any).lines).toEqual(['2: line2', '3: line3']);
  });

  it('supports fs_write_file, fs_create and fs_mkdir', async () => {
    const workspaceRoot = await createWorkspace();
    const a = makeFullFsAgent('a');
    const engine = createAccessEngine({ workspaceRoot, agents: [a] });
    const manager = new ToolManager(workspaceRoot, engine);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const mkdir = await manager.execute(a, 'fs_mkdir', { path: 'tmp/nested' }, { workspaceRoot });
    const created = await manager.execute(
      a,
      'fs_create',
      { filePath: 'tmp/nested/new.txt', content: 'hello', createDirectories: true },
      { workspaceRoot },
    );
    const written = await manager.execute(
      a,
      'fs_write_file',
      { filePath: 'tmp/nested/new.txt', content: 'updated' },
      { workspaceRoot },
    );

    expect(mkdir.ok).toBe(true);
    expect((mkdir.result as any).created).toBe(true);
    expect(created.ok).toBe(true);
    expect((created.result as any).created).toBe(true);
    expect(written.ok).toBe(true);
    expect((written.result as any).written).toBe(true);

    const disk = await fs.readFile(path.join(workspaceRoot, 'tmp', 'nested', 'new.txt'), 'utf8');
    expect(disk).toBe('updated');
  });

  it('supports fs_list and fs_delete_path', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'tmp', 'dir'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'tmp', 'dir', 'a.txt'), 'a', 'utf8');

    const a = makeFullFsAgent('a');
    const engine = createAccessEngine({ workspaceRoot, agents: [a] });
    const manager = new ToolManager(workspaceRoot, engine);
    for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

    const listed = await manager.execute(a, 'fs_list', { path: 'tmp' }, { workspaceRoot });
    expect(listed.ok).toBe(true);
    expect((listed.result as any).entries.some((e: { name: string }) => e.name === 'dir')).toBe(true);

    const deleted = await manager.execute(a, 'fs_delete_path', { path: 'tmp/dir', recursive: true }, { workspaceRoot });
    expect(deleted.ok).toBe(true);
    expect((deleted.result as any).deleted).toBe(true);
  });
});
