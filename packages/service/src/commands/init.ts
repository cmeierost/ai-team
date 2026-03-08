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

async function runOnboarding(workspaceRoot: string, llm: LlmService, hooks?: InitRuntimeHooks) {
  writeLine(hooks, '');
  writeLine(hooks, '--- Team Onboarding ---');
  writeLine(hooks, "Let's set up your founding team.");

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
  const filePath = path.join(aiTeamDir, 'agents', id, 'agent.md');

  // Build permissions based on type
  const permissions = seed.type === 'executive'
    ? { read: ['**/*'], write: ['.ai-team/**/*', 'docs/**/*'], manage_agents: true }
    : { read: ['.ai-team/**/*'], write: ['.ai-team/**/*'] };

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
