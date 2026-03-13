import fs from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import {
  ensureAiTeamDirectory,
  loadTeamConfig,
  resolveEffectiveLlmSettings,
  saveTeamConfig,
  saveEnvFile,
  saveAgentAccessPatterns,
  loadSkill,
  testLlmConnection,
  LlmService,
  ChatManager,
  loadEnvFile,
} from '@ai-team/core';
import type { TeamConfig, Agent, ChatMessage, ChatCompletionMessageParam } from '@ai-team/core';
import type {
  InitOptions,
} from '../contracts.js';
import { getGitUserName, developerNameToId } from '../utils/git.js';
import { listEmployeesCommand } from './list.js';
import { updateWorkspaceSettings } from './init/update-workspace-settings.js';
import { updateGitignore } from './init/update-gitignore.js';
import { askLlmSetup, type LlmSetupResult, type LlmSettingsIo } from './init/llm-settings.js';
import {
  createRoleTemplates,
  createBootstrapWorkspaceFiles,
  createBootstrapInstructions,
  createBootstrapSkills,
  createBootstrapTemplateFiles,
} from './init/bootstrap-files.js';
import {
  INIT_TEMPLATE_FILE_MAP,
  type InitTemplateKey,
  getWorkspaceTemplatePath,
  readDefaultTemplate,
  loadInitTemplates,
  renderTemplate,
  parseTemplateBulletList,
} from './init/template-utils.js';
import {
  type InitRuntimeHooks,
  requestInput,
  requestConfirm,
  requestSelect,
  requestPassword,
  requestChecklist,
} from './init/workflow-questions.js';
import { pickAgentName } from './init/name-picking.js';
import { createAgentFile } from './init/agent-file.js';
import {
  getIdeaClarifierQuestion,
  getGuidedInitialSuggestions,
  getGuidedDependentSuggestions,
} from './init/guided-onboarding.js';


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

function buildLlmSettingsIo(hooks: InitRuntimeHooks | undefined): LlmSettingsIo {
  return {
    select: request => requestSelect(hooks, request),
    input: request => requestInput(hooks, request),
    password: request => requestPassword(hooks, request),
    writeLine: message => writeLine(hooks, message),
    writeWarn: message => writeWarn(hooks, message),
  };
}

const FORCE_KEEP = new Set(['config.json', '.env']);
const DEFAULT_SKILL_SOURCES = [
  'https://github.com/anthropics/skills',
];

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
          llmConfig = await askLlmSetup(buildLlmSettingsIo(hooks));
        }
      } else {
        llmConfig = { ...existingResolvedLlm.config };
        reusedExistingLlm = true;
        writeLine(hooks, 'Reusing existing GitHub Copilot configuration.');
      }
    } else {
      llmConfig = await askLlmSetup(buildLlmSettingsIo(hooks));
    }
  } else {
    llmConfig = await askLlmSetup(buildLlmSettingsIo(hooks));
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
      ? {
          ...existingConfig,
          llm: safeLlmConfig,
          skillSources: existingConfig.skillSources?.length ? existingConfig.skillSources : DEFAULT_SKILL_SOURCES,
        }
      : {
          version: '0.1.0',
          randomAvatarUrls: [],
          llm: safeLlmConfig,
          skillSources: DEFAULT_SKILL_SOURCES,
        };
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

function showNextSteps(hooks?: InitRuntimeHooks) {
  writeLine(hooks, '');
  writeLine(hooks, 'Next steps:');
  writeLine(hooks, '  1. Run ait list to see your team');
  writeLine(hooks, '  2. Run ait chat <agent-id> to start chatting');
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

  writeLine(hooks, "First, let's name your founding team.");

  const ceoName = await pickAgentName(llm, templates, 'CEO', [], hooks, {
    requestSelect,
    requestInput,
    writeWarn,
  });
  writeLine(hooks, `CEO: My name is ${ceoName}.`);

  const hrName = await pickAgentName(llm, templates, 'Head of Human Resources', [ceoName], hooks, {
    requestSelect,
    requestInput,
    writeWarn,
  });
  writeLine(hooks, `CEO: I need an HR Director to build the team. Let's call them ${hrName}.`);
  writeLine(hooks, `  HR Director: ${hrName}`);

  writeLine(hooks, '--- Creating Founding Team ---');

  const ceoAgent = await createAgentFile(workspaceRoot, {
    name: ceoName,
    role: 'ceo',
    type: 'executive',
    contextLevel: 'organization',
    personality: { communication_style: 'strategic', expertise_level: 'executive', mentoring: true },
    introduction: renderTemplate(templates.ceoAgentIntroduction, { ceoName, hrName }).trim(),
    personalityProfile: parseTemplateBulletList(templates.ceoAgentPersonality),
  });
  writeLine(hooks, `  ${ceoName} has joined as CEO`);

  const hrAgent = await createAgentFile(workspaceRoot, {
    name: hrName,
    role: 'hr-director',
    type: 'executive',
    contextLevel: 'organization',
    reportsTo: 'ceo',
    personality: { communication_style: 'supportive', expertise_level: 'executive', mentoring: true },
    introduction: renderTemplate(templates.hrAgentIntroduction, { ceoName, hrName }).trim(),
    personalityProfile: parseTemplateBulletList(templates.hrAgentPersonality),
  });
  writeLine(hooks, `  ${hrName} has joined as HR Director`);

  await saveAgentAccessPatterns(workspaceRoot, ceoAgent.id, {
    read: ['**/*'],
    write: ['.ai-team/**/*', '.github/copilot-instructions.md', 'AGENTS.md', 'docs/**/*'],
    create: [],
    delete: [],
  });

  await saveAgentAccessPatterns(workspaceRoot, hrAgent.id, {
    read: ['**/*'],
    write: [
      '.ai-team/**/*',
      '.ai-team/skills-catalog/**/*',
      '.github/skills/**/*',
      '.github/copilot-instructions.md',
      'AGENTS.md',
      'docs/**/*',
    ],
    create: [],
    delete: [],
  });

  writeLine(hooks, '--- Business Definition ---');
  writeLine(hooks, 'Start with your idea in plain text first. We will build from that.');
  const ideaText = await requestInput(hooks, {
    message: 'Describe your idea in your own words (2-6 sentences):',
    validate: (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length < 20) return 'Please add a little more detail so we can generate useful options.';
      if (trimmed.length > 4000) return 'Please keep it concise (max ~4000 characters).';
      return true;
    },
  });

  const clarifier = await getIdeaClarifierQuestion(llm, ideaText);
  const productIntentAndPainPoint = await requestInput(hooks, {
    message: clarifier.question,
    validate: (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length < 20) return 'Please include both product type and the first pain point to eliminate.';
      if (trimmed.length > 4000) return 'Please keep it concise (max ~4000 characters).';
      return true;
    },
  });

  const guidedIdeaContext = [
    ideaText.trim(),
    '',
    `Product target + first pain point: ${productIntentAndPainPoint.trim()}`,
  ].join('\n');

  const guidedMode = await requestConfirm(hooks, {
    message: 'Use AI-guided options based on your idea (less typing)?',
    default: true,
  });

  const businessSeed: string[] = [];
  let guidedSelectionContext:
    | { mode: string; priorities: string[]; constraints: string[] }
    | undefined;
  businessSeed.push(`- Idea summary (developer): ${ideaText.trim()}`);
  businessSeed.push(`- Product target and first pain point: ${productIntentAndPainPoint.trim()}`);
  if (guidedMode) {
    let dynamicProductModes:
      | Array<{ name: string; value: string }>
      | undefined;
    let dynamicPriorities:
      | Array<{ name: string; value: string }>
      | undefined;
    try {
      const initialSuggestions = await getGuidedInitialSuggestions(llm, guidedIdeaContext);
      dynamicProductModes = initialSuggestions.productModes;
      dynamicPriorities = initialSuggestions.priorities;
    } catch (error) {
      writeWarn(hooks, `Could not generate inspiring guided options yet; switching to text input for this step. (${error instanceof Error ? error.message : String(error)})`);
    }

    const businessFocus = dynamicProductModes
      ? await requestSelect(hooks, {
          message: 'Which product direction fits best right now?',
          choices: dynamicProductModes,
        })
      : await requestInput(hooks, {
          message: 'What product direction best fits your idea right now?',
          validate: value => value.trim().length > 0 || 'Please provide a product direction.',
        });

    const priorities = dynamicPriorities
      ? await requestChecklist(hooks, {
          message: 'Pick top priorities that should drive decisions:',
          choices: dynamicPriorities,
        })
      : (await requestInput(hooks, {
          message: 'List your top priorities (comma-separated):',
          validate: value => value.trim().length > 0 || 'Please provide at least one priority.',
        }))
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

    let constraints: string[] = [];
    try {
      const dependentSuggestions = await getGuidedDependentSuggestions(llm, {
        ideaText: guidedIdeaContext,
        selectedProductMode: businessFocus,
        selectedPriorities: priorities,
      });
      constraints = await requestChecklist(hooks, {
        message: 'Pick key constraints (optional):',
        choices: dependentSuggestions.constraints,
      });
    } catch (error) {
      writeWarn(hooks, `Could not tailor constraints from your selections; switching to text input. (${error instanceof Error ? error.message : String(error)})`);
      constraints = (await requestInput(hooks, {
        message: 'List key constraints (comma-separated, optional; press enter to skip):',
      }))
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    }

    guidedSelectionContext = {
      mode: businessFocus,
      priorities,
      constraints,
    };

    businessSeed.push(`- Product mode: ${businessFocus}`);
    if (priorities.length > 0) {
      businessSeed.push(`- Priorities: ${priorities.join(', ')}`);
    }
    if (constraints.length > 0) {
      businessSeed.push(`- Constraints: ${constraints.join(', ')}`);
    }
  }

  writeLine(hooks, 'Tell your CEO what business problem your software solves.');
  writeLine(hooks, 'Describe the product vision, target users, and core goals.');
  writeLine(hooks, 'Type "done" when you are ready to move on.');
  const developerName = getGitUserName();
  const businessContext = await onboardingChat(
    workspaceRoot,
    llm,
    ceoAgent,
    'done',
    [
      renderTemplate(templates.onboardingCeoSystemPrompt, { hrName }),
      businessSeed.length > 0 ? `\n## Guided onboarding answers\n${businessSeed.join('\n')}` : '',
    ].join('\n').trim(),
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

  const hiringSeed: string[] = [];
  if (guidedMode) {
    let mustHaveRoles: string[] = [];
    try {
      const selectedProductMode = guidedSelectionContext?.mode ?? 'unknown';
      const selectedPriorities = guidedSelectionContext?.priorities ?? [];
      const selectedConstraints = guidedSelectionContext?.constraints ?? [];

      const dependentSuggestions = await getGuidedDependentSuggestions(llm, {
        ideaText: guidedIdeaContext,
        selectedProductMode,
        selectedPriorities,
        selectedConstraints,
      });
      mustHaveRoles = await requestChecklist(hooks, {
        message: 'Pick must-have roles for first hiring wave:',
        choices: dependentSuggestions.mustHaveRoles,
      });
    } catch (error) {
      writeWarn(hooks, `Could not generate role options from previous selections; switching to text input. (${error instanceof Error ? error.message : String(error)})`);
      mustHaveRoles = (await requestInput(hooks, {
        message: 'List must-have roles for first hiring wave (comma-separated):',
        validate: value => value.trim().length > 0 || 'Please provide at least one role.',
      }))
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    }

    if (mustHaveRoles.length > 0) {
      hiringSeed.push(`- First-wave roles: ${mustHaveRoles.join(', ')}`);
    }
  }

  await onboardingChat(
    workspaceRoot,
    llm,
    hrAgent,
    'done',
    [
      renderTemplate(templates.onboardingHrSystemPrompt, { hrName }),
      hiringSeed.length > 0 ? `\n## Guided hiring inputs\n${hiringSeed.join('\n')}` : '',
    ].join('\n').trim(),
    developerName,
    hooks,
  );

  writeLine(hooks, '');
  writeLine(hooks, '--- Onboarding Complete ---');
  writeLine(hooks, `Your CEO ${ceoAgent.name} is ready to chat. Entering interactive mode...`);
  writeLine(hooks, '');

  // Import chatCommand lazily to avoid circular dependency issues
  const { chatCommand: startChat } = await import('./chat/index.js');
  await startChat(workspaceRoot, ceoAgent.id, {}, {
    signal: hooks?.signal,
    emit: hooks?.emit,
    questionInput: hooks?.questionInput,
    questionConfirm: hooks?.questionConfirm,
    questionSelect: hooks?.questionSelect,
    questionPassword: hooks?.questionPassword,
    questionChecklist: hooks?.questionChecklist,
  });
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

