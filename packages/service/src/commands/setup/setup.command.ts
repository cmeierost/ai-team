import { z } from 'zod';
import type { SetupOptions } from '@ai-team/api-contracts';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SetupCommand } from './setup.js';

type Params = z.infer<typeof SetupICommand.schema>;
const _setupICommandSchema = z.object({
  options: z.any().optional(),
});

export const SetupICommandMetadata = {
  key: 'setup',
  description: 'Configure LLM provider connection',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _setupICommandSchema,
} satisfies ICommandDescriptor;

export class SetupICommand implements ICommand<Params, void> {
  static readonly schema = _setupICommandSchema;
  readonly metadata = SetupICommandMetadata;

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
