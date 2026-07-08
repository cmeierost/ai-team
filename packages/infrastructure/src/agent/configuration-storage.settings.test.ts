import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigurationStorage } from './configuration-storage.js';

const createdDirs: string[] = [];

async function createWorkspaceAsync(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-settings-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.AI_TEAM_TEST_SECRET;
  delete process.env.LOG_FILE;
  delete process.env.LOG_CONSOLE;
  await Promise.all(
    createdDirs
      .splice(0, createdDirs.length)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('ConfigurationStorage settings APIs', () => {
  it('resolves setting with env precedence: startup > root .env > .ai-team/.env', async () => {
    const workspaceRoot = await createWorkspaceAsync();
    const storage = new ConfigurationStorage(workspaceRoot);

    await storage.set('providers.demo.kind', 'openai-compatible' as any);
    await storage.set('providers.demo.apiKey', '${AI_TEAM_TEST_SECRET}');

    const envPath = path.join(workspaceRoot, '.ai-team', '.env');
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    await fs.writeFile(envPath, 'AI_TEAM_TEST_SECRET="from-ai-team"\n', 'utf-8');
    await fs.writeFile(
      path.join(workspaceRoot, '.env'),
      'AI_TEAM_TEST_SECRET="from-root"\n',
      'utf-8'
    );
    process.env.AI_TEAM_TEST_SECRET = 'from-startup';

    const apiKey = storage.get('providers.demo.apiKey');
    expect(apiKey).toBe('from-startup');
  });

  it('set writes team value and removes the user override at same path', async () => {
    const workspaceRoot = await createWorkspaceAsync();
    const storage = new ConfigurationStorage(workspaceRoot);

    await storage.set('providers.demo.kind', 'openai-compatible' as any);
    await storage.set('providers.demo.baseUrl', 'https://api.example.com/v1');
    await storage.set('providers.demo.kind', 'openai-compatible' as any, 'user');
    await storage.set('providers.demo.baseUrl', 'https://user.example.com/v1', 'user');

    await storage.set('providers.demo.baseUrl', 'https://default.example.com/v1');

    const teamBaseUrl = storage.get('providers.demo.baseUrl');
    expect(teamBaseUrl).toBe('https://default.example.com/v1');

    const userConfigPath = path.join(workspaceRoot, '.ai-team', 'config.user.json');
    const rawUserConfig = JSON.parse(await fs.readFile(userConfigPath, 'utf-8')) as {
      providers?: { demo?: { baseUrl?: string; kind?: string } };
    };
    expect(rawUserConfig.providers?.demo?.baseUrl).toBeUndefined();
  });

  it('setSecret stores env value and references it at config path', async () => {
    const workspaceRoot = await createWorkspaceAsync();
    const storage = new ConfigurationStorage(workspaceRoot);

    await storage.set('providers.demo.kind', 'openai-compatible' as any);
    await storage.set('providers.demo.baseUrl', 'https://api.example.com/v1');
    await storage.set('providers.demo.apiKey', '${DEMO_KEY}');

    await storage.setSecret('DEMO_KEY', 'demo-secret');

    const teamConfigPath = path.join(workspaceRoot, '.ai-team', 'config.json');
    const rawTeamConfig = JSON.parse(await fs.readFile(teamConfigPath, 'utf-8')) as {
      providers?: { demo?: { apiKey?: string } };
    };
    expect(rawTeamConfig.providers?.demo?.apiKey).toBe('${DEMO_KEY}');

    const resolvedApiKey = storage.get('providers.demo.apiKey');
    expect(resolvedApiKey).toBe('demo-secret');
  });

  it('resolves LOG_FILE override precedence: startup > root .env > .ai-team/.env > config', async () => {
    const workspaceRoot = await createWorkspaceAsync();
    const storage = new ConfigurationStorage(workspaceRoot);

    await storage.set('log.file', false);

    await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, '.ai-team', '.env'), 'LOG_FILE="true"\n', 'utf-8');
    await fs.writeFile(path.join(workspaceRoot, '.env'), 'LOG_FILE="false"\n', 'utf-8');
    process.env.LOG_FILE = 'true';

    expect(storage.get('log.file')).toBe(true);
  });

  it('resolves LOG_CONSOLE from .env when startup env is absent', async () => {
    const workspaceRoot = await createWorkspaceAsync();
    const storage = new ConfigurationStorage(workspaceRoot);

    await storage.set('log.console', false);
    await fs.writeFile(path.join(workspaceRoot, '.env'), 'LOG_CONSOLE="on"\n', 'utf-8');

    expect(storage.get('log.console')).toBe(true);
  });

  it('ignores invalid LOG_FILE values and keeps config value', async () => {
    const workspaceRoot = await createWorkspaceAsync();
    const storage = new ConfigurationStorage(workspaceRoot);

    await storage.set('log.file', true);
    process.env.LOG_FILE = 'banana';

    expect(storage.get('log.file')).toBe(true);
  });
});
