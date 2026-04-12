import type { IAiTeamMediator } from '@ai-team/api-client';
import { runCommandStream } from './stream-runner.js';

export async function hhRefreshCommand(client: IAiTeamMediator) {
  await runCommandStream(client, {
    command: 'hhRefresh',
    payload: {},
  });
}
