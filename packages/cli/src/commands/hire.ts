import inquirer from 'inquirer';
import chalk from 'chalk';
import type { IAiTeamMediator, HireOptions } from '@ai-team/api-client';
import { AgentManager, loadTeamConfig } from '@ai-team/infrastructure';
import { runCommandStream } from './stream-runner.js';
import { interactiveAvatarSelection } from '../utils/avatar-selection.js';

export async function hireCommand(client: IAiTeamMediator, options: HireOptions) {
  await runCommandStream(client, {
    command: 'hire',
    payload: { options },
  });

  // Offer avatar selection after hiring (only if not chat mode)
  if (options.name && !options.chat) {
    try {
      const { wantAvatar } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'wantAvatar',
          message: 'Would you like to set an avatar for the new hire?',
          default: false,
        },
      ]);

      if (wantAvatar) {
        const workspaceRoot = process.cwd();
        const agentManager = new AgentManager(workspaceRoot);
        const agent = await agentManager.resolveAgentOrThrowAsync(options.name);
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
