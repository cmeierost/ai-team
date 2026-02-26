export interface CommandOptionMetadata {
  flags: string;
  description: string;
  defaultValue?: string | boolean | string[];
}

export interface CommandArgumentMetadata {
  syntax: string;
  description: string;
}

export interface CliCommandMetadata {
  key: string;
  command: string;
  description: string;
  llmCallable: boolean;
  parentKey?: string;
  options?: CommandOptionMetadata[];
  arguments?: CommandArgumentMetadata[];
}

const cliCommandCatalog = new Map<string, CliCommandMetadata>();

export function registerCliCommandCatalog(commands: CliCommandMetadata[]): void {
  cliCommandCatalog.clear();
  for (const command of commands) {
    cliCommandCatalog.set(command.key, { ...command });
  }
}

export function getCliCommandCatalog(): CliCommandMetadata[] {
  return [...cliCommandCatalog.values()].map(command => ({
    ...command,
    options: command.options ? [...command.options] : undefined,
    arguments: command.arguments ? [...command.arguments] : undefined,
  }));
}

export function getLlmCallableCliCommandsFromCatalog(): CliCommandMetadata[] {
  return getCliCommandCatalog().filter(command => command.llmCallable);
}
