import type {
  ICommand,
  ICommandDescriptor,
  ICommandRegistry,
  IServiceContainer,
  ExecutionContext,
} from '@ai-team/core';

export class SlashCommandDispatcher {
  constructor(
    private readonly registry?: ICommandRegistry,
    private readonly container?: IServiceContainer
  ) {}

  /** Descriptors of all commands available in chat — no instance resolution. */
  list(): ICommandDescriptor[] {
    if (!this.registry || typeof this.registry.getAll !== 'function') {
      return [];
    }
    return this.registry.getAll({ availableIn: { chat: true } });
  }

  resolve(commandKey: string): ICommand<string, unknown> | undefined {
    if (!this.registry || typeof this.registry.get !== 'function') {
      return undefined;
    }

    const key = commandKey.startsWith('/') ? commandKey.slice(1) : commandKey;
    const meta = this.registry.get(key);
    if (!meta?.availableIn?.chat) return undefined;
    if (!this.container) return undefined;
    return this.registry.resolve(key, this.container) as ICommand<string, unknown> | undefined;
  }

  dispatch(commandKey: string, args: string, ctx: ExecutionContext) {
    const command = this.resolve(commandKey);
    if (!command) {
      throw new Error(`Unknown slash command '${commandKey}'`);
    }
    return command.execute(args, ctx);
  }
}
