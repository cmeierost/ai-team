import type { ICommand, ICommandRegistry } from '@ai-team/core';
import type { IContextService } from '@ai-team/api-contracts';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { CommandRegistry } from '../../command-registry-impl.js';
import { buildGeneralChatCommands } from './general-chat-commands.command.js';
import { buildSessionChatCommands } from './session-chat-commands.command.js';
import { buildTeamChatCommands } from './team-chat-commands.command.js';
import { buildWorkflowChatCommands } from './workflow-chat-commands.command.js';
import { buildUtilityChatCommands } from './utility-chat-commands.command.js';

export type ChatCommandRegistryEntry = Pick<
  ICommand<string, OrchestratorContext, unknown>,
  | 'key'
  | 'usage'
  | 'description'
  | 'aliases'
  | 'availableIn'
  | 'path'
  | 'help'
  | 'llm'
  | 'intents'
  | 'intentExamples'
  | 'input'
>;

export interface ChatCommandDependencyOptions {
  contextService: Pick<IContextService, 'getContextEstimate'>;
}

type ChatICommand = ICommand<string, OrchestratorContext, unknown>;

function createDefaultChatCommandDependencies(): ChatCommandDependencyOptions {
  return {
    contextService: {
      getContextEstimate: async () => {
        throw new Error('contextService is required to evaluate /session context');
      },
    },
  };
}

function toChatCommandRegistryEntry(cmd: ChatICommand): ChatCommandRegistryEntry {
  return {
    key: cmd.key,
    usage: cmd.usage ?? `/${cmd.key}`,
    description: cmd.description,
    aliases: cmd.aliases,
    availableIn: cmd.availableIn,
    path: cmd.path,
    help: cmd.help,
    llm: cmd.llm,
    intents: cmd.intents,
    intentExamples: cmd.intentExamples,
    input: cmd.input,
  };
}

function getChatCommandsFromRegistry(registry: ICommandRegistry): ChatICommand[] {
  return registry
    .getAll({ availableIn: { chat: true } })
    .map((command) => command as ChatICommand);
}

function buildChatCommandSet(
  deps: ChatCommandDependencyOptions = createDefaultChatCommandDependencies()
): ICommandRegistry {
  const registry = new CommandRegistry();

  const getRegistry = (): ChatCommandRegistryEntry[] =>
    getChatCommandsFromRegistry(registry).map(toChatCommandRegistryEntry);

  const commands: ChatICommand[] = [
    ...buildGeneralChatCommands(getRegistry),
    ...buildSessionChatCommands({ contextService: deps.contextService }),
    ...buildTeamChatCommands(),
    ...buildWorkflowChatCommands(),
    ...buildUtilityChatCommands(),
  ];

  for (const command of commands) {
    registry.register(command);
  }

  return registry;
}

export function buildSlashICommands(
  deps: ChatCommandDependencyOptions = createDefaultChatCommandDependencies()
): Array<ICommand<string, OrchestratorContext, unknown>> {
  return getChatCommandsFromRegistry(buildChatCommandSet(deps));
}

export function buildChatCommandRegistry(): ChatCommandRegistryEntry[] {
  return getChatCommandsFromRegistry(buildChatCommandSet()).map(toChatCommandRegistryEntry);
}

export function buildChatCommandAliases(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const cmd of getChatCommandsFromRegistry(buildChatCommandSet())) {
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        result[alias] = cmd.key;
      }
    }
  }
  return result;
}
