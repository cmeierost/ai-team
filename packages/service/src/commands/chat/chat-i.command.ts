import { ChatCommand } from './chat.command.js';

/**
 * Transitional alias module.
 *
 * The previous `chat-i.command.ts` carried a duplicate full chat runtime.
 * To keep a single authoritative implementation, this file now re-exports
 * `ChatCommand` from `chat.command.ts`.
 */
export { ChatCommand };
export type { ChatRuntimeOptions } from './chat.command.js';

/** Backward-compatible metadata export shape used by existing imports. */
export const ChatCommandMetadata = ChatCommand.metadata;
