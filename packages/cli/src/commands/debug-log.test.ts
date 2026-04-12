import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isFrontendFileLogEnabled, writeFrontendDebugLog } from './debug-log.js';

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

describe('frontend debug log', () => {
  let tempCwd: string;
  let originalCwd: string;
  let prevEnable: string | undefined;
  let prevPath: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-frontend-log-'));
    process.chdir(tempCwd);

    prevEnable = process.env.AI_TEAM_FRONTEND_FILE_LOG;
    prevPath = process.env.AI_TEAM_FRONTEND_LOG_FILE;
    delete process.env.AI_TEAM_FRONTEND_FILE_LOG;
    delete process.env.AI_TEAM_FRONTEND_LOG_FILE;
  });

  afterEach(async () => {
    process.chdir(originalCwd);

    if (prevEnable === undefined) {
      delete process.env.AI_TEAM_FRONTEND_FILE_LOG;
    } else {
      process.env.AI_TEAM_FRONTEND_FILE_LOG = prevEnable;
    }

    if (prevPath === undefined) {
      delete process.env.AI_TEAM_FRONTEND_LOG_FILE;
    } else {
      process.env.AI_TEAM_FRONTEND_LOG_FILE = prevPath;
    }

    await fs.rm(tempCwd, { recursive: true, force: true });
  });

  it('is enabled by default', () => {
    expect(isFrontendFileLogEnabled()).toBe(true);
  });

  it('writes to .ai-team/logs/frontend.log by default', async () => {
    writeFrontendDebugLog({ source: 'test', ok: true });

    const filePath = path.join(tempCwd, '.ai-team', 'logs', 'frontend.log');
    const line = await waitForFileLine(filePath);
    expect(line).toBeTruthy();

    const parsed = JSON.parse(line as string) as { entry?: { source?: string; ok?: boolean } };
    expect(parsed.entry).toMatchObject({ source: 'test', ok: true });
  });

  it('does not write when AI_TEAM_FRONTEND_FILE_LOG is disabled', async () => {
    process.env.AI_TEAM_FRONTEND_FILE_LOG = 'off';
    writeFrontendDebugLog({ source: 'disabled' });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const filePath = path.join(tempCwd, '.ai-team', 'logs', 'frontend.log');
    const exists = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('writes to custom relative file path when configured', async () => {
    process.env.AI_TEAM_FRONTEND_LOG_FILE = '.ai-team/logs/custom-frontend.log';
    writeFrontendDebugLog({ source: 'custom' });

    const filePath = path.join(tempCwd, '.ai-team', 'logs', 'custom-frontend.log');
    const line = await waitForFileLine(filePath);
    expect(line).toBeTruthy();
  });
});
