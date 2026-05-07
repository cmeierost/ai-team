import {
	buildChatCommandRegistry,
	buildChatCommandAliases,
} from './commands/chat/chat-commands.command.js';
/**
 * Flat registry of in-chat slash commands.
 * Derived from the ISlashCommand objects in slash-commands.ts (single source of truth).
 */
export const IN_CHAT_COMMAND_REGISTRY = buildChatCommandRegistry();

/**
 * Alias → canonical-key map for in-chat slash commands.
 * Derived from the aliases on each ISlashCommand object in slash-commands.ts.
 */
export const IN_CHAT_COMMAND_ALIASES: Record<string, string> = buildChatCommandAliases();
