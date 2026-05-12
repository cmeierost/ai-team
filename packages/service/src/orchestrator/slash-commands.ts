/**
 * Slash command dispatcher — any ICommand with availableIn.chat=true is routable.
 * The dispatcher resolves commands from the main registry passed in.
 */

import type { ICommandRegistry } from '@ai-team/core';
export { SlashCommandDispatcher } from './slash-command-dispatcher.js';
import { SlashCommandDispatcher } from './slash-command-dispatcher.js';

export function createSlashCommandDispatcher(registry: ICommandRegistry): SlashCommandDispatcher {
  return new SlashCommandDispatcher(registry);
}

export function buildDefaultSlashCommands(registry: ICommandRegistry) {
  return new SlashCommandDispatcher(registry).list();
}
