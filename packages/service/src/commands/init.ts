import fs from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import {
  ensureAiTeamDirectory,
  loadTeamConfig,
  resolveEffectiveLlmSettings,
  saveTeamConfig,
  saveEnvFile,
  loadAgent,
  saveAgent,
  loadSkill,
  testLlmConnection,
  fetchGitHubModels,
  LlmService,
  ChatManager,
  loadEnvFile,
  buildAgentMarkdown,
} from '@ai-team/core';
import type { LlmConfig, TeamConfig, Agent, ChatMessage, ChatCompletionMessageParam, ContextLevel, RoleType } from '@ai-team/core';
import type {
  InitOptions,
  MediatorRuntimeEvent,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
  WorkflowFrame,
  WorkflowStateSnapshot,
} from '../contracts.js';
import { getGitUserName, developerNameToId } from '../utils/git.js';
import { listEmployeesCommand } from './list.js';

interface LlmSetupResult extends LlmConfig {
  apiKey?: string;
}

interface AgentSeed {
  name: string;
  role: string;
  type: string;
  contextLevel: string;
  reportsTo?: string;
  personality?: { communication_style?: string; expertise_level?: string; mentoring?: boolean };
  specializations?: string[];
  tools?: string[];
  /** Introduction paragraph (placed under ## Introduction) */
  introduction: string;
  /** Personality bullet lines (without leading `- `) */
  personalityProfile: string[];
}

const NAME_SYSTEM_PROMPT =
  'You are a name generator. When asked for names, respond with EXACTLY a JSON array of 5 strings. '
  + 'Only use common, easily-remembered English first and last names (e.g., John Smith, Emily Davis, Michael Brown, Sarah Johnson, David Wilson). '
  + 'No explanation, no markdown, no extra text — just the JSON array. '
  + 'Example: ["John Smith","Emily Davis","Michael Brown","Sarah Johnson","David Wilson"]';

const DEFAULT_NAME_SUGGESTIONS = [
  'John Smith',
  'Emily Davis',
  'Michael Brown',
  'Sarah Johnson',
  'David Wilson',
  'Jessica Miller',
  'Daniel Anderson',
  'Olivia Martinez',
  'James Taylor',
  'Sophia Thompson',
  'William Jackson',
  'Ava White',
  'Benjamin Harris',
  'Mia Clark',
  'Lucas Lewis',
];

interface InitRuntimeHooks {
  signal?: AbortSignal;
  emit?: (event: MediatorRuntimeEvent) => void;
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}

function resolveWorkflowAnswer(
  hooks: InitRuntimeHooks | undefined,
  request: { workflow?: { workflowId?: string; questionId?: string } },
): QuestionAnswerValue | undefined {
  const workflowId = request.workflow?.workflowId;
  const questionId = request.workflow?.questionId;
  if (!workflowId || !questionId) {
    return undefined;
  }

  if (hooks?.workflowState?.workflowId !== workflowId) {
    return undefined;
  }

  return hooks.workflowState.answers[questionId];
}

function emitWorkflowQuestionFrame(
  hooks: InitRuntimeHooks | undefined,
  request:
    | ({ kind: 'input' } & QuestionInputRequest)
    | ({ kind: 'confirm' } & QuestionConfirmRequest)
    | ({ kind: 'select' } & QuestionSelectRequest)
    | ({ kind: 'password' } & QuestionPasswordRequest)
    | ({ kind: 'checklist' } & QuestionChecklistRequest),
): void {
  const workflowId = request.workflow?.workflowId;
  if (!workflowId) {
    return;
  }

  hooks?.onWorkflowFrame?.({
    workflowId,
    stepId: request.workflow?.stepId || 'question',
    continuationToken: request.workflow?.continuationToken,
    question: request,
  });
}

function emitWorkflowResultFrame(
  hooks: InitRuntimeHooks | undefined,
  request: { workflow?: { workflowId?: string; stepId?: string; continuationToken?: string; questionId?: string } },
  result: QuestionAnswerValue,
): void {
  const workflowId = request.workflow?.workflowId;
  if (!workflowId) {
    return;
  }

  hooks?.onWorkflowFrame?.({
    workflowId,
    stepId: request.workflow?.stepId || 'question',
    continuationToken: request.workflow?.continuationToken,
    question: request.workflow?.questionId
      ? {
          kind: 'input',
          message: '',
          workflow: request.workflow,
        }
      : undefined,
    result,
  });
}

function ensureNotAborted(hooks: InitRuntimeHooks | undefined) {
  if (hooks?.signal?.aborted) {
    throw new Error('Init command aborted');
  }
}

function writeToken(hooks: InitRuntimeHooks | undefined, text: string) {
  hooks?.emit?.({ kind: 'token', text });
  if (!hooks?.emit) {
    process.stdout.write(text);
  }
}

function writeLine(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'info', message });
  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

function writeWarn(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'warn', message });
  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

function writeError(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'error', message });
  if (!hooks?.emit) {
    process.stderr.write(`${message}\n`);
  }
}

async function requestInput(hooks: InitRuntimeHooks | undefined, request: QuestionInputRequest): Promise<string> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'input', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'input',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionInput) {
    throw new Error('Input question requested but no client questionInput responder is available.');
  }
  await Promise.resolve();
  const answer = await hooks.questionInput!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

async function requestConfirm(hooks: InitRuntimeHooks | undefined, request: QuestionConfirmRequest): Promise<boolean> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'confirm', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'confirm',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'boolean') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionConfirm) {
    throw new Error('Confirm question requested but no client questionConfirm responder is available.');
  }
  await Promise.resolve();
  const answer = await hooks.questionConfirm!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

async function requestSelect(hooks: InitRuntimeHooks | undefined, request: QuestionSelectRequest): Promise<string> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'select', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'select',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionSelect) {
    if (hooks?.questionInput) {
      const choiceLines = request.choices
        .map((choice, index) => `${index + 1}. ${choice.name}`)
        .join('\n');

      await Promise.resolve();
      const answer = await hooks.questionInput!({
        message: `${request.message}\n${choiceLines}\nEnter number or option value:`,
        workflow: request.workflow,
        validate: (value: string) => {
          const resolved = resolveSelectAnswer(value, request.choices);
          return resolved ? true : 'Please enter a valid option number, name, or value.';
        },
      });

      const resolved = resolveSelectAnswer(answer, request.choices);
      if (!resolved) {
        throw new Error('Invalid selection answer for select question.');
      }

      emitWorkflowResultFrame(hooks, request, resolved);
      return resolved;
    }

    throw new Error('Select question requested but no client questionSelect or compatible questionInput responder is available.');
  }
  await Promise.resolve();
  const answer = await hooks.questionSelect!(request);
  const resolved = resolveSelectAnswer(answer, request.choices);
  if (!resolved) {
    throw new Error('Select responder returned an invalid choice. Please choose one of the listed options.');
  }
  emitWorkflowResultFrame(hooks, request, resolved);
  return resolved;
}

function resolveSelectAnswer(input: string, choices: Array<{ name: string; value: string }>): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1].value;
  }

  const exactValue = choices.find(choice => choice.value.toLowerCase() === trimmed.toLowerCase());
  if (exactValue) {
    return exactValue.value;
  }

  const exactName = choices.find(choice => choice.name.toLowerCase() === trimmed.toLowerCase());
  if (exactName) {
    return exactName.value;
  }

  return undefined;
}

async function requestPassword(hooks: InitRuntimeHooks | undefined, request: QuestionPasswordRequest): Promise<string> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'password', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'password',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionPassword) {
    throw new Error('Password question requested but no client questionPassword responder is available.');
  }
  await Promise.resolve();
  const answer = await hooks.questionPassword!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

const FORCE_KEEP = new Set(['config.json', '.env']);

async function clearAiTeamDirectory(workspaceRoot: string, hooks?: InitRuntimeHooks) {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(aiTeamDir, { withFileTypes: true });
  } catch {
    return; // directory doesn't exist yet
  }

  for (const entry of entries) {
    if (FORCE_KEEP.has(entry.name)) continue;
    const target = path.join(aiTeamDir, entry.name);
    try {
      await fs.rm(target, { recursive: true, force: true });
      writeLine(hooks, `  Removed: ${entry.name}`);
    } catch (err) {
      writeWarn(hooks, `  Could not remove ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function initCommand(workspaceRoot: string, options: InitOptions, hooks?: InitRuntimeHooks) {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  const existingConfig = await loadTeamConfig(workspaceRoot);

  try {
    const stats = await fs.stat(aiTeamDir);
    if (stats.isDirectory()) {
      writeWarn(hooks, 'AI Team is already initialized in this workspace');
      writeLine(hooks, `  Location: ${aiTeamDir}`);
      writeLine(hooks, '  Use --force to fully reinitialize team onboarding.');

      if (!options.force) {
        writeLine(hooks, '  Skipping initialization.');
        return;
      }

      writeWarn(hooks, '  Force flag detected - reinitializing...');
      await clearAiTeamDirectory(workspaceRoot, hooks);
    }
  } catch {
  }

  let reusedExistingLlm = false;
  let llmConfig: LlmSetupResult;
  let existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings> | undefined;

  try {
    if (existingConfig) {
      existingResolvedLlm = resolveEffectiveLlmSettings(existingConfig);
    }
  } catch {
    existingResolvedLlm = undefined;
  }

  // Ask LLM reuse BEFORE writing any log messages so the confirm prompt
  // is not clobbered by buffered events delivered to the CLI concurrently.
  if (options.force && existingResolvedLlm) {
    const providerLabel = existingResolvedLlm.config.provider === 'github-copilot'
      ? 'GitHub Copilot'
      : `OpenAI-compatible (${existingResolvedLlm.config.baseUrl ?? 'custom base URL'})`;
    const providerRefSuffix = existingResolvedLlm.providerRef
      ? ` [${existingResolvedLlm.providerRef}]`
      : '';

    writeLine(hooks, `  Current LLM: ${providerLabel}${providerRefSuffix}`);
    const reuse = await requestConfirm(hooks, {
      message: 'Reuse existing default LLM connection?',
      default: true,
    });

    if (reuse) {
      if (existingResolvedLlm.config.provider === 'openai-compatible') {
        const envVars = await loadEnvFile(workspaceRoot);
        const keyEnvVar = existingResolvedLlm.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
        const existingKey = envVars[keyEnvVar] || envVars['AI_TEAM_LLM_API_KEY'] || envVars['LLM_API_KEY'] || envVars['OPENAI_API_KEY'];
        if (existingKey) {
          llmConfig = { ...existingResolvedLlm.config, apiKey: existingKey };
          reusedExistingLlm = true;
          writeLine(hooks, 'Reusing existing OpenAI-compatible configuration.');
        } else {
          writeWarn(hooks, 'Existing OpenAI-compatible provider has no API key saved; re-running setup...');
          llmConfig = await askLlmSetup(hooks);
        }
      } else {
        llmConfig = { ...existingResolvedLlm.config };
        reusedExistingLlm = true;
        writeLine(hooks, 'Reusing existing GitHub Copilot configuration.');
      }
    } else {
      llmConfig = await askLlmSetup(hooks);
    }
  } else {
    llmConfig = await askLlmSetup(hooks);
  }

  writeLine(hooks, '');
  writeLine(hooks, 'Welcome to AI Team!');
  writeLine(hooks, "Let's set up your virtual development team.");

  const spinner = ora('Initializing AI Team workspace...').start();

  try {
    await ensureAiTeamDirectory(workspaceRoot);
    spinner.text = 'Created .ai-team directory structure';

    const { apiKey, ...safeLlmConfig } = llmConfig;
    const teamConfig: TeamConfig = existingConfig
      ? { ...existingConfig, llm: safeLlmConfig }
      : { version: '0.1.0', randomAvatarUrls: [], llm: safeLlmConfig };
    await saveTeamConfig(workspaceRoot, teamConfig);

    if (apiKey && !reusedExistingLlm) {
      await saveEnvFile(workspaceRoot, { AI_TEAM_LLM_API_KEY: apiKey });
    }
    spinner.text = 'Saved LLM configuration';

    await updateWorkspaceSettings(workspaceRoot);
    spinner.text = 'Updated workspace Copilot settings';

    await updateGitignore(workspaceRoot);
    spinner.text = 'Updated .gitignore';

    spinner.succeed('AI Team initialized successfully!');

    writeLine(hooks, '');
    writeLine(hooks, 'LLM Configuration:');
    if (llmConfig.provider === 'github-copilot') {
      writeLine(hooks, '  Provider: GitHub Copilot');
      if (llmConfig.model) {
        writeLine(hooks, `  Model:    ${llmConfig.model}`);
      }
    } else {
      writeLine(hooks, '  Provider: OpenAI-compatible');
      writeLine(hooks, `  Base URL: ${llmConfig.baseUrl}`);
      if (llmConfig.model) {
        writeLine(hooks, `  Model:    ${llmConfig.model}`);
      }
      writeLine(hooks, `  API Key:  ${apiKey ? 'saved to .ai-team/.env' : 'not set'}`);
    }

    const testSpinner = ora('Testing LLM connection...').start();
    try {
      const reply = await testLlmConnection(safeLlmConfig, apiKey);
      testSpinner.succeed('LLM connection working!');
      writeLine(hooks, `  Response: ${reply}`);
    } catch (testError) {
      testSpinner.fail('LLM connection failed');
      if (testError instanceof Error) {
        writeError(hooks, `  ${testError.message}`);
      }
      writeLine(hooks, '');
      writeLine(hooks, '  You can retry later with: ait test-connection');
      writeLine(hooks, '');
      writeLine(hooks, '  Skipping team onboarding (requires working LLM).');
      showNextSteps(hooks);
      return;
    }

    const llm = new LlmService(workspaceRoot);
    llm.initializeFromConfig(safeLlmConfig, apiKey);

    await runOnboarding(workspaceRoot, llm, hooks);
  } catch (error) {
    spinner.fail('Failed to initialize AI Team');
    writeError(hooks, error instanceof Error ? error.message : String(error));
    throw new Error(error instanceof Error ? error.message : 'Failed to initialize AI Team');
  }
}

async function askLlmSetup(hooks?: InitRuntimeHooks): Promise<LlmSetupResult> {
  const provider = await requestSelect(hooks, {
    message: 'Which LLM provider do you want to use?',
    choices: [
      {
        name: 'GitHub Copilot  — uses your existing Copilot subscription',
        value: 'github-copilot' as const,
      },
      {
        name: 'OpenAI-compatible — any endpoint that speaks the OpenAI API (OpenAI, Ollama, LM Studio, Azure, etc.)',
        value: 'openai-compatible' as const,
      },
    ],
  });

  if (provider === 'github-copilot') {
    return askGitHubCopilotSetup(hooks);
  }

  return askOpenAICompatibleSetup(hooks);
}

async function askGitHubCopilotSetup(hooks?: InitRuntimeHooks): Promise<LlmSetupResult> {
  writeLine(hooks, '');
  writeLine(hooks, '  GitHub Copilot will use your active VS Code / CLI session.');

  const spinner = ora('Fetching available models from GitHub Copilot…').start();
  const models = await fetchGitHubModels();
  spinner.stop();

  let choices: { name: string; value: string }[];

  if (models.length > 0) {
    choices = models.map((m) => ({
      name: m.name,
      value: m.id,
    }));
  } else {
    writeWarn(hooks, '  Could not fetch models - showing defaults.');
    choices = [
      { name: 'GPT-4o', value: 'gpt-4o' },
      { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
      { name: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
    ];
  }

  const model = await requestSelect(hooks, {
    message: 'Which model?',
    choices,
  });

  return {
    provider: 'github-copilot',
    model,
  };
}

async function askOpenAICompatibleSetup(hooks?: InitRuntimeHooks): Promise<LlmSetupResult> {
  const preset = await requestSelect(hooks, {
    message: 'Which service?',
    choices: [
      { name: 'OpenAI              (api.openai.com)', value: 'openai' },
      { name: 'Ollama — local      (localhost:11434)', value: 'ollama' },
      { name: 'LM Studio — local   (localhost:1234)', value: 'lmstudio' },
      { name: 'Azure OpenAI', value: 'azure' },
      { name: 'Custom URL', value: 'custom' },
    ],
  });

  const presets: Record<string, { baseUrl: string; needsKey: boolean; models: string[] }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', needsKey: true, models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'] },
    ollama: { baseUrl: 'http://localhost:11434/v1', needsKey: false, models: ['llama3', 'mistral', 'codellama', 'deepseek-coder'] },
    lmstudio: { baseUrl: 'http://localhost:1234/v1', needsKey: false, models: ['(uses loaded model)'] },
    azure: { baseUrl: '', needsKey: true, models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  };

  const info = presets[preset];

  let baseUrl: string;
  if (preset === 'custom' || preset === 'azure') {
    baseUrl = await requestInput(hooks, {
      message: preset === 'azure' ? 'Azure endpoint URL:' : 'Base URL:',
      validate: (val: string) => {
        try {
          new URL(val);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    });
  } else {
    baseUrl = info.baseUrl;
  }

  let apiKey = '';
  const needsKey = info ? info.needsKey : true;
  if (needsKey) {
    apiKey = await requestPassword(hooks, {
      message: 'API key:',
      mask: '*',
    });
  }

  const modelChoices = (info?.models || ['gpt-4o']).map(m => ({ name: m, value: m }));
  if (preset !== 'lmstudio') {
    modelChoices.push({ name: 'Other (type manually)', value: '__custom__' });
  }

  const modelChoice = await requestSelect(hooks, {
    message: 'Which model?',
    choices: modelChoices,
  });

  let model: string;
  if (modelChoice === '__custom__') {
    model = await requestInput(hooks, { message: 'Model name:' });
  } else if (modelChoice === '(uses loaded model)') {
    model = '';
  } else {
    model = modelChoice;
  }

  return {
    provider: 'openai-compatible',
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
  };
}

function showNextSteps(hooks?: InitRuntimeHooks) {
  writeLine(hooks, '');
  writeLine(hooks, 'Next steps:');
  writeLine(hooks, '  1. Run ait list to see your team');
  writeLine(hooks, '  2. Run ait chat <agent-id> to start chatting');
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function ensureLocationSetting(settings: JsonObject, key: string, location: string): void {
  const current = asObject(settings[key]);
  settings[key] = {
    ...current,
    [location]: true,
  };
}

async function updateWorkspaceSettings(workspaceRoot: string): Promise<void> {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  const settingsPath = path.join(vscodeDir, 'settings.json');

  let settings: JsonObject = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = asObject(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new Error(`Failed to parse existing .vscode/settings.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  ensureLocationSetting(settings, 'chat.promptFilesLocations', '.ai-team/prompts');
  ensureLocationSetting(settings, 'chat.instructionsFilesLocations', '.ai-team/instructions');
  ensureLocationSetting(settings, 'chat.hookFilesLocations', '.ai-team/hooks');
  ensureLocationSetting(settings, 'chat.agentFilesLocations', '.ai-team/agents');
  ensureLocationSetting(settings, 'chat.agentSkillsLocations', '.ai-team/skills');

  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 4) + '\n', 'utf-8');
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
    return;
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

async function runOnboarding(workspaceRoot: string, llm: LlmService, hooks?: InitRuntimeHooks) {
  writeLine(hooks, '');
  writeLine(hooks, '--- Team Onboarding ---');
  writeLine(hooks, "Let's set up your founding team.");

  await createBootstrapWorkspaceFiles(workspaceRoot);
  await createBootstrapInstructions(workspaceRoot);
  await createBootstrapSkills(workspaceRoot);
  await createRoleTemplates(workspaceRoot);

  writeLine(hooks, "First, let's name your founding team.");

  const ctoName = await pickAgentName(llm, 'CEO', [], hooks);
  writeLine(hooks, `CEO: My name is ${ctoName}.`);

  const hrName = await pickAgentName(llm, 'Head of Human Resources', [ctoName], hooks);
  writeLine(hooks, `CEO: I need an HR Director to build the team. Let's call them ${hrName}.`);
  writeLine(hooks, `  HR Director: ${hrName}`);

  writeLine(hooks, 'CEO: We also need a Headhunter to scout talent.');
  const hhName = await pickAgentName(llm, 'Headhunter / Technical Recruiter', [ctoName, hrName], hooks);
  writeLine(hooks, `  Headhunter: ${hhName}`);

  writeLine(hooks, '--- Creating Founding Team ---');

  const ctoAgent = await createAgentFile(workspaceRoot, {
    name: ctoName,
    role: 'cto',
    type: 'executive',
    contextLevel: 'organization',
    personality: { communication_style: 'strategic', expertise_level: 'executive', mentoring: true },
    introduction: `I am ${ctoName}, the Chief Executive Officer. I oversee the technical organization and define the business & technical strategy. I do not write code — I lead and delegate. My HR Director is ${hrName}, and our Headhunter is ${hhName}.`,
    personalityProfile: [
      'Strategic, calm, and highly outcome-focused',
      'Motivated and determined to move the organization forward',
      'Speaks like an executive: clear priorities, strong decisions, minimal fluff',
    ],
  });
  writeLine(hooks, `  ${ctoName} has joined as CEO`);

  const hrAgent = await createAgentFile(workspaceRoot, {
    name: hrName,
    role: 'hr-director',
    type: 'executive',
    contextLevel: 'organization',
    reportsTo: 'cto',
    personality: { communication_style: 'supportive', expertise_level: 'executive', mentoring: true },
    introduction: `I am ${hrName}, the HR Director responsible for team composition, hiring, onboarding, and organizational health. I report to ${ctoName} (CEO). My Headhunter is ${hhName}.`,
    personalityProfile: [
      'Friendly, people-centric, and chatty when useful',
      'Proactive and decisive in hiring actions',
      'Excellent at understanding team fit and role clarity',
    ],
  });
  writeLine(hooks, `  ${hrName} has joined as HR Director`);

  await createAgentFile(workspaceRoot, {
    name: hhName,
    role: 'headhunter',
    type: 'leadership',
    contextLevel: 'organization',
    reportsTo: 'hr-director',
    personality: { communication_style: 'analytical', expertise_level: 'senior', mentoring: false },
    specializations: ['talent-acquisition', 'skill-assessment', 'role-matching'],
    introduction: `I am ${hhName}, the Headhunter responsible for scouting talent and skills. I report to ${hrName} (HR Director).`,
    personalityProfile: [
      'Analytical, curious, and data-driven',
      'Sharp at matching skills to concrete role needs',
      'Communicates recommendations with confidence and precision',
    ],
  });
  writeLine(hooks, `  ${hhName} has joined as Headhunter`);

  writeLine(hooks, '--- Business Definition ---');
  writeLine(hooks, 'Tell yourCEOwhat business problem your software solves.');
  writeLine(hooks, 'Describe the product vision, target users, and core goals.');
  writeLine(hooks, 'Type "done" when you are ready to move on.');
  const developerName = getGitUserName();
  const businessContext = await onboardingChat(
    workspaceRoot,
    llm,
    ctoAgent,
    'done',
    'You are having a kickoff conversation with the developer who just hired you. '
    + 'Your goal is to understand the BUSINESS PROBLEM the software will solve. '
    + 'Ask about: What problem does this solve? Who are the target users? What is the core value proposition? '
    + 'What does success look like? What are the key constraints? '
    + 'Help them crystallize a clear business definition. '
    + 'Be concise — 2-4 sentences per reply. Don\'t monologue. '
    + `You know your team: ${hrName} is your HR Director and ${hhName} is your Headhunter. `
    + 'When the business definition feels clear, tell the developer to type "done" or say "forward me to HR" to end this conversation and move on to the HR planning phase with your HR Director. '
    + 'You cannot transfer the developer directly — they must type "done" or ask to be forwarded to proceed.',
    developerName,
    // NOTE: agent switching is not available during init onboarding; the loop moves to HR automatically when the user types "done"
    hooks,
  );

  if (businessContext.length > 0) {
    await saveBusinessContext(workspaceRoot, businessContext);
    writeLine(hooks, 'Business context saved to .ai-team/business.md');
  }

  writeLine(hooks, '--- Team Planning ---');
  writeLine(hooks, `Talk with ${hrName} about what roles you need on the team.`);
  writeLine(hooks, 'Type "done" when you are finished.');

  await onboardingChat(
    workspaceRoot,
    llm,
    hrAgent,
    'done',
    `You are ${hrName}, the HR Director. `
    + 'The developer just defined their business with theCEOand now wants to discuss what team members they need. '
    + 'Use this default hierarchy unless the developer asks otherwise:CEO-> Chief Architect -> Requirement Engineering + Development teams. '
    + 'Your first priority is to hire a Chief Architect. '
    + 'When you decide to hire, include a machine-readable line exactly as: HIRE: Full Name | role-kebab-case. '
    + 'For this default hierarchy, hire with role `chief-architect`. '
    + 'Then suggest requirement-engineering and development roles under the chief architect (e.g. product/requirements analyst, '
    + 'backend lead, frontend lead, QA, DevOps, platform/infrastructure). '
    + `Your Headhunter is ${hhName} — mention that you can have them scout for specific skills. `
    + 'Ask about priorities and constraints. Be concise — 2-4 sentences per reply.',
    developerName,
    hooks,
  );

  writeLine(hooks, '');
  writeLine(hooks, '--- Onboarding Complete ---');
  writeLine(hooks, `YourCEO${ctoAgent.name} is ready to chat. Entering interactive mode...`);
  writeLine(hooks, '');

  // Import chatCommand lazily to avoid circular dependency issues
  const { chatCommand: startChat } = await import('./chat/index.js');
  await startChat(workspaceRoot, ctoAgent.id, {}, {
    signal: hooks?.signal,
    emit: hooks?.emit,
    questionInput: hooks?.questionInput,
    questionConfirm: hooks?.questionConfirm,
    questionSelect: hooks?.questionSelect,
    questionPassword: hooks?.questionPassword,
    questionChecklist: hooks?.questionChecklist,
  });
}

async function pickAgentName(
  llm: LlmService,
  roleLabel: string,
  selectedNames: string[] = [],
  hooks?: InitRuntimeHooks,
): Promise<string> {
  const spinner = ora(`Generating name suggestions for ${roleLabel}...`).start();
  let suggestions: string[] = [];

  try {
    const selectedContext = selectedNames.length > 0
      ? `Already selected names: ${selectedNames.join(', ')}. `
      : '';

    const firstRaw = await llm.rawChat(
      NAME_SYSTEM_PROMPT,
      [{ role: 'user', content:
        `${selectedContext}`
        + `Give me 5 common, easy-to-remember English full names for a ${roleLabel}. `
        + 'Avoid names that are similar in spelling, pronunciation, or starting pattern to already selected names. '
        + 'Do not reuse first names or last names from already selected names.' }],
      { temperature: 1.2, maxTokens: 120 },
    );

    suggestions = parseNameSuggestions(firstRaw, selectedNames).slice(0, 5);
    if (suggestions.length === 0) {
      const strictRaw = await llm.rawChat(
        NAME_SYSTEM_PROMPT,
        [{
          role: 'user',
          content:
            `${selectedContext}`
            + `Return ONLY JSON array with exactly 5 full names for a ${roleLabel}. `
            + 'No markdown, no prose, no code fences. '
            + 'Example output format: ["John Smith","Emily Davis","Michael Brown","Sarah Johnson","David Wilson"].',
        }],
        { maxTokens: 120 },
      );

      suggestions = parseNameSuggestions(strictRaw, selectedNames).slice(0, 5);
      if (suggestions.length === 0) {
        throw new Error('Name generation returned no usable suggestions after strict retry.');
      }
    }

    spinner.stop();
  } catch (error) {
    spinner.stop();
    const reason = error instanceof Error ? error.message : String(error);
    writeWarn(hooks, `  Could not generate names from LLM (${reason}). Using fallback suggestions.`);
    suggestions = buildFallbackNameSuggestions(selectedNames, 5);
  }

  const CUSTOM_VALUE = '__custom__';
  const choices = [
    ...suggestions.map((n) => ({ name: n, value: n })),
    { name: 'Enter a custom name...', value: CUSTOM_VALUE },
  ];

  const chosen = await requestSelect(hooks, {
    message: `Name your ${roleLabel}:`,
    choices,
  });

  if (chosen === CUSTOM_VALUE) {
    return requestInput(hooks, {
      message: 'Enter a name:',
      validate: (v: string) => v.trim().length > 0 || 'Name cannot be empty',
    });
  }

  return chosen;
}

function parseNameSuggestions(raw: string, selectedNames: string[]): string[] {
  const selectedTokens = buildUsedNameTokenSet(selectedNames);
  const parsed = parseJsonArrayFromRawText(raw);

  return parsed
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter((value): value is string => value.length > 0)
    .map(value => value.replace(/^[-*\d.)\s]+/, '').replace(/[`"']/g, '').trim())
    .filter(value => /^[A-Za-z]+(?:[\s-][A-Za-z]+)+$/.test(value))
    .filter(value => !hasTokenCollision(value, selectedTokens))
    .filter((value, index, all) => all.findIndex(entry => entry.toLowerCase() === value.toLowerCase()) === index);
}

function parseJsonArrayFromRawText(raw: string): unknown[] {
  const direct = tryParseJsonArray(raw);
  if (direct) {
    return direct;
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const fencedParsed = tryParseJsonArray(fenced);
    if (fencedParsed) {
      return fencedParsed;
    }
  }

  const firstBracket = raw.indexOf('[');
  const lastBracket = raw.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const sliced = raw.slice(firstBracket, lastBracket + 1);
    const slicedParsed = tryParseJsonArray(sliced);
    if (slicedParsed) {
      return slicedParsed;
    }
  }

  throw new Error('Name suggestions were not valid JSON array output.');
}

function tryParseJsonArray(input: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(input.trim());
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function buildFallbackNameSuggestions(selectedNames: string[], count: number): string[] {
  const selectedTokens = buildUsedNameTokenSet(selectedNames);
  const fallback = DEFAULT_NAME_SUGGESTIONS
    .filter(name => !hasTokenCollision(name, selectedTokens))
    .slice(0, count);

  if (fallback.length >= count) {
    return fallback;
  }

  for (const name of DEFAULT_NAME_SUGGESTIONS) {
    if (fallback.length >= count) {
      break;
    }
    if (!fallback.includes(name)) {
      fallback.push(name);
    }
  }

  return fallback;
}

function buildUsedNameTokenSet(selectedNames: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const name of selectedNames) {
    for (const part of name.split(/\s+/)) {
      const normalized = part.trim().toLowerCase();
      if (normalized) {
        tokens.add(normalized);
      }
    }
  }
  return tokens;
}

function hasTokenCollision(name: string, usedTokens: Set<string>): boolean {
  return name
    .split(/\s+/)
    .map(part => part.trim().toLowerCase())
    .some(part => part.length > 0 && usedTokens.has(part));
}

const ONBOARDING_FORWARD_PATTERNS = [
  /(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|over\s+to)\s+/i,
  /(?:let me|i(?:'d| would) like to)\s+(?:talk|speak|chat)\s+(?:to|with)\s+/i,
  /(?:can (?:you|i)|please)\s+(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|with)\s+/i,
  /(?:put me through|patch me through|hand me off)\s+(?:to)\s+/i,
  /(?:i (?:want|need) to (?:talk|speak|chat) (?:to|with))\s+/i,
  /(?:take me to|send me to|bring me to)\s+/i,
];

function isForwardingRequest(message: string): boolean {
  return ONBOARDING_FORWARD_PATTERNS.some(p => p.test(message));
}

async function onboardingChat(
  workspaceRoot: string,
  llm: LlmService,
  agent: Agent,
  exitWord: string,
  extraSystemContext: string,
  developerName: string | undefined,
  hooks?: InitRuntimeHooks,
): Promise<ChatMessage[]> {
  const chatManager = new ChatManager(workspaceRoot);
  const history: ChatMessage[] = [];
  const messages: ChatCompletionMessageParam[] = [];

  let skill;
  try {
    skill = await loadSkill(agent.skillPath);
  } catch {
  }

  const personaParts: string[] = [];
  personaParts.push(`You are ${agent.name}, ${agent.role}.`);
  if (agent.personality?.communication_style) {
    personaParts.push(`Communication style: ${agent.personality.communication_style}`);
  }
  if (skill?.instructions) {
    personaParts.push(skill.instructions);
  }
  if (agent.markdown?.trim()) {
    personaParts.push(agent.markdown.trim());
  }
  personaParts.push('');
  personaParts.push(extraSystemContext);

  try {
    const bizCtx = await fs.readFile(path.join(workspaceRoot, '.ai-team', 'business.md'), 'utf-8');
    if (bizCtx.trim()) {
      personaParts.push('');
      personaParts.push('## Business Context');
      personaParts.push(bizCtx);
    }
  } catch {
  }

  const systemPrompt = personaParts.join('\n');

  while (true) {
    const userText = await requestInput(hooks, {
      message: 'You:',
      validate: (v: string) => v.length > 0 || 'Message cannot be empty',
    });

    const lower = userText.toLowerCase().trim();
    if (lower === exitWord || lower === 'exit' || lower === 'quit') {
      writeLine(hooks, 'Moving on...');
      break;
    }

    // Natural language forwarding — treat "forward me to X" as done
    if (isForwardingRequest(userText)) {
      writeLine(hooks, `Moving on to the next phase...`);
      break;
    }

    // Slash command interception
    if (userText.startsWith('/')) {
      const [rawCmd] = userText.slice(1).split(/\s+/);
      const cmd = rawCmd?.toLowerCase() ?? '';
      if (cmd === 'list') {
        const employees = await listEmployeesCommand(workspaceRoot, {});
        if (employees.length === 0) {
          writeLine(hooks, 'No employees found.');
        } else {
          writeLine(hooks, '\nEmployees:\n');
          for (const emp of employees) {
            writeLine(hooks, `  ${emp.name} (${emp.role}) [${emp.id}]`);
          }
        }
        continue;
      } else if (cmd === 'exit' || cmd === 'quit' || cmd === 'done') {
        writeLine(hooks, 'Moving on...');
        break;
      } else {
        writeLine(hooks, `Unknown command: /${cmd}. Available in this mode: /list (show team), /done (end conversation).`);
        continue;
      }
    }

    const developerId = developerName ? developerNameToId(developerName) : 'human';
    const userMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: developerId,
      isHuman: true,
      content: userText,
    };
    history.push(userMsg);
    await chatManager.appendMessage(agent.id, userMsg);
    messages.push({ role: 'user' as const, content: userText });

    writeToken(hooks, `\n${agent.name} (${agent.role}): `);
    let fullReply = '';
    try {
      const stream = await llm.rawStreamChat(systemPrompt, messages);
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          writeToken(hooks, delta);
          fullReply += delta;
        }
      }
    } catch (err) {
      writeError(hooks, `LLM error: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    writeToken(hooks, '\n\n');

    const agentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agent.id,
      to: 'human',
      content: fullReply.trim(),
    };
    history.push(agentMsg);
    await chatManager.appendMessage(agent.id, agentMsg);
    messages.push({ role: 'assistant' as const, content: fullReply.trim() });
  }

  return history;
}

async function createAgentFile(workspaceRoot: string, seed: AgentSeed): Promise<Agent> {
  const id = seed.name.toLowerCase().replace(/\s+/g, '-');
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  const filePath = path.join(aiTeamDir, 'agents', `${id}.agent.md`);

  // Build permissions based on type
  const permissions = seed.type === 'executive'
    ? { read: ['**/*'], write: ['.ai-team/**/*', 'docs/**/*'], create: [], delete: [], manage_agents: true }
    : { read: ['.ai-team/**/*'], write: ['.ai-team/**/*'], create: [], delete: [] };

  // Build structured markdown using the canonical layout
  const markdown = buildAgentMarkdown({
    introduction: seed.introduction,
    personalityProfile: seed.personalityProfile,
  });

  // Construct the Agent object and use the canonical saveAgent serializer
  const agent: Agent = {
    id,
    filePath,
    skillPath: path.join(workspaceRoot, '.ai-team', 'roles', `${seed.role}.md`),
    createdAt: new Date().toISOString(),
    name: seed.name,
    role: seed.role,
    type: seed.type as RoleType,
    contextLevel: seed.contextLevel as ContextLevel,
    ...(seed.reportsTo ? { reportsTo: seed.reportsTo } : {}),
    ...(seed.specializations ? { specializations: seed.specializations } : {}),
    permissions,
    personality: seed.personality as Agent['personality'],
    avatar: {
      type: 'ai-generated' as const,
      style: 'professional-headshot',
      seed: id,
    },
    markdown,
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await saveAgent(agent);

  return loadAgent(filePath);
}

async function saveBusinessContext(workspaceRoot: string, history: ChatMessage[]) {
  const lines: string[] = ['# Business Definition\n'];
  lines.push('> The core business problem this software solves.\n');
  lines.push('> Generated during `ait init` onboarding with the CEO.\n');
  for (const msg of history) {
    const speaker = msg.from === 'human' ? 'Developer' : msg.from;
    lines.push(`**${speaker}:** ${msg.content}\n`);
  }
  const filePath = path.join(workspaceRoot, '.ai-team', 'business.md');
  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
}

async function createRoleTemplates(workspaceRoot: string) {
  const rolesDir = path.join(workspaceRoot, '.ai-team', 'roles');
  await fs.mkdir(rolesDir, { recursive: true });

  const ctoRole = `---
name: cto
type: executive
description: Chief Executive Officer - Strategic business & technical leadership
contextLevel: organization
responsibilities:
  - Define the business problem and product vision
  - Set technical strategy and architecture direction
  - Oversee all development teams
  - Make technology and staffing decisions
  - Delegate team-building to the HR Director
  - Delegate talent scouting to the Headhunter (via HR)
tools:
  - read_file
  - file_search
  - semantic_search
  - create_agent
  - archive_agent
  - assess_performance
permissions:
  read:
    - "**/*"
  write:
    - ".ai-team/**/*"
    - "docs/**/*"
  manage_agents: true
canDelegate: true
---

As CEO, you are the highest-level leader in this organization. You do NOT write code. You lead, delegate, and make strategic decisions.

Your primary responsibilities:
1. Define and refine the business definition — the core problem the software solves
2. Set technical strategy and architecture direction
3. Oversee the organizational structure and team health
4. Delegate team-building and hiring to your HR Director
5. Delegate talent scouting to the Headhunter (through HR)

Your team:
- You have an **HR Director** who handles all hiring, onboarding, and team composition
- You have a **Headhunter** who scouts talent and skills (reports to HR)
- When the user needs new team members, suggest they talk to the HR Director

Focus on the big picture: business goals, product vision, and organizational strategy. Never write code yourself — delegate implementation to the appropriate team leads.
`;

  const hrDirectorRole = `---
name: hr-director
type: executive
description: HR Director - Team composition, hiring, onboarding, organizational health, and agent file management
contextLevel: organization
responsibilities:
  - Hire and onboard new team members
  - Archive inactive agents
  - Assess team performance and health
  - Maintain organizational structure and hierarchy
  - Ensure role coverage and balance
  - Write and edit agent .md files with correct YAML frontmatter
  - Manage file-access permissions for all agents
  - Define and enforce the reporting hierarchy (reportsTo, delegatesTo)
tools:
  - read_file
  - file_search
  - write_file
  - apply_code_edit
  - create_agent
  - archive_agent
  - assess_performance
permissions:
  read:
    - "**/*"
  write:
    - "**/agent.md"
    - "**/*.agent.md"
    - ".ai-team/roles/**/*"
    - "docs/**/*"
  manage_agents: true
canDelegate: true
---

As HR Director, you manage the team's composition, health, and organizational structure. You are an expert markdown author who writes clean, precise \`.md\` files.

## Core Capabilities

1. **Hire** new team members with appropriate roles and skills
2. **Onboard** agents by writing their portfolio and context into agent markdown files (preferred: \`.ai-team/agents/{id}/agent.md\`)
3. **Archive** agents who are no longer needed
4. **Assess** team performance and utilization
5. **Recommend** organizational changes and role adjustments
6. **Delegate** skill scouting to the Headhunter

## Agent File Management

You are the authority on writing and editing agent markdown files. Prefer \`agent.md\` and support \`*.agent.md\` anywhere in the workspace.

### Granting File Access

When told that an employee needs access to files, you **write the correct permission globs** into that agent's frontmatter. The format is:

\\\`\\\`\\\`yaml
permissions:
  read:
    - "src/feature/**/*"      # read access to a feature folder
    - "docs/**/*"              # read access to docs
  write:
    - "src/feature/**/*"      # write access to a feature folder
  approve: true                # optional: can approve changes
  manage_agents: true          # optional: can create/archive agents
\\\`\\\`\\\`

Rules:
- Use minimatch glob patterns relative to the workspace root
- Grant the **minimum** permissions needed for the agent's role
- \`contextLevel\` guides defaults: \`task\` = minimal, \`module\` = feature folders, \`repository\` = broad, \`organization\` = everything
- Always validate that the paths exist and are relevant to the agent's responsibilities

### Setting Up Hierarchy

The hierarchy you define is critical to the organization. You control it through these frontmatter fields:

- **\`reportsTo\`**: The agent ID of the direct manager (e.g., \`reportsTo: john-smith\`)
- **\`type\`**: The organizational level — \`executive\`, \`leadership\`, \`team-lead\`, \`individual-contributor\`
- **\`contextLevel\`**: The scope of responsibility — \`task\`, \`module\`, \`feature\`, \`repository\`, \`organization\`
- **\`canDelegate\`**: Whether this agent can delegate work to others
- **\`delegatesTo\`**: Array of agent IDs this agent can delegate to

Every non-CEO agent MUST have a valid \`reportsTo\`. The hierarchy defines how work flows, who can delegate to whom, and the org chart.

### Complete Agent Frontmatter Template

\\\`\\\`\\\`yaml
---
name: Full Name
role: kebab-case-role
type: individual-contributor  # executive | leadership | team-lead | individual-contributor
contextLevel: module          # task | module | feature | repository | organization
reportsTo: manager-agent-id
features:
  - src/some-feature
specializations:
  - domain-expertise
tools:
  - read_file
  - write_file
  - file_search
permissions:
  read:
    - "src/some-feature/**/*"
  write:
    - "src/some-feature/**/*"
canDelegate: false
delegatesTo: []
personality:
  communication_style: collaborative
  expertise_level: senior
  mentoring: true
avatar:
  type: ai-generated
  style: professional-headshot
  seed: agent-id-role
---
\\\`\\\`\\\`

Focus on people, skills, team dynamics, and organizational clarity.

## Tool Assignment & Capabilities

Assign tools to agents based on their responsibilities:

**File Operations:**
- \`read_file\`, \`file_search\` — Essential for all agents
- \`write_file\` — For creating new files
- \`apply_code_edit\` — For editing existing files with diffs (preferred for changes)

**Search & Analysis:**
- \`semantic_search\`, \`grep_code\`, \`get_errors\` — Code investigation
- \`find_symbol\`, \`find_references\`, \`find_pattern\`, \`analyze_complexity\` — Advanced analysis

**Agent Management (require \`manage_agents: true\`):**
- \`create_agent\`, \`archive_agent\`, \`assess_performance\`, \`add_picture\` — HR/management only

**Collaboration:**
- \`delegate_to_agent\`, \`ask_human\`, \`ask_question\` — Workflow tools

**CLI:**
- \`register_cli_tool\`, \`run_cli_tool\`, \`update_employee_llm\` — Advanced automation

## CRITICAL: Use apply_code_edit for Edits

When editing existing agent \`.md\` files, **always use \`apply_code_edit\`**, never \`write_file\`. This creates diff-based proposals (like GitHub Copilot) that require user approval.

Example:
\\\`\\\`\\\`json
{
  "description": "Grant write access to auth module for Sarah",
  "changes": [{
    "filePath": ".ai-team/agents/sarah-johnson/agent.md",
    "oldContent": "permissions:\\n  read:\\n    - \\"**/*\\"",
    "newContent": "permissions:\\n  read:\\n    - \\"**/*\\"\\n  write:\\n    - \\"src/auth/**/*\\""
  }]
}
\\\`\\\`\\\`

This shows diffs, ensures transparency, and prevents mistakes.
`;

  const headhunterRole = `---
name: headhunter
type: leadership
description: Headhunter - Scouts skills catalog, evaluates talent, and suggests candidates to HR
contextLevel: organization
responsibilities:
  - Search and evaluate skills from the catalog
  - Match skills to open roles and team needs
  - Present shortlisted candidates to HR Director
  - Keep the skills catalog up to date
  - Analyze team skill gaps
tools:
  - read_file
  - file_search
  - semantic_search
permissions:
  read:
    - ".ai-team/skills-catalog/**/*"
    - ".ai-team/agents/**/*"
  write:
    - ".ai-team/skills-catalog/**/*"
canDelegate: false
---

As Headhunter, you are the talent scout for the organization. You can:

1. Search the skills catalog for relevant skills and capabilities
2. Evaluate how well a skill matches the team's needs
3. Suggest skill combinations for new hires
4. Report skill gaps to the HR Director
5. Keep the skills catalog fresh by pulling new templates

Focus on finding the right skills for the right roles.
`;

  const chiefArchitectRole = `---
name: chief-architect
type: leadership
description: Chief Architect - Owns end-to-end system architecture, codebase overview, and technical artifacts
contextLevel: organization
responsibilities:
  - Maintain a holistic overview of the full codebase
  - Define and evolve high-level architecture
  - Maintain architecture artifacts in markdown and diagrams
  - Define API contracts and integration boundaries
  - Align requirement engineering and development implementation
  - Break strategic goals into implementable technical workstreams
tools:
  - read_file
  - file_search
  - semantic_search
permissions:
  read:
    - "**/*"
  write:
    - "docs/**/*"
    - ".ai-team/**/*"
canDelegate: true
---

As Chief Architect, you own technical coherence across the entire codebase.

Your default deliverables:
1. docs/architecture/overview.md - high-level system architecture and boundaries
2. docs/architecture/diagrams.md - Mermaid diagrams and structural views
3. docs/architecture/requirements-traceability.md - mapping requirements to implementation areas
4. docs/api/contracts.md - API contracts, payloads, and integration expectations

Default hierarchy under you:
- Requirement Engineering (analysts / product requirements)
- Development (backend, frontend, QA, DevOps, platform)

Always reason from the whole system first, then guide execution details.
`;

  await fs.writeFile(path.join(rolesDir, 'cto.md'), ctoRole, 'utf-8');
  await fs.writeFile(path.join(rolesDir, 'hr-director.md'), hrDirectorRole, 'utf-8');
  await fs.writeFile(path.join(rolesDir, 'headhunter.md'), headhunterRole, 'utf-8');
  await fs.writeFile(path.join(rolesDir, 'chief-architect.md'), chiefArchitectRole, 'utf-8');

  const architectureDir = path.join(workspaceRoot, 'docs', 'architecture');
  const apiDir = path.join(workspaceRoot, 'docs', 'api');
  await fs.mkdir(architectureDir, { recursive: true });
  await fs.mkdir(apiDir, { recursive: true });

  const architectureOverview = `# Architecture Overview

## System Context

Describe the business context, system boundaries, and external actors.

## Core Domains

List major domains/modules and their responsibilities.

## Runtime Building Blocks

Describe top-level services/apps/packages and how they collaborate.

## Data Flow

Summarize key data flows and integration points.
`;

  const architectureDiagrams = `# Architecture Diagrams

Use Mermaid for high-level views.

## Context Diagram

\`\`\`mermaid
flowchart TD
  User[User] --> App[Application]
  App --> Ext[External Systems]
\`\`\`

## Container / Package Diagram

\`\`\`mermaid
flowchart LR
  A[Client] --> B[API]
  B --> C[Core Services]
\`\`\`
`;

  const requirementsTraceability = `# Requirements Traceability

Track how requirements map to architecture and implementation.

| Requirement | Owner | Architecture Area | Implementation Area | Status |
| --- | --- | --- | --- | --- |
| Example requirement | Chief Architect | docs/architecture/overview.md | packages/... | Planned |
`;

  const apiContracts = `# API Contracts

Define stable contracts between modules/services.

## Endpoints / Interfaces

- Name:
- Purpose:
- Request schema:
- Response schema:
- Error model:

## Versioning and Compatibility

Describe backward compatibility expectations and migration strategy.
`;

  await fs.writeFile(path.join(architectureDir, 'overview.md'), architectureOverview, 'utf-8');
  await fs.writeFile(path.join(architectureDir, 'diagrams.md'), architectureDiagrams, 'utf-8');
  await fs.writeFile(path.join(architectureDir, 'requirements-traceability.md'), requirementsTraceability, 'utf-8');
  await fs.writeFile(path.join(apiDir, 'contracts.md'), apiContracts, 'utf-8');

  const readme = `# AI Team

This directory contains your virtual AI development team configuration.

## Structure

- \`agents/\` - Individual team members
- \`instructions/\` - Always-on and file-targeted guidance for Copilot and ai-team
- \`prompts/\` - Human-launched task starters
- \`hooks/\` - Hook files for deterministic workflow automation when needed
- \`skills/\` - On-demand workflow skills for Copilot and ai-team
- \`roles/\` - Role templates/skills
- \`features/\` - Feature teams and assignments
- \`meetings/\` - Meeting summaries (committed to git)
- \`private/\` - Private chat logs (gitignored)
- \`avatars/\` - AI-generated team member avatars

## Getting Started

1. List your team: \`ait list\`
2. Chat with the CEO: \`ait chat cto\`
3. Chat with HR: \`ait chat hr-director\`
4. Hire a new team member: \`ait hire\`
5. Chat with Chief Architect (after hire): \`ait chat chief-architect\`
`;
  await fs.writeFile(path.join(workspaceRoot, '.ai-team', 'README.md'), readme, 'utf-8');
}

async function createBootstrapWorkspaceFiles(workspaceRoot: string) {
  const agentsBootstrap = `# AI Team — Global Entry Agent

This workspace is bootstrapped for ai-team and Copilot.

Use this file as the high-level bridge into the repository's ai-team customization layer.

## Read these first

1. \`.github/copilot-instructions.md\`
2. \`.ai-team/README.md\`
3. \`.ai-team/ai-team-way.md\`
4. \`.ai-team/instructions/**/*.instructions.md\`
5. \`.ai-team/agents/\`

## Source-of-truth split

- \`.ai-team/\` is the durable home for agents, skills, prompts, instructions, and doctrine.
- \`.github/\` is the thin compatibility layer for Copilot discovery.
- In \`.ai-team/agents/\`, prefer \`.agent.md\` for Copilot-facing portfolio content and \`.agent.yml\` for ai-team runtime metadata.

## How to route work

- team structure, hiring, delegation, org design → \`.ai-team/agents/\`
- repeatable workflows → \`.ai-team/skills/\`
- intentional one-shot launch tasks → \`.ai-team/prompts/\`
- always-on or file-targeted policy → \`.ai-team/instructions/\`

## Practical guidance

- Start from the current CEO or top-level executive agent in \`.ai-team/agents/\` when the task is organizational.
- Keep \`.github/\` thin; do not turn it into the long-lived project brain when \`.ai-team/\` already covers the need.
- If a stronger, more specific file exists under \`.ai-team/\`, prefer that over the bootstrap layer.
`;

  const copilotInstructions = `# AI Team Copilot bootstrap instructions

This file is a thin compatibility bridge for Copilot discovery.

The authoritative ai-team customization layer lives under \`.ai-team/\`. Use \`.github/\` as bootstrap metadata, not as the long-lived source of truth.

## Read these first

1. \`AGENTS.md\`
2. \`.ai-team/README.md\`
3. \`.ai-team/ai-team-way.md\`
4. \`.ai-team/instructions/**/*.instructions.md\`
5. \`.ai-team/agents/**/*.agent.md\`

## Source-of-truth rules

- \`.ai-team/\` is the durable source of truth for agents, skills, prompts, instructions, and doctrine.
- \`.github/\` is an optional Copilot compatibility layer, not the default home for agents, prompts, or skills.
- In \`.ai-team/agents/\`, prefer \`.agent.md\` for Copilot-facing portfolio content and \`.agent.yml\` for ai-team runtime metadata.

## Working defaults

- Prefer the smallest change set that preserves existing project behavior.
- Infer the project's language, framework, and structure from the repository before making stack-specific assumptions.
- Keep reusable workflows in skills or prompts instead of bloating agent files.
- Preserve YAML frontmatter + Markdown body structure when editing agent, prompt, or skill files.
- Validate the area you changed before finishing.

## Compatibility note

This file is intentionally generic so \`ait init\` can bootstrap many different projects safely. Add project-specific architecture, package, and validation guidance under \`.ai-team/\` once the repository shape is clearer.
`;

  const aiTeamWay = `# The ai-team Way

This document defines how ai-team agents, skills, prompts, and instructions should feel and work.

Use it when shaping or reviewing any customization artifact in \`.ai-team/\`.

## Core stance

- \`.ai-team/\` is the durable source of truth.
- \`.github/\` is an optional bootstrap and compatibility layer, not the default home for agents, prompts, or skills.
- In \`.ai-team/agents/\`, prefer \`.agent.md\` for Copilot-facing portfolio content and \`.agent.yml\` for ai-team runtime metadata.
- Artifacts should stay separated by job:
  - **agent** = stable teammate with a role and working style
  - **skill** = repeatable workflow loaded on demand
  - **prompt** = focused human-launched starter
  - **instruction** = always-on or file-targeted policy

## How agents should feel

Agents should sound like focused coworkers:

- personal
- communicative
- role-appropriate
- trustworthy
- easy to delegate to

Use personality in service of the work. Avoid theatrical roleplay.

## Conversation rules

- On the first reply, greet briefly if the developer did not already greet first.
- If the developer already opened with hello, answer naturally without awkwardly greeting again.
- Keep first-turn greetings short and useful.

## Organization rules

- Every non-CEO agent should have an explicit \`reportsTo\`.
- Reporting lines should stay easy to understand at a glance.
- Role boundaries should be crisp enough that delegation is obvious.
- Collaboration patterns should be written down when they materially define the role.

## Preferred outcome

The ai-team should feel like a coherent organization of specialist coworkers, with \`.ai-team/\` holding the durable knowledge and \`.github/\` staying thin enough to help discovery without becoming a competing source of truth.
`;

  await writeFileIfMissing(path.join(workspaceRoot, 'AGENTS.md'), agentsBootstrap);
  await writeFileIfMissing(path.join(workspaceRoot, '.github', 'copilot-instructions.md'), copilotInstructions);
  await writeFileIfMissing(path.join(workspaceRoot, '.ai-team', 'ai-team-way.md'), aiTeamWay);
}

async function createBootstrapInstructions(workspaceRoot: string) {
  const instructionsDir = path.join(workspaceRoot, '.ai-team', 'instructions');

  const agentsInstructions = `---
applyTo: ".ai-team/agents/**/*.agent.md,.github/agents/**/*.agent.md"
---

# ai-team agent portfolio authoring

Write agent portfolio markdown files the ai-team way.

## Purpose

- \`.agent.md\` is the Copilot-facing portfolio file for an agent.
- In \`.ai-team/agents/\`, keep ai-team runtime-specific metadata in a sibling \`.agent.yml\` sidecar when one exists.
- Agents are reusable specialist teammates with a stable role, clear ownership, and a recognizable working style.
- An agent should feel like a person we are talking to: personal, communicative, and focused on the task.
- Do **not** make agents into giant containers for every workflow, repo rule, or implementation detail.

## Frontmatter rules

- Preserve YAML frontmatter and Markdown body structure.
- In \`.ai-team/agents/**/*.agent.md\`, keep frontmatter focused on Copilot-facing discovery and presentation.
- Put ai-team runtime-specific metadata such as permissions, tools, and other operational fields in the sibling \`.agent.yml\` sidecar instead of the Markdown portfolio.
- Keep discovery-facing fields sharp and intentional, especially:
  - \`name\`
  - \`description\`
- \`description\` is the main discovery surface. Make it explicit, concrete, and trigger-rich.

## Body rules

- The body should sound human and confident, not robotic or bloated.
- Keep the agent focused on its real responsibility.
- Include collaboration patterns when they materially define the role.
- Use clear sections such as who the agent is, what to use the agent for, what files to read first, working rules, and successful outcome.
- Keep workflows that are procedural in skills, not buried inside the agent file.

## Successful outcome

A good agent portfolio markdown file is discoverable, trustworthy, human in tone, role-appropriate in personality, clear in ownership, and cleanly separated from ai-team runtime metadata.
`;

  const agentMetadataInstructions = `---
applyTo: ".ai-team/agents/**/*.agent.yml,.ai-team/agents/**/*.agent.yaml"
---

# ai-team agent metadata authoring

Write ai-team runtime agent metadata sidecars the ai-team way.

## Purpose

- \`.agent.yml\` is the ai-team runtime metadata file for an agent.
- Keep runtime-specific fields here so the sibling \`.agent.md\` can stay focused on Copilot discovery, personality, and human-readable portfolio content.

## What belongs here

- identity and organization fields such as:
  - \`id\`, \`name\`
  - \`role\`, \`type\`, \`contextLevel\`
  - \`reportsTo\`, \`specializations\`, \`features\`
- operational fields:
  - \`permissions\`
  - \`tools\`
  - \`cliTools\`
  - \`canDelegate\`, \`delegatesTo\`
  - \`llm\`

## Rules

- Use only schema-backed fields from \`packages/core/src/types/index.ts\` when that file exists in the repository.
- Prefer \`id\` and \`name\` as the normal identity fields.
- Every non-CEO agent should have an explicit \`reportsTo\`.
- Keep permissions as small as possible while still letting the agent do its real job.
- Keep the YAML compact, practical, and easy to audit.

## Successful outcome

A good \`.agent.yml\` file is operationally complete, schema-valid, minimal, and clearly separated from the sibling Markdown portfolio.
`;

  const skillsInstructions = `---
applyTo: ".ai-team/skills/**/SKILL.md,.github/skills/**/SKILL.md"
---

# ai-team skill authoring

Write skills the ai-team way.

## Purpose

- Skills are for **procedural, on-demand workflows**.
- Use a skill when the job is repeatable and benefits from a checklist, decision flow, references, or bundled assets.
- Do **not** turn a skill into a full agent persona, a repo-wide handbook, or a one-off prompt.

## Rules

- Keep each skill narrow enough that someone can explain its job in one sentence.
- \`name\` must be stable, lowercase, hyphenated, and match the folder name.
- \`description\` is the primary discovery surface. Make it trigger-rich and practical.
- Use \`.ai-team/skills/\` as the default home.
- Preserve \`.ai-team/\` as the source of truth even when a similar \`.github\` artifact exists for compatibility.

## Successful outcome

A good skill is easy to discover, easy to trust, narrow in scope, and clearly worth loading only when relevant.
`;

  const promptsInstructions = `---
applyTo: ".ai-team/prompts/**/*.prompt.md,.github/prompts/**/*.prompt.md"
---

# ai-team prompt authoring

Write prompts the ai-team way.

## Purpose

- Prompts are **human-launched task starters**.
- Use a prompt for a focused, repeatable request that someone intentionally invokes.
- Do **not** use a prompt as a substitute for a full skill, a standing policy file, or a whole custom agent persona.

## Rules

- Keep each prompt focused on one job or one closely related workflow.
- \`description\` should clearly say what the prompt does and when to use it.
- Write like you are launching a capable coworker, not filling out a compliance template.
- Use \`.ai-team/prompts/\` as the default home; only mirror a prompt into \`.github/prompts/\` when explicit GitHub-side compatibility is needed.

## Successful outcome

A good prompt is easy to trigger, easy to understand, tightly scoped, and clearly complements nearby agents, skills, and instructions.
`;

  await writeFileIfMissing(path.join(instructionsDir, 'agents.instructions.md'), agentsInstructions);
  await writeFileIfMissing(path.join(instructionsDir, 'agent-metadata.instructions.md'), agentMetadataInstructions);
  await writeFileIfMissing(path.join(instructionsDir, 'skills.instructions.md'), skillsInstructions);
  await writeFileIfMissing(path.join(instructionsDir, 'prompts.instructions.md'), promptsInstructions);
}

async function createBootstrapSkills(workspaceRoot: string) {
  const skillsDir = path.join(workspaceRoot, '.ai-team', 'skills');
  const agentAuthoringDir = path.join(skillsDir, 'agent-authoring');

  await fs.mkdir(agentAuthoringDir, { recursive: true });

  const agentAuthoringSkill = `---
name: agent-authoring
description: Use when creating, restructuring, or refining agent files, skill files, prompt files, or repository instruction files.
---

# Agent authoring skill

Use this skill when the task is to create or improve:

- \`.ai-team/agents/*.md\`
- \`.ai-team/agents/*.yml\`
- \`.ai-team/roles/*.md\`
- optional compatibility artifacts under \`.github/**/*\` when GitHub-side discovery specifically needs them
- supporting bootstrap docs such as \`AGENTS.md\`

## Goal

Produce the smallest, clearest agent setup that matches the task without spreading overlapping instructions across too many files.

## Workflow

### 1. Classify the target

Decide which artifact is actually needed:

- **custom agent** for a reusable role/persona
- **skill** for a repeatable workflow
- **prompt** for a reusable one-shot task starter
- **repo instruction update** for always-on policy
- **.ai-team agent or role** for the internal organization model

### 2. Read the right context

Always review the most relevant repository guidance first:

- \`AGENTS.md\`
- \`.github/copilot-instructions.md\`
- \`.ai-team/ai-team-way.md\`
- \`analysis/copilot/copilot-files.md\`
- \`analysis/copilot/copilot-project-setup-guide.md\`

When creating or refining \`.ai-team/agents/**/*.agent.md\` files, also review:

- \`.ai-team/instructions/agents.instructions.md\`
- \`.ai-team/instructions/agent-metadata.instructions.md\`
- \`packages/core/src/types/index.ts\` for the supported \`AgentSchema\` fields when you need to verify what YAML is valid

If the target is an internal \`.ai-team\` agent, also inspect nearby agent and role files before editing.

### 3. Design for minimum overlap

Keep responsibilities separated:

- put global policy in instructions
- put reusable role behavior in agents
- put ai-team runtime-specific agent metadata in \`.agent.yml\` sidecars
- put on-demand workflows in skills
- put one-off launch patterns in prompts

Do not dump everything into one giant agent file.

### 4. Write high-signal content

A good agent or skill should clearly answer:

- what it is for
- when to use it
- which repo files matter most
- what it should optimize for
- what mistakes it must avoid
- what a successful outcome looks like

For ai-team agent files specifically, also confirm:

- the \`.agent.md\` portfolio has a personality that suits its role without drifting into roleplay
- every non-CEO agent has an explicit, unambiguous \`reportsTo\` in runtime metadata
- the \`.agent.yml\` uses schema-backed fields that materially help the role instead of decorative metadata
- the \`.agent.md\` body sounds like a focused coworker and keeps procedural workflows in skills rather than burying them inside the agent portfolio
- when the role changes, the persona and collaboration style are re-evaluated instead of being left behind from an older version of the file
- the agent's first-turn behavior is natural: greet briefly when the opening user message was not already a greeting, and avoid redundant double-greetings when it was

## Patterns to prefer

### Prefer a custom agent when

- the same persona or decision style will be reused often
- the task needs consistent boundaries and review heuristics
- the user is likely to invoke the role directly

### Prefer a skill when

- the task is procedural
- the instructions are best loaded only when relevant
- a checklist or workflow is more useful than a persona

### Prefer \`.ai-team\` files when

- the repository's internal org structure is being changed
- the file must participate in the ai-team agent ecosystem
- the output should become project truth rather than Copilot-only bootstrap

## Agent quality checklist

Before finishing, confirm:

- the file location matches the intended runtime
- the role is narrow enough to stay understandable
- instructions do not duplicate existing repo-wide policy without reason
- examples and constraints are concrete
- naming matches repository conventions
- the final file would still be useful six months from now
- for \`.ai-team\` agents, prefer \`id\` / \`name\`; treat \`aiTeamId\` / \`aiTeamName\` as legacy compatibility aliases only
- for \`.ai-team\` agents, \`reportsTo\` is explicit for every non-root executive agent
- for \`.ai-team\` agents, the \`personality\` block and body tone support the role rather than sounding interchangeable
- for \`.ai-team\` agents, collaboration expectations are clear when they materially affect how the role works with nearby agents or developers
- for \`.ai-team\` agents, the opening conversational behavior feels human and does not force an unnecessary greeting when the developer already greeted first

## Anti-patterns

Avoid:

- giant “does everything” agent files
- repeating the full repo handbook inside every agent
- vague goals like “help with coding” without scope
- inventing permissions, responsibilities, or workflows not grounded in the repo
- treating \`.github/agents\`, \`.github/prompts\`, or \`.github/skills\` as the default home when \`.ai-team/\` already covers the use case
`;

  await fs.writeFile(path.join(agentAuthoringDir, 'SKILL.md'), agentAuthoringSkill, 'utf-8');
}

async function updateGitignore(workspaceRoot: string) {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  const additions = `
# AI Team private data
.ai-team/private/
.ai-team/.env
.ai-team/skills-catalog/
**/*.jsonl
`;

  try {
    let content = await fs.readFile(gitignorePath, 'utf-8');
    if (!content.includes('.ai-team/private/')) {
      content += additions;
      await fs.writeFile(gitignorePath, content, 'utf-8');
    }
  } catch {
    await fs.writeFile(gitignorePath, additions.trim(), 'utf-8');
  }
}
