import type { ICommand, ICommandRegistry, ExecutionContext } from '@ai-team/core';

export class SlashCommandDispatcher {
  constructor(private readonly registry?: ICommandRegistry) {}

  list(): Array<ICommand<string, unknown>> {
    if (!this.registry || typeof this.registry.getAll !== 'function') {
      return [];
    }

    return this.registry.getAll({ availableIn: { chat: true } }) as Array<
      ICommand<string, unknown>
    >;
  }

  resolve(commandKey: string): ICommand<string, unknown> | undefined {
    if (!this.registry || typeof this.registry.get !== 'function') {
      return undefined;
    }

    const key = commandKey.startsWith('/') ? commandKey.slice(1) : commandKey;
    const command = this.registry.get(key);
    if (!command?.availableIn.chat) return undefined;
    return command as ICommand<string, unknown>;
  }

  dispatch(commandKey: string, args: string, ctx: ExecutionContext) {
    const command = this.resolve(commandKey);
    if (!command) {
      throw new Error(`Unknown slash command '${commandKey}'`);
    }
    return command.execute(args, ctx);
  }
}
