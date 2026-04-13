import type { IContainerToken, IServiceContainer } from '@ai-team/core';
import type { AiTeamCommandName } from '@ai-team/api-client';
import type { AgentManager, CliCommandMetadata, SkillManager } from '@ai-team/infrastructure';
import type { CommandRegistration } from '../../command-dispatcher.js';
import type { ToolManager } from '../../tools/tool-manager.js';

function createContainerToken<T>(id: string): IContainerToken<T> {
  return {
    id,
    toString: () => `Token(${id})`,
  } as IContainerToken<T>;
}

export const COMMAND_FACTORY_TOKENS = {
  WorkspaceRoot: createContainerToken<string>('WorkspaceRoot'),
  AgentManager: createContainerToken<AgentManager>('AgentManager'),
  SkillManager: createContainerToken<SkillManager>('SkillManager'),
  ToolManager: createContainerToken<ToolManager>('ToolManager'),
} as const;

export interface CommandFactoryContainer {
  workspaceRoot: string;
  resolver: IServiceContainer;
  resolve<T>(token: IContainerToken<T>): T;
  registerTransient<T>(
    token: IContainerToken<T>,
    factory: (resolver: IServiceContainer) => T
  ): void;
}

export type CommandFactory<TCommand extends AiTeamCommandName = AiTeamCommandName> = (
  container: CommandFactoryContainer
) => CommandRegistration<TCommand>;

export type CurriedCommandHandler<TCommand extends AiTeamCommandName = AiTeamCommandName> = (
  payload: Parameters<CommandRegistration<TCommand>['handler']>[1],
  context: Parameters<CommandRegistration<TCommand>['handler']>[2]
) => ReturnType<CommandRegistration<TCommand>['handler']>;

export interface ResolverCommandDefinition<TCommand extends AiTeamCommandName = AiTeamCommandName> {
  registration: Omit<CommandRegistration<TCommand>, 'handler'>;
  handlerToken: IContainerToken<CurriedCommandHandler<TCommand>>;
  register(container: CommandFactoryContainer): void;
  cliMetadata?: CliCommandMetadata;
}

export interface FactoryCommandDefinition<TCommand extends AiTeamCommandName = AiTeamCommandName> {
  factory: CommandFactory<TCommand>;
  cliMetadata?: CliCommandMetadata;
}

export type CommandDefinition<TCommand extends AiTeamCommandName = AiTeamCommandName> =
  | FactoryCommandDefinition<TCommand>
  | ResolverCommandDefinition<TCommand>;

export type AnyCommandDefinition = CommandDefinition<any>;
export type CommandDefinitionSet = ReadonlyArray<AnyCommandDefinition>;

export interface CommandDefinitionRegistry {
  add(...definitions: AnyCommandDefinition[]): void;
  list(): CommandDefinitionSet;
}

export const COMMAND_DEFINITION_REGISTRY_TOKEN =
  createContainerToken<CommandDefinitionRegistry>('CommandDefinitions');

export function createCommandDefinitionRegistry(
  initialDefinitions: CommandDefinitionSet = []
): CommandDefinitionRegistry {
  const definitions = [...initialDefinitions];

  return {
    add: (...nextDefinitions) => {
      definitions.push(...nextDefinitions);
    },
    list: () => [...definitions],
  };
}

export function isResolverCommandDefinition<TCommand extends AiTeamCommandName>(
  definition: CommandDefinition<TCommand>
): definition is ResolverCommandDefinition<TCommand> {
  return 'register' in definition && 'handlerToken' in definition && 'registration' in definition;
}

export function createCommandHandlerToken<TCommand extends AiTeamCommandName>(
  key: TCommand
): IContainerToken<CurriedCommandHandler<TCommand>> {
  return createContainerToken<CurriedCommandHandler<TCommand>>(`CommandHandler:${String(key)}`);
}
