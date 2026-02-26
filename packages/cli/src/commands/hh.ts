import type { AiTeamClient } from '@ai-team/api-client';
import { runCommandStream } from './stream-runner.js';

export async function hhRefreshCommand(client: AiTeamClient) {
  await runCommandStream(client, {
    command: 'hhRefresh',
    payload: {},
  });
}
