import type {
  ConfigureProviderOptions,
  AddProviderOptions,
  SetProviderOptions,
} from '@ai-team/api-client';
import type { ICliCommandClient } from '../cli-command-client.js';
import { runCommandStream } from './stream-runner.js';

export async function renderProviderConfigure(
  client: ICliCommandClient,
  options: ConfigureProviderOptions = {}
) {
  await runCommandStream(client, {
    command: 'providerConfigure',
    payload: { options },
  });
}

export async function renderProviderAdd(
  client: ICliCommandClient,
  options: AddProviderOptions = {}
) {
  await runCommandStream(client, {
    command: 'providerAdd',
    payload: { options },
  });
}

export async function renderProviderSet(
  client: ICliCommandClient,
  options: SetProviderOptions = {}
) {
  await runCommandStream(client, {
    command: 'providerSet',
    payload: { options },
  });
}

export default renderProviderConfigure;
