import type { AiTeamCommandName, CommandAvailability } from '@ai-team/api-client';
import type { IContainerToken } from '@ai-team/core';
import type { CliCommandMetadata } from '@ai-team/infrastructure';
import type { CommandRegistration } from '@ai-team/service/src/command-dispatcher.js';
import type {
  CommandDefinition,
  CommandFactoryContainer,
  CurriedCommandHandler,
} from '@ai-team/service/src/commands/definitions/types.js';

function createContainerToken<T>(id: string): IContainerToken<T> {
  return {
    id,
    toString: () => `Token(${id})`,
  } as IContainerToken<T>;
}

export function createCommandHandlerToken<TCommand extends AiTeamCommandName>(
  key: TCommand
): IContainerToken<CurriedCommandHandler<TCommand>> {
  return createContainerToken<CurriedCommandHandler<TCommand>>(
    `ContainerCommandHandler:${String(key)}`
  );
}

export function availabilityFromCliMetadata(metadata: CliCommandMetadata): CommandAvailability {
  const cli = Boolean(metadata.directCli);
  const llmCallable = Boolean(metadata.llmCallable);

  return {
    cli,
    chat: llmCallable,
    tool: llmCallable,
  };
}

export function createRegistrationFromCliMetadata<TCommand extends AiTeamCommandName>(
  key: TCommand,
  metadata: CliCommandMetadata
): Omit<CommandRegistration<TCommand>, 'handler'> {
  return {
    key,
    description: metadata.description,
    usage: metadata.command,
    availableIn: availabilityFromCliMetadata(metadata),
  };
}

export function createFactoryCommandDefinition<TCommand extends AiTeamCommandName>(
  key: TCommand,
  metadata: CliCommandMetadata,
  handler: (
    container: CommandFactoryContainer,
    payload: Parameters<CommandRegistration<TCommand>['handler']>[1],
    context: Parameters<CommandRegistration<TCommand>['handler']>[2]
  ) => ReturnType<CommandRegistration<TCommand>['handler']>
): CommandDefinition<TCommand> {
  return {
    cliMetadata: metadata,
    factory: (container) => ({
      ...createRegistrationFromCliMetadata(key, metadata),
      handler: async (_workspaceRoot, payload, context) => handler(container, payload, context),
    }),
  };
}

export function createResolverCommandDefinition<TCommand extends AiTeamCommandName>(
  key: TCommand,
  metadata: CliCommandMetadata,
  registerHandler: (
    container: CommandFactoryContainer,
    handlerToken: IContainerToken<CurriedCommandHandler<TCommand>>
  ) => void
): CommandDefinition<TCommand> {
  const handlerToken = createCommandHandlerToken(key);

  return {
    cliMetadata: metadata,
    registration: createRegistrationFromCliMetadata(key, metadata),
    handlerToken,
    register: (container) => {
      registerHandler(container, handlerToken);
    },
  };
}
