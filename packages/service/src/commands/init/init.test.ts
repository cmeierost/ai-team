import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmitService } from '../../interaction/emit-service.js';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const coreApi = vi.hoisted(() => ({
  ensureAiTeamDirectory: vi.fn(),
  loadTeamConfig: vi.fn(),
  resolveEffectiveLlmSettings: vi.fn(),
  saveTeamConfig: vi.fn(),
  saveEnvFile: vi.fn(),
  saveAgentAccessPatterns: vi.fn(),
  saveAgent: vi.fn(),
  loadAgent: vi.fn(),
  loadSkill: vi.fn(),
  testLlmConnection: vi.fn(),
  fetchGitHubModels: vi.fn(),
  loadEnvFile: vi.fn(),
  buildAgentMarkdown: vi.fn(),
  saveUserConfig: vi.fn(),
}));

const chatApi = vi.hoisted(() => ({
  chatCommand: vi.fn(),
}));

const connectionApi = vi.hoisted(() => ({
  testConnectionCommand: vi.fn(),
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

vi.mock('./chat.js', () => ({
  chatCommand: chatApi.chatCommand,
}));

vi.mock('./test-connection.js', () => ({
  testConnectionCommand: connectionApi.testConnectionCommand,
}));

vi.mock('./init-compat.js', () => ({
  ensureAiTeamDirectory: coreApi.ensureAiTeamDirectory,
  loadTeamConfig: coreApi.loadTeamConfig,
  loadEnvFile: coreApi.loadEnvFile,
  saveAgentAccessPatterns: coreApi.saveAgentAccessPatterns,
  testLlmConnection: coreApi.testLlmConnection,
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

/** Collect all events emitted through the injected emit service. */
function createEventCollector() {
  const events: Array<Record<string, unknown>> = [];
  const emitService = new EmitService((event) => events.push(event));
  return { events, emitService };
}

/** Return log-level messages for easy assertion on output text / ordering. */
function logMessages(events: Array<Record<string, unknown>>): string[] {
  return events.filter((e) => e.kind === 'log').map((e) => String(e.message));
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
    connectionApi.testConnectionCommand.mockResolvedValue(undefined);
    coreApi.saveAgent.mockResolvedValue(undefined);
    coreApi.saveAgentAccessPatterns.mockImplementation(
      async (root: string, agentId: string, patterns: { read?: string[]; write?: string[] }) => {
        const filePath = path.join(root, '.ai-team', 'agents', `${agentId}.perm`);
        const lines = [
          '# Migrated from .agent.yml permissions',
          '[read]',
          ...(patterns.read ?? []),
          '',
          '[write]',
          ...(patterns.write ?? []),
          '',
        ];
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
      }
    );
    coreApi.buildAgentMarkdown.mockImplementation(
      ({
        introduction = '',
        personalityProfile = [],
      }: {
        introduction?: string;
        personalityProfile?: string[];
      }) => {
        const profile =
          personalityProfile.length > 0
            ? '\n## Personality Profile\n' +
              personalityProfile.map((line) => `- ${line}`).join('\n')
            : '';
        return `## Introduction\n${introduction}${profile}`;
      }
    );
    coreApi.loadAgent.mockImplementation(async (filePath: string) => {
      const id = path.basename(filePath).replace(/\.agent\.md$/, '');
      return {
        id,
        name: id,
        role: id,
        type: 'executive',
        contextLevel: 'organization',
        filePath,
        skillPath: path.join(workspaceRoot, '.ai-team', 'roles', `${id}.md`),
        createdAt: new Date().toISOString(),
        permissions: { read: ['**/*'], write: ['.ai-team/**/*'] },
        avatar: { type: 'ai-generated' },
      };
    });
    chatApi.chatCommand.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  // ── Early exit (no --force) ──────────────────────────────────────────────

  describe('already-initialized workspace without --force', () => {
    beforeEach(async () => {
      const agentsDir = path.join(workspaceRoot, '.ai-team', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'john-smith.agent.md'), '# seeded\n', 'utf-8');
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
      const { events, emitService } = createEventCollector();

      await initCommand(workspaceRoot, {}, { emitService });

      const messages = logMessages(events);
      expect(messages.some((m) => m.includes('already initialized'))).toBe(true);
      expect(messages.some((m) => m.includes('Skipping'))).toBe(true);
    });
  });

  describe('partial .ai-team scaffold without agents', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, '.ai-team', 'config.json'), '{}', 'utf-8');
    });

    it('continues initialization instead of skipping', async () => {
      const { events, emitService } = createEventCollector();
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, {}, { emitService, questionSelect });
      } catch {
        // expected — abort in askLlmSetup
      }

      expect(questionSelect).toHaveBeenCalled();

      const messages = logMessages(events);
      expect(messages.some((m) => m.includes('continuing initialization'))).toBe(true);
      expect(messages.some((m) => m.includes('Skipping initialization'))).toBe(false);
    });
  });

  describe('empty .ai-team directory', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
    });

    it('continues initialization without emitting partial-scaffold warning', async () => {
      const { events, emitService } = createEventCollector();
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, {}, { emitService, questionSelect });
      } catch {
        // expected — abort in askLlmSetup
      }

      expect(questionSelect).toHaveBeenCalled();

      const messages = logMessages(events);
      expect(messages.some((m) => m.includes('continuing initialization'))).toBe(false);
      expect(messages.some((m) => m.includes('Skipping initialization'))).toBe(false);
    });

    it('continues without warning when only runtime-generated artifacts exist', async () => {
      const { events, emitService } = createEventCollector();
      await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'logs'), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log'), '', 'utf-8');
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, {}, { emitService, questionSelect });
      } catch {
        // expected — abort in askLlmSetup
      }

      expect(questionSelect).toHaveBeenCalled();

      const messages = logMessages(events);
      expect(messages.some((m) => m.includes('continuing initialization'))).toBe(false);
      expect(messages.some((m) => m.includes('Skipping initialization'))).toBe(false);
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
      const { events, emitService } = createEventCollector();

      // No existing LLM config → askLlmSetup path, which we abort
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(
          workspaceRoot,
          { force: true },
          {
            emitService,
            questionSelect,
            questionInput,
          }
        );
      } catch {
        // expected — we aborted askLlmSetup
      }

      const aiDir = path.join(workspaceRoot, '.ai-team');
      const exists = async (p: string) =>
        fs.stat(p).then(
          () => true,
          () => false
        );

      // Preserved
      expect(await exists(path.join(aiDir, 'config.json'))).toBe(true);
      expect(await exists(path.join(aiDir, '.env'))).toBe(true);

      // Removed (including nested directory)
      expect(await exists(path.join(aiDir, 'README.md'))).toBe(false);
      expect(await exists(path.join(aiDir, 'agents'))).toBe(false);
      expect(await exists(path.join(aiDir, 'skills-catalog'))).toBe(false);

      // Verify "Removed:" messages emitted
      const messages = logMessages(events);
      expect(messages.some((m) => m.includes('Removed: README.md'))).toBe(true);
      expect(messages.some((m) => m.includes('Removed: agents'))).toBe(true);
      expect(messages.some((m) => m.includes('Removed: skills-catalog'))).toBe(true);
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
        apiKey: '${AI_TEAM_LLM_API_KEY}',
      });
    });

    it('asks LLM-reuse confirm BEFORE emitting "Welcome to AI Team!"', async () => {
      const { events, emitService } = createEventCollector();
      const questionConfirm = vi.fn().mockResolvedValue(true);
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(
          workspaceRoot,
          { force: true },
          {
            emitService,
            questionConfirm,
            questionInput,
          }
        );
      } catch {
        // expected
      }

      expect(questionConfirm).toHaveBeenCalledTimes(1);
      expect(questionConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Reuse existing default LLM connection'),
        })
      );

      // Critical ordering: confirm question event must precede "Welcome" log
      const allKinds = events.map((e) => {
        const messageValue = e.message ?? e.text;
        const msg = typeof messageValue === 'string' ? messageValue : '';
        return {
          kind: e.kind,
          msg,
        };
      });

      const confirmIdx = allKinds.findIndex(
        (e) => e.kind === 'question' && e.msg.includes('Reuse')
      );
      const welcomeIdx = allKinds.findIndex(
        (e) => e.kind === 'log' && e.msg.includes('Welcome to AI Team')
      );

      expect(confirmIdx).toBeGreaterThanOrEqual(0);
      expect(welcomeIdx).toBeGreaterThanOrEqual(0);
      expect(welcomeIdx).toBeGreaterThan(confirmIdx);
    });

    it('reuses existing OpenAI-compatible config when user confirms', async () => {
      const { events, emitService } = createEventCollector();
      const questionConfirm = vi.fn().mockResolvedValue(true);
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(
          workspaceRoot,
          { force: true },
          {
            emitService,
            questionConfirm,
            questionInput,
          }
        );
      } catch {
        // expected
      }

      const messages = logMessages(events);
      expect(messages.some((m) => m.includes('Reusing existing OpenAI-compatible'))).toBe(true);
    });

    it('runs fresh LLM setup when user declines reuse', async () => {
      const questionConfirm = vi.fn().mockResolvedValue(false);
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(
          workspaceRoot,
          { force: true },
          {
            questionConfirm,
            questionSelect,
            questionInput,
          }
        );
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
    it('emits log events through emitService for "Welcome to AI Team!"', async () => {
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
        apiKey: '${AI_TEAM_LLM_API_KEY}',
      });
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });

      const { events, emitService } = createEventCollector();
      const questionConfirm = vi.fn().mockResolvedValue(true);
      // Abort after LLM reuse so we don't need to mock the full onboarding flow
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(
          workspaceRoot,
          { force: true },
          {
            emitService,
            questionConfirm,
            questionInput,
          }
        );
      } catch {
        // expected — aborted during onboarding
      }

      const logs = events.filter((e) => e.kind === 'log');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((e) => String(e.message).includes('Welcome to AI Team'))).toBe(true);
    });

    it('all emitted events have a valid kind property', async () => {
      const { events, emitService } = createEventCollector();
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(workspaceRoot, {}, { emitService, questionSelect });
      } catch {
        // expected
      }

      expect(events.every((e) => typeof e.kind === 'string')).toBe(true);
    });
  });

  describe('workspace settings bootstrap', () => {
    beforeEach(() => {
      coreApi.loadTeamConfig.mockResolvedValue({
        version: '0.1.0',
        llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
      });
      coreApi.resolveEffectiveLlmSettings.mockReturnValue({
        config: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
        providerRef: 'openai',
      });
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });
    });

    it('creates .vscode/settings.json with required chat locations when missing', async () => {
      const questionConfirm = vi.fn().mockResolvedValue(true);
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(
          workspaceRoot,
          { force: true },
          {
            questionConfirm,
            questionInput,
          }
        );
      } catch {
        // expected — abort during onboarding after bootstrap work is done
      }

      const settingsPath = path.join(workspaceRoot, '.vscode', 'settings.json');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<
        string,
        Record<string, boolean>
      >;

      expect(settings['chat.promptFilesLocations']?.['.ai-team/prompts']).toBe(true);
      expect(settings['chat.instructionsFilesLocations']?.['.ai-team/instructions']).toBe(true);
      expect(settings['chat.hookFilesLocations']?.['.ai-team/hooks']).toBe(true);
      expect(settings['chat.agentFilesLocations']?.['.ai-team/agents']).toBe(true);
      expect(settings['chat.agentSkillsLocations']?.['.ai-team/skills']).toBe(true);
    });

    it('merges required chat locations into existing settings without overwriting siblings', async () => {
      await fs.mkdir(path.join(workspaceRoot, '.vscode'), { recursive: true });
      await fs.writeFile(
        path.join(workspaceRoot, '.vscode', 'settings.json'),
        JSON.stringify(
          {
            'files.associations': {
              '**/.ai-team/agents/*.agent.md': 'markdown',
            },
            'chat.promptFilesLocations': {
              '.existing/prompts': true,
            },
            'chat.agentFilesLocations': {
              '.existing/agents': true,
            },
            'chat.agentSkillsLocations': {
              '.existing/skills': true,
            },
          },
          null,
          4
        ),
        'utf-8'
      );

      const questionConfirm = vi.fn().mockResolvedValue(true);
      const questionInput = vi.fn().mockRejectedValue(new Error('abort'));

      try {
        await initCommand(
          workspaceRoot,
          { force: true },
          {
            questionConfirm,
            questionInput,
          }
        );
      } catch {
        // expected — abort during onboarding after bootstrap work is done
      }

      const settingsPath = path.join(workspaceRoot, '.vscode', 'settings.json');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<
        string,
        Record<string, boolean> | Record<string, string>
      >;

      expect(
        (settings['files.associations'] as Record<string, string>)['**/.ai-team/agents/*.agent.md']
      ).toBe('markdown');
      expect(
        (settings['chat.promptFilesLocations'] as Record<string, boolean>)['.existing/prompts']
      ).toBe(true);
      expect(
        (settings['chat.promptFilesLocations'] as Record<string, boolean>)['.ai-team/prompts']
      ).toBe(true);
      expect(
        (settings['chat.agentFilesLocations'] as Record<string, boolean>)['.existing/agents']
      ).toBe(true);
      expect(
        (settings['chat.agentFilesLocations'] as Record<string, boolean>)['.ai-team/agents']
      ).toBe(true);
      expect(
        (settings['chat.agentSkillsLocations'] as Record<string, boolean>)['.existing/skills']
      ).toBe(true);
      expect(
        (settings['chat.agentSkillsLocations'] as Record<string, boolean>)['.ai-team/skills']
      ).toBe(true);
      expect(
        (settings['chat.instructionsFilesLocations'] as Record<string, boolean>)[
          '.ai-team/instructions'
        ]
      ).toBe(true);
      expect(
        (settings['chat.hookFilesLocations'] as Record<string, boolean>)['.ai-team/hooks']
      ).toBe(true);
    });
  });

  describe('bootstrap compatibility docs', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
      coreApi.loadTeamConfig.mockResolvedValue({
        version: '0.1.0',
        llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
      });
      coreApi.resolveEffectiveLlmSettings.mockReturnValue({
        config: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
        providerRef: 'openai',
        apiKey: '${AI_TEAM_LLM_API_KEY}',
      });
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });
    });

    it('seeds generic AGENTS, copilot instructions, and ai-team doctrine files during init', async () => {
      const questionConfirm = vi.fn().mockResolvedValue(true);
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort-bootstrap-check'));

      await expect(
        initCommand(
          workspaceRoot,
          { force: true },
          {
            questionConfirm,
            questionSelect,
          }
        )
      ).rejects.toThrow('abort-bootstrap-check');

      const agentsMd = await fs.readFile(path.join(workspaceRoot, 'AGENTS.md'), 'utf-8');
      const copilotInstructions = await fs.readFile(
        path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
        'utf-8'
      );
      const aiTeamWay = await fs.readFile(
        path.join(workspaceRoot, '.ai-team', 'ai-team-way.md'),
        'utf-8'
      );
      const agentsInstructions = await fs.readFile(
        path.join(workspaceRoot, '.ai-team', 'instructions', 'agents.instructions.md'),
        'utf-8'
      );

      expect(agentsMd).toContain('.ai-team/ai-team-way.md');
      expect(copilotInstructions).toContain('thin compatibility bridge');
      expect(aiTeamWay).toContain('The ai-team Way');
      expect(agentsInstructions).toContain('ai-team agent portfolio authoring');
    });

    it('does not overwrite existing AGENTS.md or .github/copilot-instructions.md', async () => {
      await fs.mkdir(path.join(workspaceRoot, '.github'), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), 'existing agents file\n', 'utf-8');
      await fs.writeFile(
        path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
        'existing instructions file\n',
        'utf-8'
      );

      const questionConfirm = vi.fn().mockResolvedValue(true);
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort-preserve-check'));

      await expect(
        initCommand(
          workspaceRoot,
          { force: true },
          {
            questionConfirm,
            questionSelect,
          }
        )
      ).rejects.toThrow('abort-preserve-check');

      await expect(fs.readFile(path.join(workspaceRoot, 'AGENTS.md'), 'utf-8')).resolves.toBe(
        'existing agents file\n'
      );
      await expect(
        fs.readFile(path.join(workspaceRoot, '.github', 'copilot-instructions.md'), 'utf-8')
      ).resolves.toBe('existing instructions file\n');
    });
  });

  describe('bootstrap skills', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
      coreApi.loadTeamConfig.mockResolvedValue({
        version: '0.1.0',
        llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
      });
      coreApi.resolveEffectiveLlmSettings.mockReturnValue({
        config: {
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '${AI_TEAM_LLM_API_KEY}',
        },
        providerRef: 'openai',
        apiKey: '${AI_TEAM_LLM_API_KEY}',
      });
      coreApi.loadEnvFile.mockResolvedValue({ AI_TEAM_LLM_API_KEY: 'sk-test' });
      coreApi.testLlmConnection.mockResolvedValue({ success: true });
    });

    it('seeds the agent-authoring skill into .ai-team during init onboarding', async () => {
      const questionConfirm = vi.fn().mockResolvedValue(true);
      const questionSelect = vi.fn().mockRejectedValue(new Error('abort-name-pick'));

      await expect(
        initCommand(
          workspaceRoot,
          { force: true },
          {
            questionConfirm,
            questionSelect,
          }
        )
      ).rejects.toThrow('abort-name-pick');

      const skillPath = path.join(
        workspaceRoot,
        '.ai-team',
        'skills',
        'agent-authoring',
        'SKILL.md'
      );
      const skillContent = await fs.readFile(skillPath, 'utf-8');

      expect(skillContent).toContain('name: agent-authoring');
      expect(skillContent).toContain('Use this skill when the task is to create or improve:');
      expect(skillContent).toContain('`.ai-team/agents/*.md`');
    });

    it('creates founding agent .perm files during onboarding setup', async () => {
      const questionConfirm = vi
        .fn()
        // Reuse existing LLM config
        .mockResolvedValueOnce(true)
        // Use guided onboarding mode
        .mockResolvedValueOnce(true);

      const questionSelect = vi
        .fn()
        // CEO name
        .mockResolvedValueOnce('John Smith')
        // HR name
        .mockResolvedValueOnce('Emily Davis')
        // Guided business mode
        .mockResolvedValueOnce('greenfield');

      const questionChecklist = vi
        .fn()
        // Guided business priorities
        .mockResolvedValueOnce(['time-to-market', 'reliability'])
        // Guided business constraints
        .mockResolvedValueOnce(['small-team'])
        // Guided must-have hiring roles
        .mockResolvedValueOnce(['chief-architect']);

      const questionInput = vi.fn().mockRejectedValue(new Error('abort-after-access-seed'));

      await expect(
        initCommand(
          workspaceRoot,
          { force: true },
          {
            questionConfirm,
            questionSelect,
            questionChecklist,
            questionInput,
          }
        )
      ).rejects.toThrow('abort-after-access-seed');

      const ceoAccessPath = path.join(workspaceRoot, '.ai-team', 'agents', 'john-smith.perm');
      const hrAccessPath = path.join(workspaceRoot, '.ai-team', 'agents', 'emily-davis.perm');

      const ceoAccess = await fs.readFile(ceoAccessPath, 'utf-8');
      const hrAccess = await fs.readFile(hrAccessPath, 'utf-8');

      expect(ceoAccess).toContain('[read]');
      expect(ceoAccess).toContain('[write]');
      expect(ceoAccess).toContain('.ai-team/**/*');

      expect(hrAccess).toContain('[read]');
      expect(hrAccess).toContain('[write]');
      expect(hrAccess).toContain('.ai-team/skills-catalog/**/*');
    });
  });
});
