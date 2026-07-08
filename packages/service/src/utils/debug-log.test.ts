import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  setBackendDebugLogSettingsResolver,
  writeBackendDebugLog,
} from './debug-log.js';

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

describe('backend debug log', () => {
  let workspaceRoot: string;
  let prevPath: string | undefined;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-backend-log-'));
    prevPath = process.env.AI_TEAM_BACKEND_LOG_FILE;
    delete process.env.AI_TEAM_BACKEND_LOG_FILE;
    setBackendDebugLogSettingsResolver(undefined);
  });

  afterEach(async () => {
    if (prevPath === undefined) {
      delete process.env.AI_TEAM_BACKEND_LOG_FILE;
    } else {
      process.env.AI_TEAM_BACKEND_LOG_FILE = prevPath;
    }

    setBackendDebugLogSettingsResolver(undefined);

    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('does not write by default', async () => {
    writeBackendDebugLog(workspaceRoot, { source: 'test', ok: true });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log');
    const exists = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('writes when file logging is enabled in resolved settings', async () => {
    setBackendDebugLogSettingsResolver(() => ({ file: true, console: false }));
    writeBackendDebugLog(workspaceRoot, { source: 'test', ok: true });

    const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log');
    const line = await waitForFileLine(filePath);
    expect(line).toBeTruthy();

    const parsed = JSON.parse(line as string) as { entry?: { source?: string; ok?: boolean } };
    expect(parsed.entry).toMatchObject({ source: 'test', ok: true });
  });

  it('does not write when resolved settings disable file logging', async () => {
    setBackendDebugLogSettingsResolver(() => ({ file: false, console: false }));
    writeBackendDebugLog(workspaceRoot, { source: 'disabled' });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log');
    const exists = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('writes to custom relative file path when configured', async () => {
    setBackendDebugLogSettingsResolver(() => ({ file: true, console: false }));
    process.env.AI_TEAM_BACKEND_LOG_FILE = '.ai-team/logs/custom-backend.log';
    writeBackendDebugLog(workspaceRoot, { source: 'custom' });

    const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'custom-backend.log');
    const line = await waitForFileLine(filePath);
    expect(line).toBeTruthy();
  });
});
