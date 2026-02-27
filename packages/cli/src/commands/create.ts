import inquirer from 'inquirer';
import chalk from 'chalk';
import { ContextLevel, RoleType, AgentManager, loadTeamConfig } from '@ai-team/core';
import type {
  AiTeamClient,
  CreateAgentSetupInput,
  CreateOptions,
  CreateSkillSetupInput,
} from '@ai-team/api-client';
import type { LlmGenerationParams, LlmProfile } from '@ai-team/core';
import { runCommandStream } from './stream-runner.js';
import { interactiveAvatarSelection } from '../utils/avatar-selection.js';

export async function createCommand(client: AiTeamClient, type: string, options: CreateOptions) {
  const normalizedType = type.toLowerCase();
  const nextOptions = { ...options };
  let agentName: string | undefined;

  if (normalizedType === 'agent' && (options.interactive || (!options.name && !options.role))) {
    const setup = await askAgentSetup();
    nextOptions.setup = setup;
    agentName = setup.name;
  }

  if (normalizedType === 'skill') {
    const setup = await askSkillSetup();
    nextOptions.setup = setup;
  }

  await runCommandStream(client, {
    command: 'create',
    payload: { type: normalizedType, options: nextOptions },
  });

  // Offer avatar selection after agent creation (only if interactive)
  if (normalizedType === 'agent' && agentName && nextOptions.interactive !== false) {
    try {
      const { wantAvatar } = await inquirer.prompt([{
        type: 'confirm',
        name: 'wantAvatar',
        message: 'Would you like to set an avatar now?',
        default: false,
      }]);

      if (wantAvatar) {
        const workspaceRoot = process.cwd();
        const agentManager = new AgentManager(workspaceRoot);
        await agentManager.initialize();
        
        const agent = agentManager.resolveAgentOrThrow(agentName);
        const teamConfig = await loadTeamConfig(workspaceRoot);
        
        if (teamConfig) {
          await interactiveAvatarSelection(agent, workspaceRoot, teamConfig);
        } else {
          console.error(chalk.yellow('\n⚠ Team config not found, skipping avatar setup.\n'));
        }
      }
    } catch (error) {
      console.error(chalk.yellow(`\n⚠ Could not set avatar: ${(error as Error).message}\n`));
    }
  }
}

async function askAgentSetup(): Promise<CreateAgentSetupInput> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Agent name:',
      validate: (input: string) => input.length > 0 || 'Name is required',
    },
    {
      type: 'input',
      name: 'role',
      message: 'Role (e.g., senior-developer, tech-lead):',
      validate: (input: string) => input.length > 0 || 'Role is required',
    },
    {
      type: 'select',
      name: 'contextLevel',
      message: 'Context level:',
      choices: Object.values(ContextLevel),
      default: ContextLevel.MODULE,
    },
    {
      type: 'input',
      name: 'reportsTo',
      message: 'Reports to (agent ID, optional):',
    },
    {
      type: 'input',
      name: 'features',
      message: 'Features (comma-separated, optional):',
    },
  ]);

  return {
    kind: 'agent',
    name: answers.name,
    role: answers.role,
    contextLevel: answers.contextLevel,
    reportsTo: answers.reportsTo || undefined,
    features: answers.features ? answers.features.split(',').map((part: string) => part.trim()).filter(Boolean) : undefined,
    llm: await askLlmProfile('Add agent-specific LLM overrides?'),
  };
}

async function askSkillSetup(): Promise<CreateSkillSetupInput> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Skill name:',
      validate: (input: string) => input.length > 0 || 'Name is required',
    },
    {
      type: 'select',
      name: 'type',
      message: 'Role type:',
      choices: Object.values(RoleType),
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      validate: (input: string) => input.length > 0 || 'Description is required',
    },
    {
      type: 'select',
      name: 'contextLevel',
      message: 'Context level:',
      choices: Object.values(ContextLevel),
    },
    {
      type: 'editor',
      name: 'instructions',
      message: 'Instructions (opens editor):',
      default: 'Enter detailed instructions for this role...',
    },
  ]);

  return {
    kind: 'skill',
    name: answers.name,
    type: answers.type,
    description: answers.description,
    contextLevel: answers.contextLevel,
    instructions: answers.instructions,
    llm: await askLlmProfile('Add role-level LLM overrides for this skill?'),
  };
}

async function askLlmProfile(message: string): Promise<LlmProfile | undefined> {
  const { enabled } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enabled',
      message,
      default: false,
    },
  ]);

  if (!enabled) {
    return undefined;
  }

  const basic = await inquirer.prompt([
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
      message: 'Configure advanced generation params?',
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

    const stop = toStringList(raw.stop);
    params = {
      temperature: toNumber(raw.temperature),
      maxTokens: toInt(raw.maxTokens),
      topP: toNumber(raw.topP),
      presencePenalty: toNumber(raw.presencePenalty),
      frequencyPenalty: toNumber(raw.frequencyPenalty),
      stop: stop.length > 0 ? stop : undefined,
    };

    if (Object.values(params).every(value => value === undefined)) {
      params = undefined;
    }
  }

  const profile: LlmProfile = {
    provider: toNonEmptyString(basic.provider),
    modelKey: toNonEmptyString(basic.modelKey),
    model: toNonEmptyString(basic.model),
    baseUrl: toNonEmptyString(basic.baseUrl),
    params,
  };

  if (Object.values(profile).every(value => value === undefined)) {
    return undefined;
  }

  return profile;
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toInt(value: unknown): number | undefined {
  const parsed = toNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  return Number.isInteger(parsed) ? parsed : undefined;
}

function toStringList(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}
