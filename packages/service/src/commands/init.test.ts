import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coreApi = vi.hoisted(() => ({
  ensureAiTeamDirectory: vi.fn(),
  loadTeamConfig: vi.fn(),
  resolveEffectiveLlmSettings: vi.fn(),
  saveTeamConfig: vi.fn(),
  saveEnvFile: vi.fn(),
  loadAgent: vi.fn(),
  loadSkill: vi.fn(),
  testLlmConnection: vi.fn(),
  fetchGitHubModels: vi.fn(),
  loadEnvFile: vi.fn(),
}));

vi.mock('@ai-team/core', () => {
  class LlmService {
    constructor(_workspaceRoot: string) {}

    initializeFromConfig(): void {}
    rawChat = vi.fn();
    rawStreamChat = vi.fn();
  }

  class ChatManager {
    constructor(_workspaceRoot: string) {}

    appendMessage = vi.fn();
  }

  return {
    ...coreApi,
    LlmService,
    ChatManager,
  };
});

import { initCommand } from './init.js';

describe('initCommand', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-init-'));
    await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
    coreApi.loadTeamConfig.mockResolvedValue(undefined);
    coreApi.resolveEffectiveLlmSettings.mockReturnValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('returns early without prompting when workspace is already initialized and --force is not set', async () => {
    const questionConfirm = vi.fn();

    await initCommand(workspaceRoot, {}, { questionConfirm });

    expect(questionConfirm).not.toHaveBeenCalled();
    expect(coreApi.ensureAiTeamDirectory).not.toHaveBeenCalled();
    expect(coreApi.saveTeamConfig).not.toHaveBeenCalled();
    expect(coreApi.saveEnvFile).not.toHaveBeenCalled();
  });
});
