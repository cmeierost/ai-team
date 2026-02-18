/**
 * Create command - create agents or roles
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { AgentManager, SkillManager, ContextLevel, RoleType } from '@ai-team/core';

interface CreateOptions {
  name?: string;
  role?: string;
  interactive?: boolean;
}

export async function createCommand(type: string, options: CreateOptions) {
  try {
    const workspaceRoot = process.cwd();

    switch (type) {
      case 'agent':
        await createAgent(workspaceRoot, options);
        break;
      case 'skill':
        await createSkill(workspaceRoot, options);
        break;
      default:
        console.error(chalk.red(`Unknown type: ${type}`));
        console.log('Usage: ai-team create <agent|skill>');
        process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('Error creating:'), error);
    process.exit(1);
  }
}

async function createAgent(workspaceRoot: string, options: CreateOptions) {
  const agentManager = new AgentManager(workspaceRoot);
  await agentManager.initialize();

  let config: any = {};

  if (options.interactive || (!options.name && !options.role)) {
    // Interactive mode
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
        type: 'list',
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

    config = {
      name: answers.name,
      role: answers.role,
      contextLevel: answers.contextLevel,
      reportsTo: answers.reportsTo || undefined,
      features: answers.features ? answers.features.split(',').map((f: string) => f.trim()) : undefined,
    };
  } else {
    // Non-interactive mode
    if (!options.name || !options.role) {
      console.error(chalk.red('Error: --name and --role are required in non-interactive mode'));
      process.exit(1);
    }

    config = {
      name: options.name,
      role: options.role,
      contextLevel: ContextLevel.MODULE,
    };
  }

  const agent = await agentManager.createAgent(config);
  
  console.log(chalk.green('✓ Created agent:'), chalk.cyan(agent.name));
  console.log(chalk.dim(`  File: ${agent.filePath}`));
}

async function createSkill(workspaceRoot: string, options: CreateOptions) {
  const skillManager = new SkillManager(workspaceRoot);
  await skillManager.initialize();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Skill name:',
      validate: (input: string) => input.length > 0 || 'Name is required',
    },
    {
      type: 'list',
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
      type: 'list',
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

  const skill = await skillManager.createSkill(
    {
      name: answers.name,
      type: answers.type,
      description: answers.description,
      contextLevel: answers.contextLevel,
      responsibilities: [],
      tools: [],
      permissions: { read: [], write: [] },
    },
    answers.instructions
  );

  console.log(chalk.green('✓ Created skill:'), chalk.cyan(skill.name));
  console.log(chalk.dim(`  File: ${skill.filePath}`));
}
