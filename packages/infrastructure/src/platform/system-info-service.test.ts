import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemInfoService } from './system-info-service.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('SystemInfoService', () => {
  it('reports the unborn branch before the repository has its first commit', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ai-team-system-info-'));
    temporaryDirectories.push(workspaceRoot);
    execFileSync('git', ['init', '--initial-branch', 'test-unborn'], {
      cwd: workspaceRoot,
      stdio: 'ignore',
    });

    const result = new SystemInfoService().getSystemInfo(workspaceRoot);

    expect(result.branch).toBe('test-unborn');
  });
});
