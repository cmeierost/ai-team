import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfrastructureBackendLogService } from './infrastructure-backend-log-service.js';

async function waitForFileLine(filePath: string, timeoutMs = 500): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const line = content.trim().split('\n').filter(Boolean).at(-1);
      if (line) {
        return line;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return undefined;
}

describe('InfrastructureBackendLogService', () => {
  let workspaceRoot: string;
  let previousLogFilePath: string | undefined;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-backend-log-svc-'));
    previousLogFilePath = process.env.AI_TEAM_BACKEND_LOG_FILE;
    delete process.env.AI_TEAM_BACKEND_LOG_FILE;
  });

  afterEach(async () => {
    if (previousLogFilePath === undefined) {
      delete process.env.AI_TEAM_BACKEND_LOG_FILE;
    } else {
      process.env.AI_TEAM_BACKEND_LOG_FILE = previousLogFilePath;
    }

    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('writes to file when file output level allows entry level', async () => {
    const settingsService = {
      resolveForRuntime: vi.fn(() => ({ file: 'info', console: 'off' })),
    };
    const service = new InfrastructureBackendLogService(workspaceRoot, settingsService as any);

    service.write({ source: 'test', phase: 'done', value: 1 });

    const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log');
    const line = await waitForFileLine(filePath);

    expect(line).toBeTruthy();
    const parsed = JSON.parse(line as string) as { entry?: { source?: string; value?: number } };
    expect(parsed.entry).toMatchObject({ source: 'test', value: 1 });
  });

  it('does not write to file when file output is off', async () => {
    const settingsService = {
      resolveForRuntime: vi.fn(() => ({ file: 'off', console: 'off' })),
    };
    const service = new InfrastructureBackendLogService(workspaceRoot, settingsService as any);

    service.write({ source: 'test', value: 2 });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log');
    const exists = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});
