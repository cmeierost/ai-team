import type {
  IAiTeamMediator,
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
} from '@ai-team/api-client';
import { runCommandStream } from './stream-runner.js';

export async function providerListCommand(
  client: IAiTeamMediator,
  options: ProviderListOptions = {}
) {
  await runCommandStream(client, {
    command: 'providerList',
    payload: { options },
  });
}

export async function providerModelsCommand(
  client: IAiTeamMediator,
  options: ProviderModelsOptions
) {
  await runCommandStream(client, {
    command: 'providerModels',
    payload: { options },
  });
}

export async function providerModelsRefreshCommand(
  client: IAiTeamMediator,
  options: RefreshProviderModelsOptions
) {
  await runCommandStream(client, {
    command: 'providerModelsRefresh',
    payload: { options },
  });
}
