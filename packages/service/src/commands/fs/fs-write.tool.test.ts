import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTime } from 'fs-context';
import { FsWriteTool, FsWriteToolMetadata } from './fs-write.tool.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true }))
  );
});

describe('fs_write', () => {
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
        mode: 'multi',
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

  it('requires edits in multi mode', () => {
    const parsed = FsWriteToolMetadata.parameters.safeParse({
      filePath: 'notes.md',
      mode: 'multi',
    });

    expect(parsed.success).toBe(false);
  });
});
