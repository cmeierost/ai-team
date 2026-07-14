import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemStatusICommand } from './system-status.js';

const tmpDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-system-status-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    })
  );
});

describe('SystemStatusICommand', () => {
  it('reports not initialized when .ai-team is missing', async () => {
    const workspaceRoot = await createTempWorkspace();
    const teamConfig = {
      version: '1',
      log: {
        backend: {
          file: 'off',
          console: 'off',
          targets: {
            console: { file: 'off', console: 'off' },
            api: { file: 'off', console: 'off' },
          },
        },
        frontend: { file: 'off', console: 'off' },
        chat: {
          sessionStartupLoad: { enabled: false, file: 'off', console: 'off' },
        },
      },
      randomAvatarUrls: [],
    } as any;

    const cmd = new SystemStatusICommand(workspaceRoot, teamConfig);
    const result = await cmd.execute({}, {} as any);

    expect(result).toEqual({
      status: 'ok',
      data: { initialized: false, hasLlmConfig: false, hasAgents: false },
    });
  });

  it('reports initialized and agents when agent files exist', async () => {
    const workspaceRoot = await createTempWorkspace();
    await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'agents'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, '.ai-team', 'agents', 'alex.agent.md'), '# Alex');

    const teamConfig = {
      version: '1',
      log: {
        backend: {
          file: 'off',
          console: 'off',
          targets: {
            console: { file: 'off', console: 'off' },
            api: { file: 'off', console: 'off' },
          },
        },
        frontend: { file: 'off', console: 'off' },
        chat: {
          sessionStartupLoad: { enabled: false, file: 'off', console: 'off' },
        },
      },
      randomAvatarUrls: [],
    } as any;

    const cmd = new SystemStatusICommand(workspaceRoot, teamConfig);
    const result = await cmd.execute({}, {} as any);

    expect(result).toEqual({
      status: 'ok',
      data: { initialized: true, hasLlmConfig: false, hasAgents: true },
    });
  });
});
