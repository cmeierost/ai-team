import type { ChatCommandRegistryEntry } from '@ai-team/api-contracts';

// Static web-chat registry seed. Dynamic entries are composed at runtime.
export const IN_CHAT_COMMAND_REGISTRY: ChatCommandRegistryEntry[] = [];

export const IN_CHAT_COMMAND_ALIASES: Record<string, string> = {};
