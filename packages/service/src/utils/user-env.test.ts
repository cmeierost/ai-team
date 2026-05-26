import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEnvironmentStorage } from '@ai-team/core';

vi.mock('./git.js', () => ({
  getGitUserName: vi.fn(() => 'Test User'),
}));

import { MissingUserInputError, ensureUserEnvVars } from './user-env.js';

function mockEnvStorage(env: Record<string, string>): IEnvironmentStorage {
  const saved: Record<string, string>[] = [];
  return {
    loadEnvFileAsync: vi.fn().mockResolvedValue({ ...env }),
    saveEnvFileAsync: vi.fn().mockImplementation((_root: string, data: Record<string, string>) => {
      saved.push(data);
      return Promise.resolve();
    }),
    _saved: saved,
  } as unknown as IEnvironmentStorage;
}

describe('ensureUserEnvVars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts provider-specific API key env var without requiring AI_TEAM_LLM_API_KEY', async () => {
    const envStorage = mockEnvStorage({
      IFS_LLM_HUB_API_KEY: 'secret-123',
      AI_TEAM_USER_NAME: 'Dev User',
    });

    const result = await ensureUserEnvVars(
      'C:/workspace',
      { developerName: true, apiKey: true },
      { apiKeyEnvVar: 'IFS_LLM_HUB_API_KEY' },
      envStorage
    );

    expect(result.IFS_LLM_HUB_API_KEY).toBe('secret-123');
    expect(envStorage.saveEnvFileAsync).not.toHaveBeenCalled();
  });

  it('backfills preferred provider key from legacy AI_TEAM_LLM_API_KEY fallback', async () => {
    const envStorage = mockEnvStorage({
      AI_TEAM_LLM_API_KEY: 'legacy-key',
      AI_TEAM_USER_NAME: 'Dev User',
    });

    await ensureUserEnvVars(
      'C:/workspace',
      { developerName: true, apiKey: true },
      {
        apiKeyEnvVar: 'IFS_LLM_HUB_API_KEY',
      },
      envStorage
    );

    expect(envStorage.saveEnvFileAsync).toHaveBeenCalledWith(
      'C:/workspace',
      expect.objectContaining({
        AI_TEAM_LLM_API_KEY: 'legacy-key',
        IFS_LLM_HUB_API_KEY: 'legacy-key',
      })
    );
  });

  it('throws MissingUserInputError naming the preferred provider key', async () => {
    const envStorage = mockEnvStorage({ AI_TEAM_USER_NAME: 'Dev User' });

    await expect(
      ensureUserEnvVars(
        'C:/workspace',
        { developerName: true, apiKey: true },
        {
          apiKeyEnvVar: 'IFS_LLM_HUB_API_KEY',
        },
        envStorage
      )
    ).rejects.toBeInstanceOf(MissingUserInputError);

    await expect(
      ensureUserEnvVars(
        'C:/workspace',
        { developerName: true, apiKey: true },
        {
          apiKeyEnvVar: 'IFS_LLM_HUB_API_KEY',
        },
        mockEnvStorage({ AI_TEAM_USER_NAME: 'Dev User' })
      )
    ).rejects.toMatchObject({
      envVar: 'IFS_LLM_HUB_API_KEY',
    });
  });
});
