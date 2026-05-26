import { CliCommandMetadata } from '@ai-team/core';

const cliCommandCatalog = new Map<string, CliCommandMetadata>();

export function registerCliCommandCatalog(commands: CliCommandMetadata[]): void {
  cliCommandCatalog.clear();
  for (const command of commands) {
    cliCommandCatalog.set(command.key, { ...command });
  }
}

export function getCliCommandCatalog(): CliCommandMetadata[] {
  return [...cliCommandCatalog.values()].map((command) => ({
    ...command,
    aliases: command.aliases ? [...command.aliases] : undefined,
    options: command.options ? [...command.options] : undefined,
    arguments: command.arguments ? [...command.arguments] : undefined,
  }));
}

export function getLlmCallableCliCommandsFromCatalog(): CliCommandMetadata[] {
  return getCliCommandCatalog().filter((command) => command.llmCallable);
}
