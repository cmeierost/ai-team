import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { AgentManager } from '@ai-team/core';

interface FireOptions {
  force?: boolean;
}

export async function fireCommand(agentQuery: string, options: FireOptions) {
  const workspaceRoot = process.cwd();
  const agentManager = new AgentManager(workspaceRoot);
  await agentManager.initialize();
  const matches = agentManager.resolveAgent(agentQuery);

  if (matches.length === 0) {
    console.log(chalk.red(`No agent found matching "${agentQuery}".`));
    process.exit(1);
  }

  let agent;
  if (matches.length > 1) {
    console.log(chalk.yellow(`Multiple agents match "${agentQuery}":`));
    for (const m of matches) {
      console.log(chalk.dim(`  - ${m.name} (${m.role}) [${m.id}]`));
    }
    process.exit(1);
  } else {
    agent = matches[0];
  }

  // Confirm unless --force
  if (!options.force) {
    const confirm = (await import('@inquirer/prompts')).confirm;
    const ok = await confirm({
      message: `Are you sure you want to fire ${agent.name} (${agent.role})? This will delete their agent file.`,
      default: false,
    });
    if (!ok) {
      console.log(chalk.yellow('Aborted.'));
      process.exit(0);
    }
  }

  // Delete agent file
  if (agent.filePath && agent.filePath.endsWith('.md')) {
    await fs.unlink(agent.filePath);
    console.log(chalk.green(`Fired ${agent.name} (${agent.role}) and deleted ${path.relative(workspaceRoot, agent.filePath)}`));
  } else {
    console.log(chalk.red('Could not determine agent file path.'));
    process.exit(1);
  }
}
