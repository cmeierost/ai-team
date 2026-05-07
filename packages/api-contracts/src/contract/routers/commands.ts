import type { ApiDescription } from '@ts-http/core';
import type { ICommand } from '@ai-team/core';

/** Entry in the in-chat slash-command registry returned by `commands.list`. */
export type ChatCommandRegistryEntry = Pick<
  ICommand<unknown, unknown, unknown>,
  'key' | 'usage' | 'description' | 'aliases' | 'availableIn'
>;

export interface ICommandsService {
  list(): Promise<ChatCommandRegistryEntry[]>;
}

export const commandsDesc: ApiDescription<ICommandsService> = {
  subRoute: '/api/commands',
  mapping: {
    list: { method: 'GET', path: '' },
  },
};
