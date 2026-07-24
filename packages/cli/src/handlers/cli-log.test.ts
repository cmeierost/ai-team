import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCliFileLogEnabled, writeCliLog } from './cli-log.js';

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

describe('CLI log', () => {
  let tempCwd: string;
  let originalCwd: string;
  let prevLogFile: string | undefined;
  let prevPath: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-frontend-log-'));
    process.chdir(tempCwd);

    prevLogFile = process.env.LOG_CLI_FILE;
    prevPath = process.env.AI_TEAM_CLI_LOG_FILE;
    delete process.env.LOG_CLI_FILE;
    delete process.env.AI_TEAM_CLI_LOG_FILE;
  });

  afterEach(async () => {
    process.chdir(originalCwd);

    if (prevLogFile === undefined) {
      delete process.env.LOG_CLI_FILE;
    } else {
      process.env.LOG_CLI_FILE = prevLogFile;
    }

    if (prevPath === undefined) {
      delete process.env.AI_TEAM_CLI_LOG_FILE;
    } else {
      process.env.AI_TEAM_CLI_LOG_FILE = prevPath;
    }

    await fs.rm(tempCwd, { recursive: true, force: true });
  });

  it('is enabled at error level by default', () => {
    expect(isCliFileLogEnabled()).toBe(true);
  });

  it('writes to .ai-team/logs/cli.log when log.cli.file is enabled in config', async () => {
    await fs.mkdir(path.join(tempCwd, '.ai-team'), { recursive: true });
    await fs.writeFile(
      path.join(tempCwd, '.ai-team', 'config.json'),
      JSON.stringify({ version: '1', log: { cli: { file: 'info' } } }, null, 2) + '\n',
      'utf-8'
    );

    writeCliLog({ source: 'test', ok: true });

    const filePath = path.join(tempCwd, '.ai-team', 'logs', 'cli.log');
    const line = await waitForFileLine(filePath);
    expect(line).toBeTruthy();

    const parsed = JSON.parse(line as string) as { entry?: { source?: string; ok?: boolean } };
    expect(parsed.entry).toMatchObject({ source: 'test', ok: true });
  });

  it('does not write when LOG_CLI_FILE env override disables file logging', async () => {
    await fs.mkdir(path.join(tempCwd, '.ai-team'), { recursive: true });
    await fs.writeFile(
      path.join(tempCwd, '.ai-team', 'config.json'),
      JSON.stringify({ version: '1', log: { cli: { file: 'info' } } }, null, 2) + '\n',
      'utf-8'
    );
    process.env.LOG_CLI_FILE = 'off';
    writeCliLog({ source: 'disabled' });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const filePath = path.join(tempCwd, '.ai-team', 'logs', 'cli.log');
    const exists = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('writes to custom relative file path when configured', async () => {
    await fs.mkdir(path.join(tempCwd, '.ai-team'), { recursive: true });
    await fs.writeFile(
      path.join(tempCwd, '.ai-team', 'config.json'),
      JSON.stringify({ version: '1', log: { cli: { file: 'info' } } }, null, 2) + '\n',
      'utf-8'
    );
    process.env.AI_TEAM_CLI_LOG_FILE = '.ai-team/logs/custom-cli.log';
    writeCliLog({ source: 'custom' });

    const filePath = path.join(tempCwd, '.ai-team', 'logs', 'custom-cli.log');
    const line = await waitForFileLine(filePath);
    expect(line).toBeTruthy();
  });
});
