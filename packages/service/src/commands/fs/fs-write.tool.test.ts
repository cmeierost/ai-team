import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTime, WorkspaceFs } from 'fs-context';
import { FsWriteTool, FsWriteToolMetadata } from './fs-write.tool.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true }))
  );
});

describe('fs_write', () => {
  it('clearly routes read operations to fs_read in LLM-facing metadata', () => {
    expect(FsWriteToolMetadata.description).toContain('use fs_read to inspect files');
    expect(FsWriteToolMetadata.description.length).toBeLessThan(220);
    expect('mode' in FsWriteToolMetadata.parameters.shape).toBe(false);
  });

  it('applies multiple stale-read-safe edits in multi mode', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-fs-write-'));
    workspaces.push(workspace);
    const absolutePath = path.join(workspace, 'notes.md');
    await fs.writeFile(absolutePath, 'alpha\nbeta\ngamma\n', 'utf8');

    const agent = {
      id: 'michael-brown',
      permissions: { read: ['**'], write: ['**'], list: ['**'] },
    };
    FileTime.record(agent.id, absolutePath);
    const tool = new FsWriteTool(
      workspace,
      {} as any,
      {
        canWritePath: () => true,
        getContextsForPath: () => [],
      } as any,
      {
        createAsync: async () => ({ lsp: { isAvailable: () => false } }),
      } as any
    );

    const response = await tool.execute(
      {
        filePath: 'notes.md',
        edits: [
          { oldString: 'alpha', newString: 'one' },
          { oldString: 'gamma', newString: 'three' },
        ],
      },
      { agent, invocationSurface: 'tool' } as any
    );

    expect(response.status).toBe('ok');
    expect(response.data).toEqual(expect.objectContaining({ succeeded: 2, totalEdits: 2 }));
    expect(tool.formatForLlm(response)).toBe('2/2 edits applied to notes.md');
    await expect(fs.readFile(absolutePath, 'utf8')).resolves.toBe('one\nbeta\nthree\n');
  });

  it('requires exactly one inferred operation shape', () => {
    const parsed = FsWriteToolMetadata.parameters.safeParse({
      filePath: 'notes.md',
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts the three simple operation shapes', () => {
    expect(FsWriteToolMetadata.parameters.safeParse({
      filePath: 'notes.md',
      content: 'complete file',
    }).success).toBe(true);
    expect(FsWriteToolMetadata.parameters.safeParse({
      filePath: 'notes.md',
      oldString: 'before',
      newString: 'after',
    }).success).toBe(true);
    expect(FsWriteToolMetadata.parameters.safeParse({
      filePath: 'notes.md',
      edits: [{ oldString: 'before', newString: 'after' }],
    }).success).toBe(true);
  });

  it('accepts legacy mode payloads while stripping mode before execution', () => {
    const parsed = FsWriteToolMetadata.parameters.safeParse({
      filePath: 'notes.md',
      mode: 'create',
      content: 'legacy caller',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty('mode');
  });

  it('automatically creates or replaces from the same content shape', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-fs-write-content-'));
    workspaces.push(workspace);
    const workspaceFsFactory = {
      create: async () => new WorkspaceFs(workspace, 'writer', {
        canList: () => true,
        canRead: () => true,
        canWrite: () => true,
      }),
    };
    const tool = new FsWriteTool(
      workspace,
      workspaceFsFactory as any,
      {} as any,
      {} as any
    );

    const created = await tool.execute(
      { filePath: 'nested/notes.md', content: 'first', createDirectories: true },
      { agent: { id: 'writer', permissions: {} } } as any
    );
    const replaced = await tool.execute(
      { filePath: 'nested/notes.md', content: 'second' },
      { agent: { id: 'writer', permissions: {} } } as any
    );

    expect(created.status).toBe('ok');
    expect(created.data).toEqual(expect.objectContaining({ created: true }));
    expect(replaced.status).toBe('ok');
    expect(replaced.data).toEqual(expect.objectContaining({ written: true }));
    await expect(fs.readFile(path.join(workspace, 'nested', 'notes.md'), 'utf8')).resolves.toBe(
      'second'
    );
  });
});
