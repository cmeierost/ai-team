import type { ChatCommandRegistryEntry } from '@ai-team/api-contracts';
/**
 * Compatibility export retained for legacy CLI imports.
 *
 * Chat command registration now lives in command-dispatcher.ts and runtime command registry wiring.
 * This static module intentionally exports empty values until legacy consumers are fully removed.
 */
export const IN_CHAT_COMMAND_REGISTRY: ChatCommandRegistryEntry[] = [];

/**
 * Compatibility export retained for legacy CLI imports.
 */
export const IN_CHAT_COMMAND_ALIASES: Record<string, string> = {};
