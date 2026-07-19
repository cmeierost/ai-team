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

  it('per-source override can enable a source even when global file level is off', async () => {
    const settingsService = {
      resolveForRuntime: vi.fn(() => ({
        file: 'off',
        console: 'off',
        sources: { 'workflow-runner': 'debug' },
      })),
    };
    const service = new InfrastructureBackendLogService(workspaceRoot, settingsService as any);

    service.write({ source: 'workflow-runner', level: 'debug', phase: 'xstate-inspect' });

    const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log');
    const line = await waitForFileLine(filePath);

    expect(line).toBeTruthy();
    const parsed = JSON.parse(line as string) as { entry?: { source?: string } };
    expect(parsed.entry?.source).toBe('workflow-runner');
  });

  it('per-source override raises level from error to debug for that source', async () => {
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const settingsService = {
      resolveForRuntime: vi.fn(() => ({
        file: 'off',
        console: 'error',
        sources: { 'workflow-runner': 'debug' },
      })),
    };
    const service = new InfrastructureBackendLogService(workspaceRoot, settingsService as any);

    // This debug entry from workflow-runner should appear (source override = debug)
    service.write({ source: 'workflow-runner', level: 'debug', phase: 'xstate-inspect' });

    // This debug entry from another source should NOT appear (global console = error)
    service.write({ source: 'other-source', level: 'debug', phase: 'something' });

    expect(stderrWrites).toHaveLength(1);
    const parsed = JSON.parse(stderrWrites[0]);
    expect(parsed.source).toBe('workflow-runner');
  });

  it('per-source override can suppress a source even when global level allows it', async () => {
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const settingsService = {
      resolveForRuntime: vi.fn(() => ({
        file: 'off',
        console: 'debug',
        sources: { 'workflow-runner': 'off' },
      })),
    };
    const service = new InfrastructureBackendLogService(workspaceRoot, settingsService as any);

    service.write({ source: 'workflow-runner', level: 'debug', phase: 'xstate-inspect' });

    expect(stderrWrites).toHaveLength(0);
  });
});
