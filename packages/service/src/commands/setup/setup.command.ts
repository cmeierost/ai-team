import { z } from 'zod';
import type { SetupOptions } from '@ai-team/api-contracts';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { SetupCommand } from './setup.js';

type Params = z.infer<typeof SetupICommand.schema>;

export class SetupICommand implements ICommand<Params, void> {
  static readonly schema = z.object({
    options: z.any().optional(),
  });

  readonly key = 'setup';
  readonly cli = { command: 'setup' };
  readonly description = 'Configure LLM provider connection';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'setup';
  readonly parameters = SetupICommand.schema;

  constructor(private readonly setupCommand: Pick<SetupCommand, 'execute'>) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    await this.setupCommand.execute(
      {
        workspaceRoot: ctx.workspaceRoot,
        options: (payload.options ?? {}) as SetupOptions,
      },
      ctx
    );
    return { status: 'ok' };
  }
}
