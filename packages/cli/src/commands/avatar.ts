import chalk from 'chalk';
import {
  AgentManager,
  loadTeamConfig,
} from '@ai-team/core';
import { interactiveAvatarSelection } from '../utils/avatar-selection.js';

interface AvatarCommandOptions {
  workspaceRoot?: string;
}

export async function avatarCommand(agentQuery: string, options: AvatarCommandOptions) {
  const workspaceRoot = options.workspaceRoot || process.cwd();

  try {
    // Step 1: Resolve agent
    console.log(chalk.blue(`Looking for agent: ${agentQuery}`));
    const agentManager = new AgentManager(workspaceRoot);
    await agentManager.initialize();
    const agent = agentManager.resolveAgentOrThrow(agentQuery);
    console.log(chalk.green(`✓ Found agent: ${agent.name}`));

    // Step 2: Load team config
    const teamConfig = await loadTeamConfig(workspaceRoot);
    if (!teamConfig) {
      console.error(chalk.red('\n✗ Team config not found. Run `ait init` first.\n'));
      process.exit(1);
    }

    // Step 3: Interactive avatar selection
    const success = await interactiveAvatarSelection(agent, workspaceRoot, teamConfig);
    if (!success) {
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`\n✗ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}
