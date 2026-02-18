/**
 * List command - list all agents
 */

import chalk from 'chalk';
import { AgentManager } from '@ai-team/core';

interface ListOptions {
  role?: string;
  feature?: string;
  json?: boolean;
}

export async function listCommand(options: ListOptions) {
  try {
    const workspaceRoot = process.cwd();
    const agentManager = new AgentManager(workspaceRoot);
    await agentManager.initialize();

    let agents = agentManager.getAllAgents();

    // Apply filters
    if (options.role) {
      agents = agents.filter(a => a.role === options.role);
    }

    if (options.feature) {
      const feature = options.feature;
      agents = agents.filter(a => a.features?.includes(feature));
    }

    if (options.json) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }

    // Pretty print
    if (agents.length === 0) {
      console.log(chalk.yellow('No team members found. Run') + ' ai-team init ' + chalk.yellow('to get started.'));
      return;
    }

    console.log(chalk.bold(`\n${agents.length} Team Members\n`));

    for (const agent of agents) {
      const status = getStatusIcon(agent.status);
      console.log(`${status} ${chalk.cyan(agent.name)} ${chalk.dim(`(${agent.role})`)}`);
      
      if (agent.reportsTo) {
        console.log(chalk.dim(`  ├─ Reports to: ${agent.reportsTo}`));
      }
      
      if (agent.features && agent.features.length > 0) {
        console.log(chalk.dim(`  ├─ Features: ${agent.features.join(', ')}`));
      }
      
      if (agent.conversationCount) {
        console.log(chalk.dim(`  └─ Conversations: ${agent.conversationCount}`));
      }
      
      console.log('');
    }
  } catch (error) {
    console.error(chalk.red('Error listing team members:'), error);
    process.exit(1);
  }
}

function getStatusIcon(status?: string): string {
  switch (status) {
    case 'available':
      return chalk.green('●');
    case 'busy':
      return chalk.yellow('●');
    case 'in-meeting':
      return chalk.blue('●');
    case 'offline':
      return chalk.gray('●');
    default:
      return chalk.gray('○');
  }
}
