import type { ChatSlashCommand } from './shared-chat-commands.js';
import type { ChatCommandRegistryEntry } from './chat-commands.command.js';
import { HelpChatCommand } from './help-chat.command.js';
import { WhoChatCommand } from './who-chat.command.js';

export function buildGeneralChatCommands(
  getRegistry: () => ChatCommandRegistryEntry[]
): ChatSlashCommand[] {
  return [new HelpChatCommand(getRegistry), new WhoChatCommand()];
}
