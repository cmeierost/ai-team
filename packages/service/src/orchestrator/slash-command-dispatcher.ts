import type { ICommandDescriptor, ICommandRegistry, ExecutionContext } from '@ai-team/core';

export class SlashCommandDispatcher {
  constructor(private readonly registry?: ICommandRegistry) {}

  /** Descriptors of all commands available in chat — no instance resolution. */
  list(): ICommandDescriptor[] {
    if (!this.registry || typeof this.registry.getAll !== 'function') {
      return [];
    }
    return this.registry.getAll({ availableIn: { chat: true } });
  }

  private resolve(commandKey: string) {
    if (!this.registry || typeof this.registry.get !== 'function') {
      return undefined;
    }

    const key = commandKey.startsWith('/') ? commandKey.slice(1) : commandKey;
    const meta = this.registry.get(key);
    if (!meta?.availableIn?.chat) return undefined;
    // Chat-only command factories are lightweight and typically don't need DI.
    // Production flows that require full DI use CommandDispatcher instead.
    return this.registry.resolve(key, {} as any);
  }

  dispatch(commandKey: string, args: string, ctx: ExecutionContext) {
    const key = commandKey.startsWith('/') ? commandKey.slice(1) : commandKey;
    const command = this.resolve(commandKey);
    if (!command) {
      return Promise.reject(new Error(`Unknown slash command '${key}'`));
    }
    const enrichedCtx: ExecutionContext = {
      ...ctx,
      invocationSurface: 'slash',
      agentId: ctx.agent?.id ?? ctx.agentId,
    };
    return command.execute(args, enrichedCtx);
  }
}
