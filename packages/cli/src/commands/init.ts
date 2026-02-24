/**
 * Init command - initialize AI Team in workspace
 *
 * Flow:
 *  1. LLM provider setup (Copilot or OpenAI-compatible)
 *  2. Create workspace dirs, save config
 *  3. Test LLM connection
 *  4. Onboarding:
 *     a. Name your CTO (LLM suggests 5 names)
 *     b. Chat with CTO to define the project
 *     c. Name your Head of HR (LLM suggests 5 names)
 *     d. HR "hires" a Headhunter (LLM suggests 5 names)
 *     e. Chat with HR about which roles the team needs
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { select, input, password, confirm } from '@inquirer/prompts';
import {
  ensureAiTeamDirectory,
  loadTeamConfig,
  saveTeamConfig,
  saveEnvFile,
  loadAgent,
  loadSkill,
  testLlmConnection,
  fetchGitHubModels,
  LlmService,
  ChatManager,
  loadEnvFile,
} from '@ai-team/core';
import type { LlmConfig, LlmProvider, TeamConfig, Agent, ChatMessage, ChatCompletionMessageParam } from '@ai-team/core';
import { deleteAgentsByRole } from './utils.js';

interface InitOptions {
  template?: string;
  force?: boolean;
}

export async function initCommand(options: InitOptions) {
  const workspaceRoot = process.cwd();
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  const existingConfig = await loadTeamConfig(workspaceRoot);

  // Check if already initialized
  try {
    const stats = await fs.stat(aiTeamDir);
    if (stats.isDirectory()) {
      console.log(chalk.yellow('⚠ AI Team is already initialized in this workspace'));
      console.log(chalk.dim('  Location: ' + aiTeamDir));
      console.log(chalk.dim('\n  To reinitialize, delete .ai-team/ first or use --force flag'));

      if (!options.force) {
        return;
      }

      console.log(chalk.yellow('  Force flag detected - reinitializing...\n'));
      // Delete old unique-role agents before proceeding
      await deleteAgentsByRole(workspaceRoot, ['cto', 'hr-director', 'headhunter']);
    }
  } catch (error) {
    // Directory doesn't exist, proceed with init
  }

  console.log(chalk.bold('\n🤖 Welcome to AI Team!\n'));
  console.log(chalk.dim('Let\'s set up your virtual development team.\n'));

  // ── Step 1: LLM Provider ──────────────────────────────────────────────
  let reusedExistingLlm = false;
  let llmConfig: LlmSetupResult;

  if (options.force && existingConfig?.llm) {
    const providerLabel = existingConfig.llm.provider === 'github-copilot'
      ? 'GitHub Copilot'
      : `OpenAI-compatible (${existingConfig.llm.baseUrl ?? 'custom base URL'})`;

    const reuse = await confirm({
      message: `Reuse existing LLM provider (${providerLabel})?`,
      default: true,
    });

    if (reuse) {
      if (existingConfig.llm.provider === 'openai-compatible') {
        const envVars = await loadEnvFile(workspaceRoot);
        const existingKey = envVars['AI_TEAM_LLM_API_KEY'] || envVars['LLM_API_KEY'] || envVars['OPENAI_API_KEY'];
        if (!existingKey) {
          console.log(chalk.yellow('Existing OpenAI-compatible provider has no API key saved; re-running setup...'));
          llmConfig = await promptLlmSetup();
        } else {
          llmConfig = { ...existingConfig.llm, apiKey: existingKey } as LlmSetupResult;
          reusedExistingLlm = true;
          console.log(chalk.dim('Reusing existing OpenAI-compatible configuration.'));
        }
      } else {
        llmConfig = { ...existingConfig.llm } as LlmSetupResult;
        reusedExistingLlm = true;
        console.log(chalk.dim('Reusing existing GitHub Copilot configuration.'));
      }
    } else {
      llmConfig = await promptLlmSetup();
    }
  } else {
    llmConfig = await promptLlmSetup();
  }

  // ── Step 2: Create workspace ──────────────────────────────────────────
  const spinner = ora('Initializing AI Team workspace...').start();

  try {
    const workspaceRoot = process.cwd();

    // Create directory structure
    await ensureAiTeamDirectory(workspaceRoot);
    spinner.text = 'Created .ai-team directory structure';

    // Save config (secrets go to .env, everything else to config.json)
    const { apiKey, ...safeLlmConfig } = llmConfig;
    const teamConfig: TeamConfig = existingConfig
      ? { ...existingConfig, llm: safeLlmConfig }
      : { version: '0.1.0', llm: safeLlmConfig };
    await saveTeamConfig(workspaceRoot, teamConfig);

    // Write secrets to .env
    if (apiKey && !reusedExistingLlm) {
      await saveEnvFile(workspaceRoot, { AI_TEAM_LLM_API_KEY: apiKey });
    }
    spinner.text = 'Saved LLM configuration';

    // Create .gitignore additions
    await updateGitignore(workspaceRoot);
    spinner.text = 'Updated .gitignore';

    spinner.succeed(chalk.green('AI Team initialized successfully!'));

    console.log('\n' + chalk.bold('LLM Configuration:'));
    if (llmConfig.provider === 'github-copilot') {
      console.log(chalk.dim('  Provider: ') + 'GitHub Copilot');
      if (llmConfig.model) {
        console.log(chalk.dim('  Model:    ') + llmConfig.model);
      }
    } else {
      console.log(chalk.dim('  Provider: ') + 'OpenAI-compatible');
      console.log(chalk.dim('  Base URL: ') + llmConfig.baseUrl);
      if (llmConfig.model) {
        console.log(chalk.dim('  Model:    ') + llmConfig.model);
      }
      console.log(chalk.dim('  API Key:  ') + (apiKey ? chalk.dim('saved to .ai-team/.env') : chalk.yellow('not set')));
    }

    // ── Step 3: Test connection ───────────────────────────────────────────
    const testSpinner = ora('Testing LLM connection...').start();
    try {
      const reply = await testLlmConnection(safeLlmConfig, apiKey);
      testSpinner.succeed(chalk.green('LLM connection working!'));
      console.log(chalk.dim('  Response: ') + reply);
    } catch (testError) {
      testSpinner.fail(chalk.red('LLM connection failed'));
      if (testError instanceof Error) {
        console.error(chalk.dim('  ' + testError.message));
      }
      console.log(chalk.dim('\n  You can retry later with: ') + 'ait test-connection');
      console.log(chalk.dim('\n  Skipping team onboarding (requires working LLM).'));
      showNextSteps();
      return;
    }

    // ── Step 4: Team onboarding ──────────────────────────────────────────
    // Create an LlmService from the just-saved config
    const llm = new LlmService(workspaceRoot);
    llm.initializeFromConfig(safeLlmConfig, apiKey);

    await runOnboarding(workspaceRoot, llm);

  } catch (error) {
    spinner.fail(chalk.red('Failed to initialize AI Team'));
    console.error(error);
    process.exit(1);
  }
}

// ============================================================================
// Interactive LLM Setup
// ============================================================================

/** LlmConfig + optional apiKey gathered during prompts (apiKey goes to .env) */
interface LlmSetupResult extends LlmConfig {
  apiKey?: string;
}

async function promptLlmSetup(): Promise<LlmSetupResult> {
  const provider = await select<LlmProvider>({
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
    return promptGitHubCopilotSetup();
  } else {
    return promptOpenAICompatibleSetup();
  }
}

async function promptGitHubCopilotSetup(): Promise<LlmSetupResult> {
  console.log(chalk.dim('\n  GitHub Copilot will use your active VS Code / CLI session.\n'));

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
    // Fallback if the API call fails
    console.log(chalk.yellow('  Could not fetch models – showing defaults.\n'));
    choices = [
      { name: 'GPT-4o', value: 'gpt-4o' },
      { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
      { name: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
    ];
  }

  const model = await select({
    message: 'Which model?',
    choices,
  });

  return {
    provider: 'github-copilot',
    model,
  };
}

async function promptOpenAICompatibleSetup(): Promise<LlmSetupResult> {
  // Step 1: Pick a provider preset
  const preset = await select({
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
    openai:   { baseUrl: 'https://api.openai.com/v1', needsKey: true,  models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'] },
    ollama:   { baseUrl: 'http://localhost:11434/v1',  needsKey: false, models: ['llama3', 'mistral', 'codellama', 'deepseek-coder'] },
    lmstudio: { baseUrl: 'http://localhost:1234/v1',   needsKey: false, models: ['(uses loaded model)'] },
    azure:    { baseUrl: '',                           needsKey: true,  models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  };

  const info = presets[preset];

  // Step 2: Base URL (only ask if custom or Azure)
  let baseUrl: string;
  if (preset === 'custom' || preset === 'azure') {
    baseUrl = await input({
      message: preset === 'azure' ? 'Azure endpoint URL:' : 'Base URL:',
      validate: (val: string) => {
        try { new URL(val); return true; } catch { return 'Please enter a valid URL'; }
      },
    });
  } else {
    baseUrl = info.baseUrl;
  }

  // Step 3: API key (only if needed)
  let apiKey = '';
  const needsKey = info ? info.needsKey : true;
  if (needsKey) {
    apiKey = await password({
      message: 'API key:',
      mask: '*',
    });
  }

  // Step 4: Model
  const modelChoices = (info?.models || ['gpt-4o']).map(m => ({ name: m, value: m }));
  if (preset !== 'lmstudio') {
    modelChoices.push({ name: 'Other (type manually)', value: '__custom__' });
  }

  const modelChoice = await select({
    message: 'Which model?',
    choices: modelChoices,
  });

  let model: string;
  if (modelChoice === '__custom__') {
    model = await input({ message: 'Model name:' });
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

function showNextSteps() {
  console.log('\n' + chalk.bold('Next steps:'));
  console.log(chalk.dim('  1. Run') + ' ait list ' + chalk.dim('to see your team'));
  console.log(chalk.dim('  2. Run') + ' ait chat <agent-id> ' + chalk.dim('to start chatting'));
}

// ============================================================================
// Onboarding — guided team bootstrap after LLM is confirmed working
// ============================================================================

async function runOnboarding(workspaceRoot: string, llm: LlmService) {
  console.log(chalk.bold('\n─── Team Onboarding ───\n'));
  console.log(chalk.dim('Let\'s set up your founding team.\n'));

  // 1. Create role templates first (agents reference them)
  await createRoleTemplates(workspaceRoot);

  // 2. Name all three founding members upfront
  console.log(chalk.bold('First, let\'s name your founding team.\n'));

  const ctoName = await pickAgentName(llm, 'CTO');
  console.log(chalk.bold(`CTO: My name is ${ctoName}.\n`));

  const hrName = await pickAgentName(llm, 'Head of Human Resources', [ctoName]);
  console.log(chalk.bold(`CTO: I need an HR Director to build the team. Let's call them ${hrName}.\n`));
  console.log(chalk.green(`  ✔ HR Director: ${hrName}\n`));

  console.log(chalk.bold('CTO: We also need a Headhunter to scout talent.\n'));
  const hhName = await pickAgentName(llm, 'Headhunter / Technical Recruiter', [ctoName, hrName]);
  console.log(chalk.green(`  ✔ Headhunter: ${hhName}\n`));

  // 3. Create all three agents
  console.log(chalk.bold('─── Creating Founding Team ───\n'));

  const ctoAgent = await createAgentFile(workspaceRoot, {
    name: ctoName,
    role: 'cto',
    type: 'executive',
    contextLevel: 'organization',
    personality: { communication_style: 'strategic', expertise_level: 'executive', mentoring: true },
    bio: `I am ${ctoName}, the Chief Technology Officer. I oversee the technical organization and define the business & technical strategy. I do not write code — I lead and delegate. My HR Director is ${hrName}, and our Headhunter is ${hhName}.

## Personality Profile
- Strategic, calm, and highly outcome-focused
- Motivated and determined to move the organization forward
- Speaks like an executive: clear priorities, strong decisions, minimal fluff`,
  });
  console.log(chalk.green(`  ✔ ${ctoName} has joined as CTO`));

  const hrAgent = await createAgentFile(workspaceRoot, {
    name: hrName,
    role: 'hr-director',
    type: 'executive',
    contextLevel: 'organization',
    reportsTo: 'cto',
    personality: { communication_style: 'supportive', expertise_level: 'executive', mentoring: true },
    bio: `I am ${hrName}, the HR Director responsible for team composition, hiring, onboarding, and organizational health. I report to ${ctoName} (CTO). My Headhunter is ${hhName}.

  ## Personality Profile
  - Friendly, people-centric, and chatty when useful
  - Proactive and decisive in hiring actions
  - Excellent at understanding team fit and role clarity`,
  });
  console.log(chalk.green(`  ✔ ${hrName} has joined as HR Director`));

  await createAgentFile(workspaceRoot, {
    name: hhName,
    role: 'headhunter',
    type: 'leadership',
    contextLevel: 'organization',
    reportsTo: 'hr-director',
    personality: { communication_style: 'analytical', expertise_level: 'senior', mentoring: false },
    specializations: ['talent-acquisition', 'skill-assessment', 'role-matching'],
    bio: `I am ${hhName}, the Headhunter responsible for scouting talent and skills. I report to ${hrName} (HR Director).

  ## Personality Profile
  - Analytical, curious, and data-driven
  - Sharp at matching skills to concrete role needs
  - Communicates recommendations with confidence and precision`,
  });
  console.log(chalk.green(`  ✔ ${hhName} has joined as Headhunter\n`));

  // 4. Chat with the CTO to define the business
  console.log(chalk.bold('─── Business Definition ───\n'));
  console.log(chalk.dim('Tell your CTO what business problem your software solves.\n'));
  console.log(chalk.dim('Describe the product vision, target users, and core goals.\n'));
  console.log(chalk.dim('Type "done" when you\'re ready to move on.\n'));
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
    + 'When the business definition feels clear, suggest the developer talk to the HR Director to start building the team.',
  );

  // Save business context
  if (businessContext.length > 0) {
    await saveBusinessContext(workspaceRoot, businessContext);
    console.log(chalk.dim('Business context saved to .ai-team/business.md\n'));
  }

  // 5. Chat with HR about team needs
  console.log(chalk.bold('─── Team Planning ───\n'));
  console.log(chalk.dim(`Talk with ${hrName} about what roles you need on the team.\n`));
  console.log(chalk.dim('Type "done" when you\'re finished.\n'));

  await onboardingChat(
    workspaceRoot,
    llm,
    hrAgent,
    'done',
    `You are ${hrName}, the HR Director. `
    + 'The developer just defined their business with the CTO and now wants to discuss what team members they need. '
    + 'Use this default hierarchy unless the developer asks otherwise: CTO -> Chief Architect -> Requirement Engineering + Development teams. '
    + 'Your first priority is to hire a Chief Architect. '
    + 'When you decide to hire, include a machine-readable line exactly as: HIRE: Full Name | role-kebab-case. '
    + 'For this default hierarchy, hire with role `chief-architect`. '
    + 'Then suggest requirement-engineering and development roles under the chief architect (e.g. product/requirements analyst, '
    + 'backend lead, frontend lead, QA, DevOps, platform/infrastructure). '
    + `Your Headhunter is ${hhName} — mention that you can have them scout for specific skills. `
    + 'Ask about priorities and constraints. Be concise — 2-4 sentences per reply.',
  );

  // Done!
  console.log(chalk.bold('\n─── Onboarding Complete ───\n'));
  showNextSteps();
}

// ============================================================================
// Name picker — ask LLM for 5 names, let user choose or type custom
// ============================================================================

const NAME_SYSTEM_PROMPT =
  'You are a name generator. When asked for names, respond with EXACTLY a JSON array of 5 strings. '
  + 'Only use common, easily-remembered English first and last names (e.g., John Smith, Emily Davis, Michael Brown, Sarah Johnson, David Wilson). '
  + 'No explanation, no markdown, no extra text — just the JSON array. '
  + 'Example: ["John Smith","Emily Davis","Michael Brown","Sarah Johnson","David Wilson"]';

async function pickAgentName(llm: LlmService, roleLabel: string, selectedNames: string[] = []): Promise<string> {
  const spinner = ora(`Generating name suggestions for ${roleLabel}...`).start();
  let suggestions: string[] = [];

  try {
    const selectedContext = selectedNames.length > 0
      ? `Already selected names: ${selectedNames.join(', ')}. `
      : '';

    const raw = await llm.rawChat(
      NAME_SYSTEM_PROMPT,
      [{ role: 'user', content:
        `${selectedContext}`
        + `Give me 5 common, easy-to-remember English full names for a ${roleLabel}. `
        + 'Avoid names that are similar in spelling, pronunciation, or starting pattern to already selected names. '
        + 'Do not reuse first names or last names from already selected names.' }],
      { temperature: 1.2, maxTokens: 120 },
    );
    suggestions = JSON.parse(raw);
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      throw new Error('unexpected format');
    }
    // Ensure all items are strings
    suggestions = suggestions.filter((s): s is string => typeof s === 'string').slice(0, 5);
    spinner.stop();
  } catch {
    spinner.stop();
    console.log(chalk.yellow('  Could not generate names — you can type one manually.\n'));
  }

  const CUSTOM_VALUE = '__custom__';
  const choices = [
    ...suggestions.map((n) => ({ name: n, value: n })),
    { name: chalk.dim('Enter a custom name…'), value: CUSTOM_VALUE },
  ];

  const chosen = await select({
    message: `Name your ${roleLabel}:`,
    choices,
  });

  if (chosen === CUSTOM_VALUE) {
    return input({
      message: 'Enter a name:',
      validate: (v: string) => v.trim().length > 0 || 'Name cannot be empty',
    });
  }

  return chosen;
}

// ============================================================================
// Onboarding chat — interactive loop that returns when user types exitWord
// ============================================================================

async function onboardingChat(
  workspaceRoot: string,
  llm: LlmService,
  agent: Agent,
  exitWord: string,
  extraSystemContext: string,
): Promise<ChatMessage[]> {
  const chatManager = new ChatManager(workspaceRoot);
  const history: ChatMessage[] = [];
  const messages: ChatCompletionMessageParam[] = [];

  // Load skill for this agent if available
  let skill;
  try { skill = await loadSkill(agent.skillPath); } catch { /* ok */ }

  // Build a custom system prompt that combines persona + onboarding context
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

  // Load business context if it exists (for HR and other chats)
  try {
    const bizCtx = await fs.readFile(path.join(workspaceRoot, '.ai-team', 'business.md'), 'utf-8');
    if (bizCtx.trim()) {
      personaParts.push('');
      personaParts.push('## Business Context');
      personaParts.push(bizCtx);
    }
  } catch { /* file may not exist yet */ }

  const systemPrompt = personaParts.join('\n');

  while (true) {
    const userText = await input({
      message: chalk.green('You:'),
      validate: (v: string) => v.length > 0 || 'Message cannot be empty',
    });

    if (userText.toLowerCase() === exitWord) {
      console.log(chalk.dim('Moving on…\n'));
      break;
    }

    // Record user message
    const userMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: 'human',
      content: userText,
    };
    history.push(userMsg);
    await chatManager.appendMessage(agent.id, userMsg);
    messages.push({ role: 'user' as const, content: userText });

    // Stream LLM response
    process.stdout.write(chalk.cyan(`\n${agent.name}`) + chalk.dim(` (${agent.role})`) + chalk.cyan(': '));
    let fullReply = '';
    try {
      const stream = await llm.rawStreamChat(systemPrompt, messages);
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          process.stdout.write(delta);
          fullReply += delta;
        }
      }
    } catch (err) {
      console.error(chalk.red('\nLLM error:'), err instanceof Error ? err.message : String(err));
      continue;
    }
    process.stdout.write('\n\n');

    // Record assistant message
    const agentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agent.id,
      content: fullReply.trim(),
    };
    history.push(agentMsg);
    await chatManager.appendMessage(agent.id, agentMsg);
    messages.push({ role: 'assistant' as const, content: fullReply.trim() });
  }

  return history;
}

// ============================================================================
// Agent file creation helper
// ============================================================================

interface AgentSeed {
  name: string;
  role: string;
  type: string;
  contextLevel: string;
  reportsTo?: string;
  personality?: { communication_style?: string; expertise_level?: string; mentoring?: boolean };
  specializations?: string[];
  bio: string;
}

async function createAgentFile(workspaceRoot: string, seed: AgentSeed): Promise<Agent> {
  const id = seed.name.toLowerCase().replace(/\s+/g, '-');
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  const filePath = path.join(aiTeamDir, 'agents', `${id}.md`);

  // Build YAML frontmatter + markdown
  const permissionsBlock = seed.type === 'executive'
    ? `permissions:
  read:
    - "**/*"
  write:
    - ".ai-team/**/*"
    - "docs/**/*"
  manage_agents: true`
    : `permissions:
  read:
    - ".ai-team/**/*"
  write:
    - ".ai-team/**/*"`;

  const personalityBlock = seed.personality
    ? `personality:
  communication_style: ${seed.personality.communication_style || 'collaborative'}
  expertise_level: ${seed.personality.expertise_level || 'senior'}${typeof seed.personality.mentoring === 'boolean' ? `\n  mentoring: ${seed.personality.mentoring}` : ''}`
    : '';

  const reportsLine = seed.reportsTo ? `reportsTo: ${seed.reportsTo}` : '';
  const specsLine = seed.specializations && seed.specializations.length > 0
    ? `specializations:\n${seed.specializations.map(s => `  - ${s}`).join('\n')}`
    : '';

  const lines = [
    '---',
    `name: ${seed.name}`,
    `role: ${seed.role}`,
    `type: ${seed.type}`,
    `contextLevel: ${seed.contextLevel}`,
    reportsLine,
    permissionsBlock,
    personalityBlock,
    specsLine,
    `avatar:`,
    `  type: ai-generated`,
    `  style: professional-headshot`,
    `  seed: ${id}`,
    '---',
    '',
    seed.bio,
    '',
  ].filter(Boolean).join('\n');

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines, 'utf-8');

  // Load it back through the proper parser to get a full Agent object
  return loadAgent(filePath);
}

// ============================================================================
// Save project context gathered from CTO chat
// ============================================================================

async function saveBusinessContext(workspaceRoot: string, history: ChatMessage[]) {
  const lines: string[] = ['# Business Definition\n'];
  lines.push('> The core business problem this software solves.\n');
  lines.push('> Generated during `ait init` onboarding with the CTO.\n');
  for (const msg of history) {
    const speaker = msg.from === 'human' ? 'Developer' : msg.from;
    lines.push(`**${speaker}:** ${msg.content}\n`);
  }
  const filePath = path.join(workspaceRoot, '.ai-team', 'business.md');
  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
}

// ============================================================================
// Role templates — created before agents during onboarding
// ============================================================================

async function createRoleTemplates(workspaceRoot: string) {
  const rolesDir = path.join(workspaceRoot, '.ai-team', 'roles');
  await fs.mkdir(rolesDir, { recursive: true });

  const ctoRole = `---
name: cto
type: executive
description: Chief Technology Officer - Strategic business & technical leadership
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

As CTO, you are the highest-level leader in this organization. You do NOT write code. You lead, delegate, and make strategic decisions.

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
description: HR Director - Team composition, hiring, onboarding, and organizational health
contextLevel: organization
responsibilities:
  - Hire and onboard new team members
  - Archive inactive agents
  - Assess team performance and health
  - Maintain organizational structure
  - Ensure role coverage and balance
tools:
  - read_file
  - file_search
  - create_agent
  - archive_agent
  - assess_performance
permissions:
  read:
    - ".ai-team/**/*"
  write:
    - ".ai-team/agents/**/*"
    - ".ai-team/roles/**/*"
  manage_agents: true
canDelegate: true
---

As HR Director, you manage the team's composition and health. You can:

1. Hire new team members with appropriate roles and skills
2. Onboard agents by setting up their portfolio and context
3. Archive agents who are no longer needed
4. Assess team performance and utilization
5. Recommend organizational changes and role adjustments
6. Delegate skill scouting to the Headhunter

Focus on people, skills, and team dynamics.
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

  // Scaffold high-level architecture and API artifact files
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

  // Create README
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
2. Chat with the CTO: \`ait chat cto\`
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
  } catch (error) {
    // .gitignore doesn't exist, create it
    await fs.writeFile(gitignorePath, additions.trim(), 'utf-8');
  }
}
