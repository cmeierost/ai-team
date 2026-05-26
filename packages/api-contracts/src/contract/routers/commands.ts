import type { ApiDescription } from '@ts-http/core';
import type { ICommandDescriptor } from '@ai-team/core';

/** Entry in the in-chat slash-command registry returned by `commands.list`. */
export type ChatCommandRegistryEntry = Pick<
  ICommandDescriptor<unknown>,
  | 'key'
  | 'usage'
  | 'description'
  | 'aliases'
  | 'availableIn'
  | 'path'
  | 'help'
  | 'llm'
  | 'intents'
  | 'intentExamples'
  | 'input'
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
