import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveEffectiveLlmSettings } from '@ai-team/core';
import {
  ensureAiTeamDirectory,
  loadTeamConfig,
  saveAgentAccessPatterns,
  testLlmConnection,
} from './init-compat.js';
import type { InitOptions } from '@ai-team/api-contracts';
import type { SessionManager } from '../../session-manager.js';
import type { InitRuntimeHooks } from './workflow-questions.js';
import {
  createBootstrapInstructions,
  createBootstrapSkills,
  createBootstrapTemplateFiles,
  createBootstrapWorkspaceFiles,
  createRoleTemplates,
} from './bootstrap-files.js';
import { runInitWorkflowAsync } from './init-workflow.js';
import type { IWorkflowRunnerFactory } from '../../workflow/runner.js';
import {
  getWorkspaceTemplatePath,
  INIT_TEMPLATE_FILE_MAP,
  loadInitTemplates,
  readDefaultTemplate,
  type InitTemplateKey,
} from './template-utils.js';
import { updateWorkspaceSettings } from './update-workspace-settings.js';
import type { OnboardICommand } from '../hr/onboard.js';
import type { SetupCommand } from '../setup/setup.js';
import type { TestConnectionCommand } from '../setup/test-connection.js';
import type { IEmitService } from '../../orchestrator/services/emit-service.js';
import { EmitService } from '../../orchestrator/services/emit-service.js';

const FORCE_KEEP = new Set(['config.json', '.env']);
const INIT_RUNTIME_ARTIFACTS = new Set(['agents', 'logs', 'private', '.ide-server.json']);

export interface InitCommandParams {
  workspaceRoot: string;
  options: InitOptions;
  injected?: { sessionManager?: SessionManager };
}

export class InitCommand {
  constructor(
    private readonly onboard: Pick<OnboardICommand, 'executeOnboarding'>,
    private readonly setup: SetupCommand,
    private readonly testConnection: TestConnectionCommand,
    private readonly runnerFactory: IWorkflowRunnerFactory
  ) {}

  async execute(params: InitCommandParams, hooks?: InitRuntimeHooks): Promise<void> {
    const { workspaceRoot, options } = params;

    await runInitWorkflowAsync(
      workspaceRoot,
      options,
      hooks,
      {
        onboard: {
          execute: (params, signal) => this.onboard.executeOnboarding(params, signal),
        },
        setup: this.setup,
        testConnection: this.testConnection,
      },
      this.runnerFactory
    );
  }
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

function slugifyAgentId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function describeResolvedProvider(effective: {
  config?: { provider?: string; baseUrl?: string };
  providerRef?: string;
}): string {
  if (effective.config?.provider === 'github-copilot') {
    return 'GitHub Copilot';
  }

  return `OpenAI-compatible (${effective.config?.baseUrl ?? 'custom base URL'})`;
}

class InitLegacyFlow {
  constructor(private readonly emitService: IEmitService) {}

  private writeLine(message: string) {
    this.emitService.log('info', message);
  }

  private writeWarn(message: string) {
    this.emitService.log('warn', message);
  }

  async clearAiTeamDirectory(workspaceRoot: string) {
    const aiTeamDir = path.join(workspaceRoot, '.ai-team');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(aiTeamDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (FORCE_KEEP.has(entry.name)) continue;
      const target = path.join(aiTeamDir, entry.name);
      try {
        await fs.rm(target, { recursive: true, force: true });
        this.writeLine(`  Removed: ${entry.name}`);
      } catch (err) {
        this.writeWarn(
          `  Could not remove ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  async handleExistingState(
    workspaceRoot: string,
    options: InitOptions,
    state: { aiTeamDir: string; hasAgentFiles: boolean; hasNonAgentArtifacts: boolean }
  ): Promise<boolean> {
    if (options.force) {
      if (state.hasAgentFiles || state.hasNonAgentArtifacts) {
        this.writeWarn(
          state.hasAgentFiles
            ? '  Force flag detected - reinitializing...'
            : '  Force flag detected - clearing existing AI Team scaffold...'
        );
        await this.clearAiTeamDirectory(workspaceRoot);
      }
      return true;
    }

    if (state.hasAgentFiles) {
      this.writeWarn('AI Team is already initialized in this workspace');
      this.writeLine(`  Location: ${state.aiTeamDir}`);
      this.writeLine('  Use --force to fully reinitialize team onboarding.');
      this.writeLine('  Skipping initialization.');
      return false;
    }

    if (state.hasNonAgentArtifacts) {
      this.writeWarn(
        `Found existing .ai-team scaffold without agents at ${state.aiTeamDir}; continuing initialization.`
      );
    }

    return true;
  }

  async tryReuseExistingLlm(
    options: InitOptions,
    existingResolved: ReturnType<typeof resolveEffectiveLlmSettings> | undefined,
    hooks: InitRuntimeHooks | undefined
  ): Promise<boolean> {
    if (!options.force || !existingResolved) return false;

    const providerRefLabel = existingResolved.providerRef ? ` [${existingResolved.providerRef}]` : '';
    this.writeLine(`  Current LLM: ${describeResolvedProvider(existingResolved)}${providerRefLabel}`);

    const questionParams = {
      message: 'Reuse existing default LLM connection?',
      default: true,
    };
    const reuse = (await hooks?.questionConfirm?.(questionParams)) ?? true;

    if (!reuse) return false;

    if (!existingResolved.config.apiKey) return false;

    const kind =
      existingResolved.config.provider === 'github-copilot'
        ? 'GitHub Copilot'
        : 'OpenAI-compatible';
    this.writeLine(`Reusing existing ${kind} connection.`);
    return true;
  }

  writeWelcomeAndVerify() {
    this.writeLine('');
    this.writeLine('Verifying LLM connection...');
  }

  writeWelcomeBanner() {
    this.writeLine('');
    this.writeLine('Welcome to AI Team!');
    this.writeLine("Let's set up your virtual development team.");
  }
}

async function bootstrapOnboardingAssets(workspaceRoot: string): Promise<void> {
  await createBootstrapTemplateFiles(workspaceRoot, {
    templateKeys: Object.keys(INIT_TEMPLATE_FILE_MAP) as InitTemplateKey[],
    readDefaultTemplate,
    getWorkspaceTemplatePath,
    writeFileIfMissing,
  });

  const templates = await loadInitTemplates(workspaceRoot);

  await createBootstrapWorkspaceFiles(workspaceRoot, templates, writeFileIfMissing);
  await createBootstrapInstructions(workspaceRoot, templates, writeFileIfMissing);
  await createBootstrapSkills(workspaceRoot, templates);
  await createRoleTemplates(workspaceRoot, templates);
}

async function runCompatibilityOnboarding(
  workspaceRoot: string,
  hooks: InitRuntimeHooks | undefined
): Promise<void> {
  await bootstrapOnboardingAssets(workspaceRoot);

  if (!hooks?.questionSelect && hooks?.questionInput) {
    await hooks.questionInput({
      message: 'Describe the product or team you want to set up:',
    });
    return;
  }

  const ceoName =
    (await hooks?.questionSelect?.({
      message: 'Name your CEO:',
      choices: [
        { name: 'John Smith', value: 'John Smith' },
        { name: 'Michael Brown', value: 'Michael Brown' },
        { name: 'Sarah Lee', value: 'Sarah Lee' },
      ],
    })) ?? 'Michael Brown';

  const hrName =
    (await hooks?.questionSelect?.({
      message: 'Name your HR leader:',
      choices: [
        { name: 'Emily Davis', value: 'Emily Davis' },
        { name: 'Jessica Miller', value: 'Jessica Miller' },
        { name: 'Olivia Martinez', value: 'Olivia Martinez' },
      ],
    })) ?? 'Emily Davis';

  await saveAgentAccessPatterns(workspaceRoot, slugifyAgentId(ceoName), {
    read: ['**/*'],
    write: ['.ai-team/**/*'],
  });

  await saveAgentAccessPatterns(workspaceRoot, slugifyAgentId(hrName), {
    read: ['**/*'],
    write: ['.ai-team/skills-catalog/**/*', '.ai-team/instructions/**/*', '.ai-team/roles/**/*'],
  });

  const useGuidedMode =
    (await hooks?.questionConfirm?.({
      message: 'Use guided onboarding mode?',
      default: true,
    })) ?? true;

  if (useGuidedMode) {
    await hooks?.questionSelect?.({
      message: 'Choose your business mode:',
      choices: [
        { name: 'Greenfield', value: 'greenfield' },
        { name: 'Modernize existing platform', value: 'modernize' },
        { name: 'Internal transformation', value: 'internal' },
      ],
    });

    await hooks?.questionChecklist?.({
      message: 'Choose your top business priorities:',
      choices: [
        { name: 'Time to market', value: 'time-to-market' },
        { name: 'Reliability', value: 'reliability' },
        { name: 'Cost efficiency', value: 'cost-efficiency' },
      ],
    });

    await hooks?.questionChecklist?.({
      message: 'Choose your main delivery constraints:',
      choices: [
        { name: 'Small team', value: 'small-team' },
        { name: 'Legacy integration', value: 'legacy-integration' },
        { name: 'Tight deadlines', value: 'tight-deadlines' },
      ],
    });

    await hooks?.questionChecklist?.({
      message: 'Choose must-have hiring roles:',
      choices: [
        { name: 'Chief Architect', value: 'chief-architect' },
        { name: 'Backend Lead', value: 'backend-lead' },
        { name: 'Frontend Lead', value: 'frontend-lead' },
      ],
    });
  }

  await hooks?.questionInput?.({
    message: 'Describe the product or business context for your founding team:',
  });
}

export async function initCommand(
  workspaceRoot: string,
  options: InitOptions = {},
  hooks?: InitRuntimeHooks
): Promise<void> {
  const emitService =
    hooks?.emitService ??
    EmitService.forConsole();
  const flow = new InitLegacyFlow(emitService);

  const state = await getInitState(workspaceRoot);
  const shouldContinue = await flow.handleExistingState(workspaceRoot, options, state);
  if (!shouldContinue) {
    return;
  }

  const existingResolved = await resolveExistingLlmConfig(workspaceRoot);
  const llmReady = await flow.tryReuseExistingLlm(options, existingResolved, hooks);

  if (!llmReady) {
    await ensureAiTeamDirectory(workspaceRoot);
    await hooks?.questionSelect?.({
      message: 'Choose your LLM provider:',
      choices: [
        { name: 'GitHub Copilot', value: 'github-copilot' },
        { name: 'OpenAI-compatible', value: 'openai-compatible' },
      ],
    });
  }

  flow.writeWelcomeAndVerify();
  await testLlmConnection(workspaceRoot);

  flow.writeWelcomeBanner();

  await updateWorkspaceSettings(workspaceRoot);
  await bootstrapOnboardingAssets(workspaceRoot);
  await runCompatibilityOnboarding(workspaceRoot, hooks);
}

async function getInitState(workspaceRoot: string): Promise<{
  aiTeamDir: string;
  hasAgentFiles: boolean;
  hasNonAgentArtifacts: boolean;
}> {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  let hasAgentFiles = false;
  let hasNonAgentArtifacts = false;
  try {
    const stats = await fs.stat(aiTeamDir);
    if (stats.isDirectory()) {
      const agentsDir = path.join(aiTeamDir, 'agents');

      try {
        const rootEntries = await fs.readdir(aiTeamDir, { withFileTypes: true });
        hasNonAgentArtifacts = rootEntries.some((entry) => !INIT_RUNTIME_ARTIFACTS.has(entry.name));
      } catch {
        hasNonAgentArtifacts = false;
      }

      try {
        const agentEntries = await fs.readdir(agentsDir);
        hasAgentFiles = agentEntries.some((entry) => entry.endsWith('.agent.md'));
      } catch {
        hasAgentFiles = false;
      }
    }
  } catch {
    // missing .ai-team is fine
  }

  return { aiTeamDir, hasAgentFiles, hasNonAgentArtifacts };
}

async function resolveExistingLlmConfig(
  workspaceRoot: string
): Promise<ReturnType<typeof resolveEffectiveLlmSettings> | undefined> {
  const existingConfig = await loadTeamConfig(workspaceRoot);
  if (!existingConfig) return undefined;
  try {
    return resolveEffectiveLlmSettings(existingConfig as any);
  } catch {
    return undefined;
  }
}
