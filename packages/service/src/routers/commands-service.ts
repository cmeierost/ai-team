import type { ICommandsService } from '@ai-team/api-client';
import { IN_CHAT_COMMAND_REGISTRY } from '../command-registry.js';
import type { ChatCommandRegistryEntry } from '@ai-team/api-client';

export class CommandsService implements ICommandsService {
  async list(): Promise<ChatCommandRegistryEntry[]> {
    return IN_CHAT_COMMAND_REGISTRY as ChatCommandRegistryEntry[];
  }
}
