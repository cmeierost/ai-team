import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextLevel, type Agent, type PermissionConfig } from '@ai-team/core';
import { ToolManager } from '../tool-manager.js';
import { ALL_TOOLS } from './index.js';

/** Build the context object expected by ToolManager.execute(). */
function ctx(agent: Agent, ws: string) {
  return { agentId: agent.id, workspaceRoot: ws };
}

const workspaces: string[] = [];

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
    tools: ['exists', 'info'],
  };
}

function makeSearchAgent(id: string, readPatterns: string[]): Agent {
  return {
    ...makeAgent(id, readPatterns),
    tools: ['search_content', 'search_metadata'],
  };
}

function makeTreeAgent(id: string, readPatterns: string[]): Agent {
  return {
    ...makeAgent(id, readPatterns),
    tools: ['tree', 'list'],
  };
}

function makeFullFsAgent(id: string): Agent {
  return {
    ...makeAgent(id, ['**']),
    permissions: perms({ read: ['**'], write: ['**'] }),
    tools: ['read', 'read_lines', 'write_file', 'create', 'delete_path', 'mkdir', 'list'],
  };
}

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-fs-tools-'));
  workspaces.push(dir);
  return dir;
}

async function setupManager(workspaceRoot: string, agents: Agent[]): Promise<ToolManager> {
  const manager = new ToolManager(workspaceRoot);
  for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);
  return manager;
}

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0, workspaces.length)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('fs_exists/fs_info tool execution', () => {
  it('returns access denied for fs_exists when agent lacks permission', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'readme.md'), '# docs', 'utf8');

    const a = makeAgent('a', ['src/**/*']);

    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(
      a,
      'fs_exists',
      { path: 'docs/readme.md' },
      ctx(a, workspaceRoot)
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.exists).toBe(false);
    expect(payload.access.allowed).toBe(false);
  });

  it('returns metadata for allowed fs_info', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const x = 1;', 'utf8');

    const a = makeAgent('a', ['src/**/*']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(
      a,
      'fs_info',
      { path: 'src/app.ts' },
      ctx(a, workspaceRoot)
    );

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
  it('searches broadly then filters fs_search_content matches via @ai-team/permission', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'allowed.ts'),
      'const token = "needle";',
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'docs', 'blocked.md'),
      'needle in blocked docs',
      'utf8'
    );

    const a = makeSearchAgent('a', ['src/**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(
      a,
      'fs_search_content',
      { path: '.', query: 'needle' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(true);
    expect(payload.matches.some((m: { path: string }) => m.path.includes('src/allowed.ts'))).toBe(
      true
    );
    expect(payload.matches.some((m: { path: string }) => m.path.includes('docs/blocked.md'))).toBe(
      false
    );
  });

  it('filters fs_search_metadata matches via @ai-team/permission before returning', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src', 'needle-zone'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs', 'needle-zone'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'needle-zone', 'a.ts'), 'x', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'needle-zone', 'b.md'), 'x', 'utf8');

    const a = makeSearchAgent('a', ['src/**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(
      a,
      'fs_search_metadata',
      { pattern: '**/needle-zone/**' },
      ctx(a, workspaceRoot)
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
    const manager = await setupManager(workspaceRoot, [a]);

    const full = await manager.execute(
      a,
      'fs_read',
      { filePath: 'src/file.txt' },
      ctx(a, workspaceRoot)
    );
    const lines = await manager.execute(
      a,
      'fs_read_lines',
      { filePath: 'src/file.txt', startLine: 2, endLine: 3 },
      ctx(a, workspaceRoot)
    );

    expect(full.ok).toBe(true);
    expect((full.result as any).content).toBe('line1\nline2\nline3');
    expect((full.result as any).startLine).toBe(1);
    expect((full.result as any).endLine).toBe(3);
    expect((full.result as any).isFullFile).toBe(true);
    expect(lines.ok).toBe(true);
    expect((lines.result as any).content).toBe('line2\nline3');
    expect((lines.result as any).startLine).toBe(2);
    expect((lines.result as any).endLine).toBe(3);
    expect((lines.result as any).isFullFile).toBe(false);
    expect((lines.result as any).lines).toEqual(['line2', 'line3']);
  });

  it('supports fs_write_file, fs_create and fs_mkdir', async () => {
    const workspaceRoot = await createWorkspace();
    const a = makeFullFsAgent('a');
    const manager = await setupManager(workspaceRoot, [a]);

    const mkdir = await manager.execute(
      a,
      'fs_mkdir',
      { path: 'tmp/nested' },
      ctx(a, workspaceRoot)
    );
    const created = await manager.execute(
      a,
      'fs_create',
      { filePath: 'tmp/nested/new.txt', content: 'hello', createDirectories: true },
      ctx(a, workspaceRoot)
    );
    const written = await manager.execute(
      a,
      'fs_write_file',
      { filePath: 'tmp/nested/new.txt', content: 'updated' },
      ctx(a, workspaceRoot)
    );

    expect(mkdir.ok).toBe(true);
    expect((mkdir.result as any).created).toBe(true);
    expect(created.ok).toBe(true);
    expect((created.result as any).created).toBe(true);
    expect(written.ok).toBe(true);
    expect((written.result as any).written).toBe(true);
    expect((written.result as any)._fileChanges).toHaveLength(1);
    expect((written.result as any)._fileChanges[0]).toEqual({
      filePath: path.join(workspaceRoot, 'tmp', 'nested', 'new.txt'),
      oldContent: 'hello',
      newContent: 'updated',
    });

    const disk = await fs.readFile(path.join(workspaceRoot, 'tmp', 'nested', 'new.txt'), 'utf8');
    expect(disk).toBe('updated');
  });

  it('returns _fileChanges with empty oldContent when fs_write_file creates a new file', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'tmp', 'nested'), { recursive: true });

    const a = makeFullFsAgent('a');
    const manager = await setupManager(workspaceRoot, [a]);

    const written = await manager.execute(
      a,
      'fs_write_file',
      { filePath: 'tmp/nested/brand-new.txt', content: 'new-content' },
      ctx(a, workspaceRoot)
    );

    expect(written.ok).toBe(true);
    expect((written.result as any).written).toBe(true);
    expect((written.result as any)._fileChanges).toHaveLength(1);
    expect((written.result as any)._fileChanges[0]).toEqual({
      filePath: path.join(workspaceRoot, 'tmp', 'nested', 'brand-new.txt'),
      oldContent: '',
      newContent: 'new-content',
    });

    const disk = await fs.readFile(path.join(workspaceRoot, 'tmp', 'nested', 'brand-new.txt'), 'utf8');
    expect(disk).toBe('new-content');
  });

  it('supports fs_list and fs_delete_path', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'tmp', 'dir'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'tmp', 'dir', 'a.txt'), 'a', 'utf8');

    const a = makeFullFsAgent('a');
    const manager = await setupManager(workspaceRoot, [a]);

    const listed = await manager.execute(a, 'fs_list', { path: 'tmp' }, ctx(a, workspaceRoot));
    expect(listed.ok).toBe(true);
    expect((listed.result as any).entries.some((e: { name: string }) => e.name === 'dir')).toBe(
      true
    );

    const deleted = await manager.execute(
      a,
      'fs_delete_path',
      { path: 'tmp/dir', recursive: true },
      ctx(a, workspaceRoot)
    );
    expect(deleted.ok).toBe(true);
    expect((deleted.result as any).deleted).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Agent with subtree-only access can still use listing/search tools from root
// ──────────────────────────────────────────────────────────────────────────────

describe('fs_tree with subtree-only access', () => {
  it('returns accessible subtree files when called from root without root-level list access', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const x = 1;', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'readme.md'), '# Docs', 'utf8');

    // Agent only has read (→ list) on src/**
    const a = makeTreeAgent('subtree-a', ['src/**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(a, 'fs_tree', { path: '.' }, ctx(a, workspaceRoot));
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(true);
    expect(payload.tree).not.toBeNull();

    // src subtree should be visible
    const srcNode = payload.tree.children?.find((c: any) => c.name === 'src');
    expect(srcNode).toBeTruthy();
    expect(srcNode.rights).toEqual(
      expect.objectContaining({ l: true, r: true, w: expect.any(Boolean) })
    );
    expect(srcNode.children?.some((c: any) => c.name === 'app.ts')).toBe(true);

    const appNode = srcNode.children?.find((c: any) => c.name === 'app.ts');
    expect(appNode?.rights).toEqual(
      expect.objectContaining({ l: true, r: true, w: expect.any(Boolean) })
    );

    // docs should NOT be visible (no list access)
    const docsNode = payload.tree.children?.find((c: any) => c.name === 'docs');
    expect(docsNode).toBeFalsy();

    // denied count should reflect the inaccessible file(s)
    expect(payload.denied).toBeGreaterThan(0);
    expect(payload.access.explanation).toContain('hidden due to access restrictions');
  });

  it('returns null tree when agent has no accessible files', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const x = 1;', 'utf8');

    // Agent has no read patterns at all
    const a = makeTreeAgent('no-access', ['__deny_all__']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(a, 'fs_tree', { path: '.' }, ctx(a, workspaceRoot));
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.tree).toBeNull();
    expect(payload.access.allowed).toBe(false);
    // file(s) exist but agent has no access — message should say so
    expect(payload.denied).toBeGreaterThan(0);
    expect(payload.access.explanation).toContain('not accessible with your current permissions');
    expect(payload.access.explanation).toContain('delegating');
  });

  it('returns full tree when agent has broad read access', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'x', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'readme.md'), 'y', 'utf8');

    const a = makeTreeAgent('full-access', ['**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(a, 'fs_tree', { path: '.' }, ctx(a, workspaceRoot));
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(true);
    expect(payload.tree).not.toBeNull();
    expect(payload.tree.children?.find((c: any) => c.name === 'src')).toBeTruthy();
    expect(payload.tree.children?.find((c: any) => c.name === 'docs')).toBeTruthy();
    expect(payload.tree.children?.every((c: any) => c.rights?.l === true)).toBe(true);
    expect(payload.denied).toBe(0);
  });
});

describe('fs_list with subtree-only access', () => {
  it('lists only accessible entries when listing root without root-level list access', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'allowed-dir'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'blocked-dir'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'allowed-dir', 'a.ts'), 'x', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'blocked-dir', 'b.ts'), 'y', 'utf8');

    // Agent only has list on allowed-dir/**
    const a = makeTreeAgent('list-subtree', ['allowed-dir/**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(a, 'fs_list', { path: '.' }, ctx(a, workspaceRoot));
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    // allowed-dir should be listed
    expect(payload.entries.some((e: any) => e.name === 'allowed-dir')).toBe(true);
    // blocked-dir should NOT be listed
    expect(payload.entries.some((e: any) => e.name === 'blocked-dir')).toBe(false);
    // denied count should reflect the blocked entry
    expect(payload.denied).toBeGreaterThan(0);
    expect(payload.access.explanation).toContain('hidden due to access restrictions');
  });

  it('returns empty entries with allowed=false when no entries are accessible', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'private'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'private', 'secret.txt'), 'x', 'utf8');

    const a = makeTreeAgent('no-list', ['__deny_all__']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(a, 'fs_list', { path: '.' }, ctx(a, workspaceRoot));
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.entries).toEqual([]);
    expect(payload.access.allowed).toBe(false);
    // directory has entries but agent has no access
    expect(payload.denied).toBeGreaterThan(0);
    expect(payload.access.explanation).toContain('not accessible with your current permissions');
    expect(payload.access.explanation).toContain('delegating');
  });
});

describe('fs_search_content with subtree-only access', () => {
  it('finds matches in accessible files when searching from root without root-level access', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'secret'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'const PORT = 290420;', 'utf8');
    await fs.writeFile(
      path.join(workspaceRoot, 'secret', 'config.ts'),
      'const PORT = 290420;',
      'utf8'
    );

    const a = makeSearchAgent('search-subtree', ['src/**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(
      a,
      'fs_search_content',
      { path: '.', query: '290420' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(true);
    expect(payload.matches.length).toBeGreaterThan(0);
    expect(payload.matches.some((m: any) => m.path === 'src/app.ts')).toBe(true);
    expect(payload.matches.some((m: any) => m.path === 'secret/config.ts')).toBe(false);
    // denied count should reflect the inaccessible match
    expect(payload.denied).toBeGreaterThan(0);
    expect(payload.access.explanation).toContain('hidden due to access restrictions');
  });

  it('reports denied matches when no accessible files contain the query', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'secret'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'secret', 'config.ts'),
      'const PORT = 290420;',
      'utf8'
    );

    const a = makeSearchAgent('search-denied', ['src/**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(
      a,
      'fs_search_content',
      { path: '.', query: '290420' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(false);
    expect(payload.matches).toEqual([]);
    // matches exist but agent can't see them
    expect(payload.denied).toBeGreaterThan(0);
    expect(payload.access.explanation).toContain('not accessible with your current permissions');
    expect(payload.access.explanation).toContain('delegating');
  });
});

describe('fs_search_metadata with subtree-only access', () => {
  it('finds files matching glob in accessible paths only', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'private'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'x', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'private', 'hidden.ts'), 'y', 'utf8');

    const a = makeSearchAgent('meta-subtree', ['src/**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(
      a,
      'fs_search_metadata',
      { pattern: '**/*.ts' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(true);
    expect(payload.matches.some((m: any) => m.path === 'src/app.ts')).toBe(true);
    expect(payload.matches.some((m: any) => m.path === 'private/hidden.ts')).toBe(false);
    // denied count should reflect the inaccessible file
    expect(payload.denied).toBeGreaterThan(0);
    expect(payload.access.explanation).toContain('hidden due to access restrictions');
  });

  it('reports denied files when no accessible files match the glob', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, 'private'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'private', 'hidden.ts'), 'y', 'utf8');

    const a = makeSearchAgent('meta-denied', ['src/**']);
    const manager = await setupManager(workspaceRoot, [a]);

    const result = await manager.execute(
      a,
      'fs_search_metadata',
      { pattern: '**/*.ts' },
      ctx(a, workspaceRoot)
    );
    expect(result.ok).toBe(true);

    const payload = result.result as any;
    expect(payload.access.allowed).toBe(false);
    expect(payload.matches).toEqual([]);
    expect(payload.denied).toBeGreaterThan(0);
    expect(payload.access.explanation).toContain('not accessible with your current permissions');
    expect(payload.access.explanation).toContain('delegating');
  });
});
