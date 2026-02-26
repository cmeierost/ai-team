import type { AiTeamClient, ProviderListOptions, ProviderModelsOptions, RefreshProviderModelsOptions } from '@ai-team/api-client';
import { runCommandStream } from './stream-runner.js';

export async function providerListCommand(client: AiTeamClient, options: ProviderListOptions = {}) {
  await runCommandStream(client, {
    command: 'providerList',
    payload: { options },
  });
}

export async function providerModelsCommand(client: AiTeamClient, options: ProviderModelsOptions) {
  await runCommandStream(client, {
    command: 'providerModels',
    payload: { options },
  });
}

export async function providerModelsRefreshCommand(client: AiTeamClient, options: RefreshProviderModelsOptions) {
  await runCommandStream(client, {
    command: 'providerModelsRefresh',
    payload: { options },
  });
}
