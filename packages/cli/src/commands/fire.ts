import type { AiTeamClient, FireOptions } from '@ai-team/api-client';
import { confirm } from '@inquirer/prompts';
import { runCommandStream } from './stream-runner.js';

export async function fireCommand(client: AiTeamClient, agentQuery: string, options: FireOptions) {
  if (!options.force) {
    const ok = await confirm({
      message: `Are you sure you want to fire '${agentQuery}'? This will delete their agent file.`,
      default: false,
    });

    if (!ok) {
      return;
    }
  }

  await runCommandStream(client, {
    command: 'fire',
    payload: { employeeQuery: agentQuery, options: { ...options, force: true } },
  });
}
