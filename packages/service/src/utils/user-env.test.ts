import { beforeEach, describe, expect, it, vi } from 'vitest';

const infraMocks = vi.hoisted(() => ({
  loadEnvFile: vi.fn(),
  saveEnvFile: vi.fn(),
}));

vi.mock('@ai-team/infrastructure', () => ({
  loadEnvFile: infraMocks.loadEnvFile,
  saveEnvFile: infraMocks.saveEnvFile,
}));

vi.mock('./git.js', () => ({
  getGitUserName: vi.fn(() => 'Test User'),
}));

import { MissingUserInputError, ensureUserEnvVars } from './user-env.js';

describe('ensureUserEnvVars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts provider-specific API key env var without requiring AI_TEAM_LLM_API_KEY', async () => {
    infraMocks.loadEnvFile.mockResolvedValue({
      IFS_LLM_HUB_API_KEY: 'secret-123',
      AI_TEAM_USER_NAME: 'Dev User',
    });

    const result = await ensureUserEnvVars(
      'C:/workspace',
      { developerName: true, apiKey: true },
      { apiKeyEnvVar: 'IFS_LLM_HUB_API_KEY' }
    );

    expect(result.IFS_LLM_HUB_API_KEY).toBe('secret-123');
    expect(infraMocks.saveEnvFile).not.toHaveBeenCalled();
  });

  it('backfills preferred provider key from legacy AI_TEAM_LLM_API_KEY fallback', async () => {
    infraMocks.loadEnvFile.mockResolvedValue({
      AI_TEAM_LLM_API_KEY: 'legacy-key',
      AI_TEAM_USER_NAME: 'Dev User',
    });

    await ensureUserEnvVars(
      'C:/workspace',
      { developerName: true, apiKey: true },
      {
        apiKeyEnvVar: 'IFS_LLM_HUB_API_KEY',
      }
    );

    expect(infraMocks.saveEnvFile).toHaveBeenCalledWith(
      'C:/workspace',
      expect.objectContaining({
        AI_TEAM_LLM_API_KEY: 'legacy-key',
        IFS_LLM_HUB_API_KEY: 'legacy-key',
      })
    );
  });

  it('throws MissingUserInputError naming the preferred provider key', async () => {
    infraMocks.loadEnvFile.mockResolvedValue({ AI_TEAM_USER_NAME: 'Dev User' });

    await expect(
      ensureUserEnvVars(
        'C:/workspace',
        { developerName: true, apiKey: true },
        {
          apiKeyEnvVar: 'IFS_LLM_HUB_API_KEY',
        }
      )
    ).rejects.toBeInstanceOf(MissingUserInputError);

    await expect(
      ensureUserEnvVars(
        'C:/workspace',
        { developerName: true, apiKey: true },
        {
          apiKeyEnvVar: 'IFS_LLM_HUB_API_KEY',
        }
      )
    ).rejects.toMatchObject({
      envVar: 'IFS_LLM_HUB_API_KEY',
    });
  });
});
