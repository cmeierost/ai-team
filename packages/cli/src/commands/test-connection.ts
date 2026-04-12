/**
 * Test-connection command - verify LLM connectivity
 */

import type { IAiTeamMediator, TestConnectionOptions } from '@ai-team/api-client';
import { runCommandStream } from './stream-runner.js';

export async function testConnectionCommand(
  client: IAiTeamMediator,
  options: TestConnectionOptions = {}
) {
  await runCommandStream(client, {
    command: 'testConnection',
    payload: { options },
  });
}
