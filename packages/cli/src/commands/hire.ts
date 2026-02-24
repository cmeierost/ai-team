/**
 * Hire command - hire a new team member through an interactive workflow
 *
 * Phase 1: Form-based Q&A with selections (name, role, skills, reporting)
 * Phase 2: Optionally chat with the new hire to refine their portfolio,
 *          or open the agent.md in an editor
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import {
  AgentManager,
  ChatManager,
  ChatMessage,
  ContextLevel,
  RoleType,
  loadTeamConfig,
} from '@ai-team/core';
import type { LlmGenerationParams, LlmProfile } from '@ai-team/core';
import { listCatalogSkills, readSkillContent } from './hh.js';

interface HireOptions {
  name?: string;
  role?: string;
  skill?: string;
  type?: string;
  reportsTo?: string;
  chat?: boolean;
}

function getPersonalityForHire(role: string, roleType: RoleType) {
  const r = role.toLowerCase();

  if (/architect|cto/.test(r) || roleType === RoleType.EXECUTIVE) {
    return {
      communication_style: 'strategic' as const,
      expertise_level: 'executive' as const,
      mentoring: true,
      profile: [
        'Highly intelligent and systems-focused',
        'Determined, strategic, and structured',
        'Communicates decisions clearly and confidently',
      ],
    };
  }

  if (/hr|people|recruit|headhunt/.test(r)) {
    return {
      communication_style: 'supportive' as const,
      expertise_level: roleType === RoleType.LEADERSHIP ? 'senior' as const : 'mid-level' as const,
      mentoring: true,
      profile: [
        'Friendly, chatty, and people-oriented',
        'Strong at understanding motivation and fit',
        'Keeps momentum while staying empathetic',
      ],
    };
  }

  if (/qa|test|security|data|analyst/.test(r)) {
    return {
      communication_style: 'analytical' as const,
      expertise_level: roleType === RoleType.TEAM_LEAD ? 'senior' as const : 'mid-level' as const,
      mentoring: true,
      profile: [
        'Analytical and detail-oriented',
        'Thinks in trade-offs, risks, and evidence',
        'High standards, clear rationale',
      ],
    };
  }

  return {
    communication_style: 'collaborative' as const,
    expertise_level: roleType === RoleType.TEAM_LEAD ? 'senior' as const : 'mid-level' as const,
    mentoring: true,
    profile: [
      'Motivated, practical, and reliable',
      'Works well with others and communicates clearly',
      'Balances speed with quality',
    ],
  };
}

export async function hireCommand(options: HireOptions) {
  try {
    const workspaceRoot = process.cwd();
    const agentManager = new AgentManager(workspaceRoot);
    await agentManager.initialize();

    // Check if skills catalog exists
    const catalogSkills = await listCatalogSkills(workspaceRoot);

    if (catalogSkills.length === 0) {
      console.log(chalk.yellow('⚠ No skills found in .ai-team/skills-catalog/'));
      console.log(
        chalk.dim('  Run ') +
          chalk.cyan('ai-team skills pull') +
          chalk.dim(' to fetch skill templates from GitHub')
      );

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Continue hiring without skill templates?',
          default: false,
        },
      ]);

      if (!proceed) return;
    }

    // =========================================================================
    // Phase 1: Form-based Q&A
    // =========================================================================

    const isInteractive = !options.name || !options.role;
    let config: {
      name: string;
      role: string;
      selectedSkills: string[];
      roleType: RoleType;
      contextLevel: ContextLevel;
      reportsTo?: string;
      features?: string[];
      specializations?: string[];
      pronouns?: string;
      timezone?: string;
      llm?: LlmProfile;
      cliTools?: string[];
    };

    const teamConfig = await loadTeamConfig(workspaceRoot);
    const globalAllowedCliTools = teamConfig?.allowedCliTools || [];

    if (isInteractive) {
      config = await interactiveHireForm(agentManager, catalogSkills, globalAllowedCliTools);
    } else {
      config = {
        name: options.name!,
        role: options.role!,
        selectedSkills: options.skill ? [options.skill] : [],
        roleType: (options.type as RoleType) || RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.MODULE,
        reportsTo: options.reportsTo,
        llm: undefined,
        cliTools: undefined,
      };
    }

    const personalityPreset = getPersonalityForHire(config.role, config.roleType);

    // Build the agent's portfolio markdown from selected skills
    const portfolioSections: string[] = [];
    portfolioSections.push(`# ${config.name} — ${config.role}\n`);
    portfolioSections.push('## Personality Profile\n');
    for (const line of personalityPreset.profile) {
      portfolioSections.push(`- ${line}`);
    }
    portfolioSections.push('');

    if (config.selectedSkills.length > 0) {
      portfolioSections.push('## Skills\n');
      for (const skillName of config.selectedSkills) {
        const content = await readSkillContent(workspaceRoot, skillName);
        if (content) {
          // Strip frontmatter, keep the body
          const body = content.replace(/^---[\s\S]*?---\s*/, '').trim();
          portfolioSections.push(`### ${skillName}\n\n${body}\n`);
        } else {
          portfolioSections.push(`### ${skillName}\n`);
        }
      }
    }

    const markdown = portfolioSections.join('\n');

    // Create the agent
    const spinner = ora('Creating team member...').start();

    try {
      const agent = await agentManager.createAgent(
        {
          name: config.name,
          role: config.role,
          type: config.roleType,
          contextLevel: config.contextLevel,
          reportsTo: config.reportsTo,
          features: config.features,
          specializations: config.specializations,
          pronouns: config.pronouns,
          timezone: config.timezone,
          personality: {
            communication_style: personalityPreset.communication_style,
            expertise_level: personalityPreset.expertise_level,
            mentoring: personalityPreset.mentoring,
          },
          avatar: {
            type: 'ai-generated',
            style: 'professional-headshot',
            seed: `${config.name.toLowerCase().replace(/\s+/g, '-')}-${config.role}`,
          },
          llm: config.llm,
          cliTools: config.cliTools,
        },
        undefined
      );

      // Write the markdown body to the agent file (saveAgent only writes frontmatter)
      await appendMarkdownToAgent(agent.filePath, markdown);

      spinner.succeed(
        chalk.green(`✓ Hired ${chalk.bold(config.name)} as ${chalk.cyan(config.role)}`)
      );
      console.log(chalk.dim(`  File: ${agent.filePath}`));
      console.log(chalk.dim(`  ID: ${agent.id}`));

      if (config.reportsTo) {
        const manager = agentManager.getAgent(config.reportsTo);
        if (manager) {
          console.log(chalk.dim(`  Reports to: ${manager.name} (${manager.role})`));
        }
      }

      if (config.selectedSkills.length > 0) {
        console.log(
          chalk.dim(`  Skills: ${config.selectedSkills.join(', ')}`)
        );
      }
      if (config.llm) {
        const paramsSummary = config.llm.params
          ? Object.entries(config.llm.params)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('|') : value}`)
              .join(', ')
          : '';
        const llmSummary = [
          config.llm.provider ? `provider=${config.llm.provider}` : undefined,
          config.llm.model ? `model=${config.llm.model}` : undefined,
          paramsSummary ? `params(${paramsSummary})` : undefined,
        ]
          .filter(Boolean)
          .join(' · ');
        console.log(chalk.dim(`  LLM override: ${llmSummary || 'custom'}`));
      }
      if (config.cliTools && config.cliTools.length > 0) {
        console.log(chalk.dim(`  CLI tools: ${config.cliTools.join(', ')}`));
      }

      // =====================================================================
      // Phase 2: Refine via chat or editor
      // =====================================================================

      if (options.chat === false) return;

      console.log('');
      const { refineChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'refineChoice',
          message: `Chat with ${config.name} to refine their skills?`,
          choices: [
            { name: 'Yes — open a chat session', value: 'chat' },
            { name: 'Open portfolio in editor', value: 'editor' },
            { name: 'No — done for now', value: 'skip' },
          ],
          default: 'chat',
        },
      ]);

      if (refineChoice === 'chat') {
        await onboardingChat(workspaceRoot, agentManager, agent.id, config.name);
      } else if (refineChoice === 'editor') {
        await openInEditor(agent.filePath);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to create team member'));
      throw error;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    } else {
      console.error(chalk.red('Error during hire:'), error);
    }
    process.exit(1);
  }
}

/**
 * Interactive form for hiring a new team member
 */
async function interactiveHireForm(
  agentManager: AgentManager,
  catalogSkills: { name: string; description: string }[],
  globalAllowedCliTools: string[],
) {
  console.log(chalk.bold('\n👤 Hire a New Team Member\n'));

  // 1. Name
  const { name } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Employee name (e.g., "Sarah Chen"):',
      validate: (input: string) => {
        if (input.trim().length === 0) return 'Name is required';
        const id = input.toLowerCase().replace(/\s+/g, '-');
        if (agentManager.getAgent(id)) {
          return `An agent with ID "${id}" already exists`;
        }
        return true;
      },
    },
  ]);

  // 2. Role name
  const { role } = await inquirer.prompt([
    {
      type: 'input',
      name: 'role',
      message: 'Unique role name (e.g., "senior-frontend-developer"):',
      validate: (input: string) => {
        if (input.trim().length === 0) return 'Role is required';
        const existing = agentManager
          .getAllAgents()
          .find(a => a.role.toLowerCase() === input.toLowerCase());
        if (existing) {
          return `Role "${input}" is taken by ${existing.name} (${existing.id})`;
        }
        return true;
      },
      filter: (input: string) => input.toLowerCase().replace(/\s+/g, '-'),
    },
  ]);

  // 3. Pick skills from catalog (if available)
  let selectedSkills: string[] = [];
  if (catalogSkills.length > 0) {
    const { skills } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'skills',
        message: 'Select skills from catalog (space to toggle, enter to confirm):',
        choices: catalogSkills.map(s => ({
          name: `${s.name} — ${s.description.substring(0, 60)}${s.description.length > 60 ? '...' : ''}`,
          value: s.name,
          short: s.name,
        })),
        pageSize: 15,
      },
    ]);
    selectedSkills = skills;
  }

  // 4. Role type
  const { roleType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'roleType',
      message: 'Role type:',
      choices: Object.entries(RoleType).map(([key, value]) => ({
        name: value,
        value: value,
      })),
      default: RoleType.INDIVIDUAL_CONTRIBUTOR,
    },
  ]);

  // 5. Context level
  const { contextLevel } = await inquirer.prompt([
    {
      type: 'list',
      name: 'contextLevel',
      message: 'Context level (what scope of files can they access?):',
      choices: Object.entries(ContextLevel).map(([key, value]) => ({
        name: `${value} — ${contextLevelDescription(value)}`,
        value: value,
      })),
      default: ContextLevel.MODULE,
    },
  ]);

  // 6. Reports to
  const existingAgents = agentManager.getAllAgents();
  let reportsTo: string | undefined;

  if (existingAgents.length > 0) {
    const { manager } = await inquirer.prompt([
      {
        type: 'list',
        name: 'manager',
        message: 'Reports to:',
        choices: [
          { name: chalk.dim('(none)'), value: '' },
          ...existingAgents.map(a => ({
            name: `${a.name} — ${a.role}`,
            value: a.id,
          })),
        ],
      },
    ]);
    reportsTo = manager || undefined;
  }

  // 7. Optional extras
  const { wantExtras } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'wantExtras',
      message: 'Add optional details (features, specializations, etc.)?',
      default: false,
    },
  ]);

  let features: string[] | undefined;
  let specializations: string[] | undefined;
  let pronouns: string | undefined;
  let timezone: string | undefined;
  let llm: LlmProfile | undefined;
  let cliTools: string[] | undefined;

  if (wantExtras) {
    const extras = await inquirer.prompt([
      {
        type: 'input',
        name: 'features',
        message: 'Features (comma-separated, e.g., "login, dashboard"):',
      },
      {
        type: 'input',
        name: 'specializations',
        message: 'Specializations (comma-separated, e.g., "react, typescript"):',
      },
      {
        type: 'input',
        name: 'pronouns',
        message: 'Pronouns (e.g., "she/her"):',
      },
      {
        type: 'input',
        name: 'timezone',
        message: 'Timezone (e.g., "PST"):',
      },
    ]);

    features = extras.features
      ? extras.features.split(',').map((f: string) => f.trim()).filter(Boolean)
      : undefined;
    specializations = extras.specializations
      ? extras.specializations.split(',').map((s: string) => s.trim()).filter(Boolean)
      : undefined;
    pronouns = extras.pronouns || undefined;
    timezone = extras.timezone || undefined;
  }

  const { configureLlm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureLlm',
      message: 'Add agent-specific LLM settings?',
      default: false,
    },
  ]);

  if (configureLlm) {
    llm = await promptLlmProfile();
  }

  if (globalAllowedCliTools.length > 0) {
    const { selectedCliTools } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedCliTools',
        message: 'Allow command line tools for this employee (from global config):',
        choices: globalAllowedCliTools.map(tool => ({
          name: tool,
          value: tool,
        })),
      },
    ]);

    cliTools = selectedCliTools.length > 0 ? selectedCliTools : undefined;
  }

  return {
    name: name.trim(),
    role,
    selectedSkills,
    roleType,
    contextLevel,
    reportsTo,
    features,
    specializations,
    pronouns,
    timezone,
    llm,
    cliTools,
  };
}

async function promptLlmProfile(): Promise<LlmProfile | undefined> {
  const base = await inquirer.prompt([
    {
      type: 'input',
      name: 'provider',
      message: 'Provider ref or kind (optional):',
    },
    {
      type: 'input',
      name: 'modelKey',
      message: 'Model key from provider dictionary (optional):',
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model override (optional):',
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL override (optional):',
    },
  ]);

  const { tuneParams } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'tuneParams',
      message: 'Configure generation params (temperature, maxTokens, etc.)?',
      default: false,
    },
  ]);

  let params: LlmGenerationParams | undefined;
  if (tuneParams) {
    const raw = await inquirer.prompt([
      {
        type: 'input',
        name: 'temperature',
        message: 'temperature (0-2, optional):',
      },
      {
        type: 'input',
        name: 'maxTokens',
        message: 'maxTokens (integer, optional):',
      },
      {
        type: 'input',
        name: 'topP',
        message: 'topP (0-1, optional):',
      },
      {
        type: 'input',
        name: 'presencePenalty',
        message: 'presencePenalty (-2 to 2, optional):',
      },
      {
        type: 'input',
        name: 'frequencyPenalty',
        message: 'frequencyPenalty (-2 to 2, optional):',
      },
      {
        type: 'input',
        name: 'stop',
        message: 'stop sequences (comma-separated, optional):',
      },
    ]);

    const stop = parseStringList(raw.stop);
    params = {
      temperature: parseNumber(raw.temperature),
      maxTokens: parseIntNumber(raw.maxTokens),
      topP: parseNumber(raw.topP),
      presencePenalty: parseNumber(raw.presencePenalty),
      frequencyPenalty: parseNumber(raw.frequencyPenalty),
      stop: stop.length > 0 ? stop : undefined,
    };

    if (Object.values(params).every(v => v === undefined)) {
      params = undefined;
    }
  }

  const profile: LlmProfile = {
    provider: parseNonEmpty(base.provider),
    modelKey: parseNonEmpty(base.modelKey),
    model: parseNonEmpty(base.model),
    baseUrl: parseNonEmpty(base.baseUrl),
    params,
  };

  if (Object.values(profile).every(v => v === undefined)) {
    return undefined;
  }

  return profile;
}

function parseNonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseIntNumber(value: unknown): number | undefined {
  const parsed = parseNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseStringList(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

/**
 * Onboarding chat session with the newly hired agent
 */
async function onboardingChat(
  workspaceRoot: string,
  agentManager: AgentManager,
  agentId: string,
  agentName: string
) {
  const chatManager = new ChatManager(workspaceRoot);

  console.log(chalk.bold(`\n💬 Onboarding chat with ${chalk.cyan(agentName)}`));
  console.log(
    chalk.dim('Refine their skills and portfolio. Type /done to finish, /save to save changes.\n')
  );

  while (true) {
    const { message } = await inquirer.prompt([
      {
        type: 'input',
        name: 'message',
        message: chalk.green('You:'),
        validate: (input: string) => input.length > 0 || 'Message cannot be empty',
      },
    ]);

    const cmd = message.toLowerCase().trim();
    if (cmd === '/done' || cmd === 'exit') {
      console.log(chalk.dim(`\nOnboarding session with ${agentName} complete.`));
      break;
    }

    if (cmd === '/save') {
      console.log(chalk.green('  Portfolio saved.'));
      continue;
    }

    // Save user message
    const userMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: 'human',
      content: message,
    };
    await chatManager.appendMessage(agentId, userMessage);

    // TODO: Integrate with LLM to get agent response and update portfolio
    console.log(
      chalk.cyan(`\n${agentName}:`),
      chalk.dim('(LLM integration pending)')
    );
    console.log(chalk.dim(`  Received: "${message}"\n`));

    // Save placeholder response
    const agentMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agentId,
      content: `I received your message: "${message}". LLM integration is pending.`,
    };
    await chatManager.appendMessage(agentId, agentMessage);
    await agentManager.recordInteraction(agentId);
  }
}

/**
 * Append markdown body to an agent file (after frontmatter)
 */
async function appendMarkdownToAgent(filePath: string, markdown: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  // The file should have frontmatter ending with ---\n
  // Append the markdown body after it
  const updated = content.trimEnd() + '\n' + markdown;
  await fs.writeFile(filePath, updated, 'utf-8');
}

/**
 * Open file in the user's preferred editor
 */
async function openInEditor(filePath: string): Promise<void> {
  const editor = process.env.EDITOR || process.env.VISUAL;

  if (editor) {
    console.log(chalk.dim(`  Opening in ${editor}...`));
    try {
      execSync(`${editor} "${filePath}"`, { stdio: 'inherit' });
    } catch {
      console.log(chalk.dim(`  Could not open editor. File is at:`));
      console.log(chalk.cyan(`  ${filePath}`));
    }
  } else {
    console.log(chalk.dim('  No $EDITOR set. Open the file manually:'));
    console.log(chalk.cyan(`  ${filePath}`));
  }
}

/**
 * Human-friendly descriptions for context levels
 */
function contextLevelDescription(level: ContextLevel): string {
  switch (level) {
    case ContextLevel.TASK:
      return 'Only assigned files (junior dev)';
    case ContextLevel.MODULE:
      return 'Specific modules (senior dev)';
    case ContextLevel.FEATURE:
      return 'Feature area code (team lead)';
    case ContextLevel.REPOSITORY:
      return 'Entire codebase read-only (architect)';
    case ContextLevel.ORGANIZATION:
      return 'Strategic docs only (executive)';
    default:
      return '';
  }
}
