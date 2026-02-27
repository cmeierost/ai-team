import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

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

const listApi = vi.hoisted(() => ({
  listEmployeesCommand: vi.fn(),
}));

const chatApi = vi.hoisted(() => ({
  chatCommand: vi.fn(),
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
    loadChatHistory = vi.fn().mockResolvedValue([]);
  }

  return {
    ...coreApi,
    LlmService,
    ChatManager,
  };
});

vi.mock('./list.js', () => ({
  listEmployeesCommand: listApi.listEmployeesCommand,
}));

vi.mock('./chat.js', () => ({
  chatCommand: chatApi.chatCommand,
}));

vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  };
  return { default: vi.fn(() => spinner) };
});

import { initCommand } from './init.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Collect all events emitted through hooks.emit. */
function createEventCollector() {
  const events: Array<Record<string, unknown>> = [];
  const emit = (event: Record<string, unknown>) => { events.push(event); };
  return { events, emit };
}

/** Return log-level messages for easy assertion on output text / ordering. */
function logMessages(events: Array<Record<string, unknown>>): string[] {
  return events
    .filter(e => e.kind === 'log')
    .map(e => String(e.message));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('initCommand', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-init-'));
    coreApi.loadTeamConfig.mockResolvedValue(undefined);
    coreApi.resolveEffectiveLlmSettings.mockReturnValue(undefined);
    coreApi.loadEnvFile.mockResolvedValue({});
    listApi.listEmployeesCommand.mockResolvedValue([]);
    chatApi.chatCommand.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  // ── Early exit (no --force) ──────────────────────────────────────────────

  describe('already-initialized workspace without --force', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
    });

    it('returns early without prompting', async () => {
      const questionConfirm = vi.fn();

      await initCommand(workspaceRoot, {}, { questionConfirm });

      expect(questionConfirm).not.toHaveBeenCalled();
      expect(coreApi.ensureAiTeamDirectory).not.toHaveBeenCalled();
      expect(coreApi.saveTeamConfig).not.toHaveBeenCalled();
      expect(coreApi.saveEnvFile).not.toHaveBeenCalled();
    });

    it('emits "already initialized" warning and "Skipping" message', async () => {
      const { events, emit } = createEventCollector();

      await initCommand(workspaceRoot, {}, { emit });

      const messages = logMessages(events);
      expect(messages.some(m => m.includes('already initialized'))).toBe(true);
      expect(messages.some(m => m.includes('Skipping'))).toBe(true);
    });
  });

  // ── --force: clear directory ─────────────────────────────────────────────

  describe('--force clears .ai-team directory', () => {
    beforeEach(async () => {
      const aiDir = path.join(workspaceRoot, '.ai-team');
      await fs.mkdir(aiDir, { recursive: true });
      // Seed files and directories that should / should not survive
      await fs.writeFile(path.join(aiDir, 'config.json'), '{}');
      await fs.writeFile(path.join(aiDir, '.env'), 'KEY=val');
      await fs.writeFile(path.join(aiDir, 'README.md'), '# test');
      await fs.mkdir(path.join(aiDir, 'agents'), { recursive: true });
      await fs.writeFile(path.join(aiDir, 'agents', 'cto.md'), 'agent');
      await fs.mkdir(path.join(aiDir, 'skills-catalog'), { recursive: true });
    });

    it('removes everything except config.json and .env', async () => {
      const { events, emit } = createEventCollector();

      // No existing LLM config → askLlmSetup path, which we abort
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, { force: true }, {
          emit,
          questionSelect,
          questionInput,
        });
      } catch {
        // expected — we aborted askLlmSetup
      }

      const aiDir = path.join(workspaceRoot, '.ai-team');
      const exists = async (p: string) => fs.stat(p).then(() => true, () => false);

      // Preserved
      expect(await exists(path.join(aiDir, 'config.json'))).toBe(true);
      expect(await exists(path.join(aiDir, '.env'))).toBe(true);

      // Removed (including nested directory)
      expect(await exists(path.join(aiDir, 'README.md'))).toBe(false);
      expect(await exists(path.join(aiDir, 'agents'))).toBe(false);
      expect(await exists(path.join(aiDir, 'skills-catalog'))).toBe(false);

      // Verify "Removed:" messages emitted
      const messages = logMessages(events);
      expect(messages.some(m => m.includes('Removed: README.md'))).toBe(true);
      expect(messages.some(m => m.includes('Removed: agents'))).toBe(true);
      expect(messages.some(m => m.includes('Removed: skills-catalog'))).toBe(true);
    });
  });

  // ── --force with existing LLM config ─────────────────────────────────────

  describe('--force with existing LLM config', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
      coreApi.loadTeamConfig.mockResolvedValue({
        version: '0.1.0',
        llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
      });
      coreApi.resolveEffectiveLlmSettings.mockReturnValue({
        config: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
        providerRef: 'openai',
        apiKeyEnvVar: 'AI_TEAM_LLM_API_KEY',
      });
    });

    it('asks LLM-reuse confirm BEFORE emitting "Welcome to AI Team!"', async () => {
      const { events, emit } = createEventCollector();
      const questionConfirm = vi.fn().mockResolvedValue(true);
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, { force: true }, {
          emit, questionConfirm, questionInput,
        });
      } catch {
        // expected
      }

      expect(questionConfirm).toHaveBeenCalledTimes(1);
      expect(questionConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Reuse existing default LLM connection'),
        }),
      );

      // Critical ordering: confirm question event must precede "Welcome" log
      const allKinds = events.map(e => ({
        kind: e.kind,
        msg: String(e.message ?? e.text ?? ''),
      }));

      const confirmIdx = allKinds.findIndex(
        e => e.kind === 'question' && e.msg.includes('Reuse'),
      );
      const welcomeIdx = allKinds.findIndex(
        e => e.kind === 'log' && e.msg.includes('Welcome to AI Team'),
      );

      expect(confirmIdx).toBeGreaterThanOrEqual(0);
      expect(welcomeIdx).toBeGreaterThanOrEqual(0);
      expect(welcomeIdx).toBeGreaterThan(confirmIdx);
    });

    it('reuses existing OpenAI-compatible config when user confirms', async () => {
      const { events, emit } = createEventCollector();
      const questionConfirm = vi.fn().mockResolvedValue(true);
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, { force: true }, {
          emit, questionConfirm, questionInput,
        });
      } catch {
        // expected
      }

      const messages = logMessages(events);
      expect(messages.some(m => m.includes('Reusing existing OpenAI-compatible'))).toBe(true);
    });

    it('runs fresh LLM setup when user declines reuse', async () => {
      const questionConfirm = vi.fn().mockResolvedValue(false);
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, { force: true }, {
          questionConfirm, questionSelect, questionInput,
        });
      } catch {
        // expected — we aborted askLlmSetup
      }

      expect(questionConfirm).toHaveBeenCalledTimes(1);
      // askLlmSetup should have been reached (questionSelect called for provider)
      expect(questionSelect).toHaveBeenCalled();
    });
  });

  // ── Event emission — no raw stdout ───────────────────────────────────────

  describe('event emission routing', () => {
    it('emits log events through hooks.emit for "Welcome to AI Team!"', async () => {
      // Use an already-initialized workspace with existing LLM config so the
      // flow reaches "Welcome to AI Team!" (which appears after askLlmSetup).
      await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
      coreApi.loadTeamConfig.mockResolvedValue({
        version: '0.1.0',
        llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
      });
      coreApi.resolveEffectiveLlmSettings.mockReturnValue({
        config: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
        providerRef: 'openai',
        apiKeyEnvVar: 'AI_TEAM_LLM_API_KEY',
      });
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });

      const { events, emit } = createEventCollector();
      const questionConfirm = vi.fn().mockResolvedValue(true);
      // Abort after LLM reuse so we don't need to mock the full onboarding flow
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, { force: true }, {
          emit, questionConfirm, questionInput,
        });
      } catch {
        // expected — aborted during onboarding
      }

      const logs = events.filter(e => e.kind === 'log');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some(e => String(e.message).includes('Welcome to AI Team'))).toBe(true);
    });

    it('all emitted events have a valid kind property', async () => {
      const { events, emit } = createEventCollector();
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, {}, { emit, questionSelect });
      } catch {
        // expected
      }

      expect(events.every(e => typeof e.kind === 'string')).toBe(true);
    });
  });
});
