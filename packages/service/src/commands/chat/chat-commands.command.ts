import type { ICommand } from '@ai-team/core';
import type { IContextService } from '@ai-team/api-contracts';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { buildGeneralChatCommands } from './general-chat-commands.command.js';
import { buildSessionChatCommands } from './session-chat-commands.command.js';
import { buildTeamChatCommands } from './team-chat-commands.command.js';
import { buildWorkflowChatCommands } from './workflow-chat-commands.command.js';
import { buildUtilityChatCommands } from './utility-chat-commands.command.js';

export type ChatCommandRegistryEntry = Pick<
  ICommand<string, OrchestratorContext, unknown>,
  'key' | 'usage' | 'description' | 'aliases' | 'availableIn'
>;

export interface ChatCommandDependencyOptions {
  contextService: Pick<IContextService, 'getContextEstimate'>;
}

function createDefaultChatCommandDependencies(): ChatCommandDependencyOptions {
  return {
    contextService: {
      getContextEstimate: async () => {
        throw new Error('contextService is required to evaluate /session context');
      },
    },
  };
}

function toChatCommandRegistryEntry(
  cmd: ICommand<string, OrchestratorContext, unknown>
): ChatCommandRegistryEntry {
  return {
    key: cmd.key,
    usage: cmd.usage ?? `/${cmd.key}`,
    description: cmd.description,
    aliases: cmd.aliases,
    availableIn: cmd.availableIn,
  };
}

export function buildSlashICommands(
  deps: ChatCommandDependencyOptions = createDefaultChatCommandDependencies()
): Array<ICommand<string, OrchestratorContext, unknown>> {
  const commands: Array<ICommand<string, OrchestratorContext, unknown>> = [];

  const getRegistry = (): ChatCommandRegistryEntry[] =>
    commands.map(toChatCommandRegistryEntry);

  commands.push(
    ...buildGeneralChatCommands(getRegistry),
    ...buildSessionChatCommands({ contextService: deps.contextService }),
    ...buildTeamChatCommands(),
    ...buildWorkflowChatCommands(),
    ...buildUtilityChatCommands()
  );

  return commands;
}

export function buildChatCommandRegistry(): ChatCommandRegistryEntry[] {
  return buildSlashICommands().map(toChatCommandRegistryEntry);
}

export function buildChatCommandAliases(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const cmd of buildSlashICommands()) {
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        result[alias] = cmd.key;
      }
    }
  }
  return result;
}
