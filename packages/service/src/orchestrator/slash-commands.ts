/**
 * Default slash-command implementations registered via TOKENS.SlashCommands.
 *
 * Source of truth now lives as ICommand definitions in:
 *   packages/service/src/commands/chat/chat-commands.command.ts
 */

import type { SlashCommand } from './pipeline.js';
import type { IContextService } from '@ai-team/api-contracts';
import { toSlashCommand } from '../command-adapters.js';
import { buildSlashICommands } from '../commands/chat/chat-commands.command.js';

export interface SlashCommandDependencies {
  contextService: Pick<IContextService, 'getContextEstimate'>;
}

/**
 * Build slash commands automatically from ICommand metadata/handlers.
 */
export function buildDefaultSlashCommands(deps?: SlashCommandDependencies): SlashCommand[] {
  return buildSlashICommands(deps).map((cmd) => toSlashCommand(cmd));
}
