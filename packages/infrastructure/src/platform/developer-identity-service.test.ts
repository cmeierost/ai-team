import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { IConfigurationStorage } from '@ai-team/core';
import { DeveloperIdentityService } from './developer-identity-service.js';

const createdDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-dev-id-'));
  createdDirs.push(dir);
  return dir;
}

function createConfigStorage(workspaceRoot: string): IConfigurationStorage {
  return {
    getConfigPath: () => path.join(workspaceRoot, '.ai-team', 'config.json'),
    loadTeamConfigAsync: async () => undefined,
    saveTeamConfigAsync: async () => undefined,
    getUserConfigPath: () => path.join(workspaceRoot, '.ai-team', 'config.user.json'),
    loadUserConfigAsync: async () => undefined,
    saveUserConfigAsync: async (config) => config,
    loadEffectiveConfigAsync: async () => undefined,
  } as IConfigurationStorage;
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0, createdDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

function hasGit(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('DeveloperIdentityService', () => {
  it('prefers user config identity over git config', async () => {
    const workspace = await createWorkspace();
    const userConfigPath = path.join(workspace, '.ai-team', 'config.user.json');
    await fs.mkdir(path.dirname(userConfigPath), { recursive: true });
    await fs.writeFile(
      userConfigPath,
      JSON.stringify(
        {
          developer: {
            id: 'configured-dev',
            name: 'Configured Name',
            email: 'configured@example.com',
          },
        },
        null,
        2
      ) + '\n',
      'utf-8'
    );

    const service = new DeveloperIdentityService(workspace, createConfigStorage(workspace));

    expect(service.getUserName()).toBe('Configured Name');
    expect(service.getUserEmail()).toBe('configured@example.com');

    const saved = JSON.parse(await fs.readFile(userConfigPath, 'utf-8')) as {
      developer?: { id?: string; name?: string; email?: string };
    };
    expect(saved.developer?.name).toBe('Configured Name');
    expect(saved.developer?.email).toBe('configured@example.com');
  });

  it('falls back to git config and persists developer identity for future calls', async () => {
    if (!hasGit()) {
      // Environment without git: treat as not applicable.
      expect(true).toBe(true);
      return;
    }

    const workspace = await createWorkspace();
    execSync('git init', { cwd: workspace, stdio: 'ignore' });
    execSync('git config user.name "Git Name"', { cwd: workspace, stdio: 'ignore' });
    execSync('git config user.email "git@example.com"', { cwd: workspace, stdio: 'ignore' });

    const service = new DeveloperIdentityService(workspace, createConfigStorage(workspace));

    expect(service.getUserName()).toBe('Git Name');
    expect(service.getUserEmail()).toBe('git@example.com');

    const userConfigPath = path.join(workspace, '.ai-team', 'config.user.json');
    const saved = JSON.parse(await fs.readFile(userConfigPath, 'utf-8')) as {
      developer?: { id?: string; name?: string; email?: string };
    };

    expect(saved.developer).toBeDefined();
    expect(saved.developer?.name).toBe('Git Name');
    expect(saved.developer?.email).toBe('git@example.com');
    expect(saved.developer?.id).toBe('git-name');

    // Remove git identity from local repo to verify future reads come from user config.
    execSync('git config --unset user.name', { cwd: workspace, stdio: 'ignore' });
    execSync('git config --unset user.email', { cwd: workspace, stdio: 'ignore' });

    expect(service.getUserName()).toBe('Git Name');
    expect(service.getUserEmail()).toBe('git@example.com');
  });
});
