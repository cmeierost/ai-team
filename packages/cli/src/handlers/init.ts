import type { InitOptions, InitResult } from '@ai-team/api-contracts';
import type { ICliCommandClient } from '../cli-command-client.js';

export async function renderInit(
  client: ICliCommandClient,
  options: InitOptions
): Promise<InitResult> {
  let initResult: InitResult = {};

  for await (const event of client.streamInteraction(
    {
      command: 'setup-init',
      payload: { options },
    },
    {
      invocationSurface: 'cli',
      calledByHuman: true,
    }
  )) {
    if (event.kind === 'token') {
      process.stdout.write(event.text);
    } else if (event.kind === 'log') {
      const output = event.level === 'error' ? process.stderr : process.stdout;
      output.write(`${event.message}\n`);
    } else if (event.kind === 'error') {
      throw new Error(event.message);
    } else if (event.kind === 'result') {
      const result = event.data as
        | { status?: string; message?: string; data?: InitResult }
        | undefined;
      if (result?.status === 'error') {
        throw new Error(result.message || 'Initialization failed.');
      }
      initResult = result?.data ?? {};
    }
  }

  return initResult;
}
