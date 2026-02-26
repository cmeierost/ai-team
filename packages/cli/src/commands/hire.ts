import type { AiTeamClient, HireOptions } from '@ai-team/api-client';
import { runCommandStream } from './stream-runner.js';

export async function hireCommand(client: AiTeamClient, options: HireOptions) {
  await runCommandStream(client, {
    command: 'hire',
    payload: { options },
  });
}
