import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveEffectiveLlmSettings } from '@ai-team/core';
import {
  ensureAiTeamDirectory,
  loadEnvFile,
  loadTeamConfig,
  saveAgentAccessPatterns,
  testLlmConnection,
} from './init-compat.js';
import type { InitOptions } from '@ai-team/api-contracts';
import type { SessionManager } from '../../session-manager.js';
import type { InitRuntimeHooks } from './workflow-questions.js';
import {
  requestChecklist,
  requestConfirm,
  requestInput,
  requestSelect,
} from './workflow-questions.js';
import {
  createBootstrapInstructions,
  createBootstrapSkills,
  createBootstrapTemplateFiles,
  createBootstrapWorkspaceFiles,
  createRoleTemplates,
} from './bootstrap-files.js';
import { runInitWorkflowAsync } from './init-workflow.js';
import {
  getWorkspaceTemplatePath,
  INIT_TEMPLATE_FILE_MAP,
  loadInitTemplates,
  readDefaultTemplate,
  type InitTemplateKey,
} from './template-utils.js';
import { updateWorkspaceSettings } from './update-workspace-settings.js';
import type { OnboardCommand } from '../hr/onboard.js';
import type { SetupCommand } from '../setup/setup.js';
import type { TestConnectionCommand } from '../setup/test-connection.js';

function writeLine(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'info', message });
  if (!hooks?.emit) process.stdout.write(`${message}\n`);
}

function writeWarn(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'warn', message });
  if (!hooks?.emit) process.stdout.write(`${message}\n`);
}

const FORCE_KEEP = new Set(['config.json', '.env']);
const INIT_RUNTIME_ARTIFACTS = new Set(['agents', 'logs', 'private', '.ide-server.json']);

async function clearAiTeamDirectory(workspaceRoot: string, hooks?: InitRuntimeHooks) {
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
      writeLine(hooks, `  Removed: ${entry.name}`);
    } catch (err) {
      writeWarn(
        hooks,
        `  Could not remove ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export interface InitCommandParams {
  workspaceRoot: string;
  options: InitOptions;
  injected?: { sessionManager?: SessionManager };
}

export class InitCommand {
  constructor(
    private readonly onboard: OnboardCommand,
    private readonly setup: SetupCommand,
    private readonly testConnection: TestConnectionCommand
  ) {}

  async execute(params: InitCommandParams, hooks?: InitRuntimeHooks): Promise<void> {
    const { workspaceRoot, options, injected } = params;

    await runInitWorkflowAsync(workspaceRoot, options, hooks, {
      writeLine,
      writeWarn,
      clearAiTeamDirectory,
      onboard: this.onboard,
      setup: this.setup,
      testConnection: this.testConnection,
      sessionManager: injected?.sessionManager,
    });
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
    await requestInput(hooks, {
      message: 'Describe the product or team you want to set up:',
    });
    return;
  }

  const ceoName = await requestSelect(hooks, {
    message: 'Name your CEO:',
    choices: [
      { name: 'John Smith', value: 'John Smith' },
      { name: 'Michael Brown', value: 'Michael Brown' },
      { name: 'Sarah Lee', value: 'Sarah Lee' },
    ],
  });

  const hrName = await requestSelect(hooks, {
    message: 'Name your HR leader:',
    choices: [
      { name: 'Emily Davis', value: 'Emily Davis' },
      { name: 'Jessica Miller', value: 'Jessica Miller' },
      { name: 'Olivia Martinez', value: 'Olivia Martinez' },
    ],
  });

  await saveAgentAccessPatterns(workspaceRoot, slugifyAgentId(ceoName), {
    read: ['**/*'],
    write: ['.ai-team/**/*'],
  });

  await saveAgentAccessPatterns(workspaceRoot, slugifyAgentId(hrName), {
    read: ['**/*'],
    write: ['.ai-team/skills-catalog/**/*', '.ai-team/instructions/**/*', '.ai-team/roles/**/*'],
  });

  const useGuidedMode = await requestConfirm(hooks, {
    message: 'Use guided onboarding mode?',
    default: true,
  });

  if (useGuidedMode) {
    await requestSelect(hooks, {
      message: 'Choose your business mode:',
      choices: [
        { name: 'Greenfield', value: 'greenfield' },
        { name: 'Modernize existing platform', value: 'modernize' },
        { name: 'Internal transformation', value: 'internal' },
      ],
    });

    await requestChecklist(hooks, {
      message: 'Choose your top business priorities:',
      choices: [
        { name: 'Time to market', value: 'time-to-market' },
        { name: 'Reliability', value: 'reliability' },
        { name: 'Cost efficiency', value: 'cost-efficiency' },
      ],
    });

    await requestChecklist(hooks, {
      message: 'Choose your main delivery constraints:',
      choices: [
        { name: 'Small team', value: 'small-team' },
        { name: 'Legacy integration', value: 'legacy-integration' },
        { name: 'Tight deadlines', value: 'tight-deadlines' },
      ],
    });

    await requestChecklist(hooks, {
      message: 'Choose must-have hiring roles:',
      choices: [
        { name: 'Chief Architect', value: 'chief-architect' },
        { name: 'Backend Lead', value: 'backend-lead' },
        { name: 'Frontend Lead', value: 'frontend-lead' },
      ],
    });
  }

  await requestInput(hooks, {
    message: 'Describe the product or business context for your founding team:',
  });
}

export async function initCommand(
  workspaceRoot: string,
  options: InitOptions = {},
  hooks?: InitRuntimeHooks
): Promise<void> {
  const state = await getInitState(workspaceRoot);
  const shouldContinue = await handleExistingState(workspaceRoot, options, hooks, state);
  if (!shouldContinue) {
    return;
  }

  const existingResolved = await resolveExistingLlmConfig(workspaceRoot);
  const llmReady = await tryReuseExistingLlm(options, existingResolved, workspaceRoot, hooks);

  if (!llmReady) {
    await ensureAiTeamDirectory(workspaceRoot);
    await requestSelect(hooks, {
      message: 'Choose your LLM provider:',
      choices: [
        { name: 'GitHub Copilot', value: 'github-copilot' },
        { name: 'OpenAI-compatible', value: 'openai-compatible' },
      ],
    });
  }

  writeLine(hooks, '');
  writeLine(hooks, 'Verifying LLM connection...');
  await testLlmConnection(workspaceRoot);

  writeLine(hooks, '');
  writeLine(hooks, 'Welcome to AI Team!');
  writeLine(hooks, "Let's set up your virtual development team.");

  await updateWorkspaceSettings(workspaceRoot);
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

async function handleExistingState(
  workspaceRoot: string,
  options: InitOptions,
  hooks: InitRuntimeHooks | undefined,
  state: { aiTeamDir: string; hasAgentFiles: boolean; hasNonAgentArtifacts: boolean }
): Promise<boolean> {
  if (options.force) {
    if (state.hasAgentFiles || state.hasNonAgentArtifacts) {
      writeWarn(
        hooks,
        state.hasAgentFiles
          ? '  Force flag detected - reinitializing...'
          : '  Force flag detected - clearing existing AI Team scaffold...'
      );
      await clearAiTeamDirectory(workspaceRoot, hooks);
    }
    return true;
  }

  if (state.hasAgentFiles) {
    writeWarn(hooks, 'AI Team is already initialized in this workspace');
    writeLine(hooks, `  Location: ${state.aiTeamDir}`);
    writeLine(hooks, '  Use --force to fully reinitialize team onboarding.');
    writeLine(hooks, '  Skipping initialization.');
    return false;
  }

  if (state.hasNonAgentArtifacts) {
    writeWarn(
      hooks,
      `Found existing .ai-team scaffold without agents at ${state.aiTeamDir}; continuing initialization.`
    );
  }

  return true;
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

async function tryReuseExistingLlm(
  options: InitOptions,
  existingResolved: ReturnType<typeof resolveEffectiveLlmSettings> | undefined,
  workspaceRoot: string,
  hooks: InitRuntimeHooks | undefined
): Promise<boolean> {
  if (!options.force || !existingResolved) return false;

  const providerRefLabel = existingResolved.providerRef ? ` [${existingResolved.providerRef}]` : '';
  writeLine(
    hooks,
    `  Current LLM: ${describeResolvedProvider(existingResolved)}${providerRefLabel}`
  );

  const reuse = await requestConfirm(hooks, {
    message: 'Reuse existing default LLM connection?',
    default: true,
  });

  if (!reuse) return false;

  const envVars = await loadEnvFile(workspaceRoot);
  const keyEnvVar = existingResolved.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
  const apiKey =
    envVars[keyEnvVar] ||
    envVars['AI_TEAM_LLM_API_KEY'] ||
    envVars['LLM_API_KEY'] ||
    envVars['OPENAI_API_KEY'];

  if (!apiKey) return false;

  writeLine(hooks, `Reusing existing ${describeResolvedProvider(existingResolved)} connection.`);
  return true;
}
