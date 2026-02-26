/**
 * Test-connection command - verify LLM connectivity
 */

import type { AiTeamClient, TestConnectionOptions } from '@ai-team/api-client';
import { runCommandStream } from './stream-runner.js';

export async function testConnectionCommand(client: AiTeamClient, options: TestConnectionOptions = {}) {
  await runCommandStream(client, {
    command: 'testConnection',
    payload: { options },
  });
}
