import type { ApiDescription } from '@ts-http/core';

/** Entry in the in-chat slash-command registry returned by `commands.list`. */
export interface ChatCommandRegistryEntry {
  key: string;
  usage: string;
  description: string;
  llmCallable: boolean;
  aliases?: string[];
}

export interface ICommandsService {
  list(): Promise<ChatCommandRegistryEntry[]>;
}

export const commandsDesc: ApiDescription<ICommandsService> = {
  subRoute: '/api/commands',
  mapping: {
    list: { method: 'GET', path: '' },
  },
};
